export function createRecountRoutes({
  authenticate,
  requireServiceAccess,
  db,
  recountService,
  buildRecountSummary,
  sanitizeActiveRecount,
  findUserActiveRecount,
  saveDb,
  logEvent,
  buildRequestLogMeta,
  autosaveMinIntervalMs,
  readPdfBuffer,
  PDFParse,
  buildPdfBufferFromRecount,
  parseDocumentLines,
  shopApiService
}) {
  return async function recountRoutes(app) {
    app.delete('/api/recounts/:id', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const { id } = request.params;
      const recount = await recountService.deleteForUser(request.user.id, id);
      if (!recount) {
        logEvent('warn', 'recount-delete-not-found', buildRequestLogMeta(request, { recountId: id }));
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      logEvent('warn', 'recount-delete-success', buildRequestLogMeta(request, { recountId: recount.id, docId: recount.docId, userId: request.user.id }));
      return { ok: true };
    });

    app.get('/api/recounts', { preHandler: [authenticate, requireServiceAccess] }, async request => {
      const { active, previous } = recountService.listForUser(request.user.id);
      return { ok: true, active: active ? buildRecountSummary(active) : null, previous };
    });

    app.get('/api/recounts/:id', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const { id } = request.params;
      const recount = recountService.findByUser(request.user.id, id);
      if (!recount) {
        logEvent('warn', 'recount-open-not-found', buildRequestLogMeta(request, { recountId: id }));
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      return { ok: true, recount: sanitizeActiveRecount(recount) };
    });

    app.post('/api/recounts/:id/reopen', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const { id } = request.params;
      const result = await recountService.reopenForUser(request.user.id, id);
      if (result.status === 'not-found') {
        logEvent('warn', 'recount-reopen-not-found', buildRequestLogMeta(request, { recountId: id }));
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      if (result.status === 'conflict') {
        logEvent('warn', 'recount-reopen-blocked-active-exists', buildRequestLogMeta(request, { recountId: id, activeRecountId: result.activeRecount.id }));
        return reply.code(409).send({ ok: false, error: 'Сначала завершите или закройте текущий активный просчет' });
      }
      logEvent('info', 'recount-reopen-success', buildRequestLogMeta(request, { recountId: result.recount.id, docId: result.recount.docId }));
      return { ok: true, recount: sanitizeActiveRecount(result.recount) };
    });

    app.post('/api/recounts/from-pdf', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const active = findUserActiveRecount(request.user.id);
      if (active) {
        logEvent('warn', 'recount-create-blocked-active-exists', buildRequestLogMeta(request, { activeRecountId: active.id }));
        return reply.code(409).send({ ok: false, error: 'У вас уже есть активный просчет' });
      }

      const file = await request.file();
      if (!file) {
        logEvent('warn', 'recount-create-missing-file', buildRequestLogMeta(request));
        return reply.code(400).send({ ok: false, error: 'PDF file is required' });
      }
      const isPdfMime = file.mimetype === 'application/pdf';
      const isPdfName = file.filename?.toLowerCase().endsWith('.pdf');
      if (!isPdfMime && !isPdfName) {
        logEvent('warn', 'recount-create-invalid-file-type', buildRequestLogMeta(request, { fileName: file.filename, mimeType: file.mimetype }));
        return reply.code(400).send({ ok: false, error: 'Only PDF files are supported' });
      }

      const buffer = await readPdfBuffer(file);
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      await parser.destroy();
      const recount = await recountService.createFromText({ userId: request.user.id, sourceFileName: file.filename, text: textResult.text });
      logEvent('info', 'recount-create-success', buildRequestLogMeta(request, { recountId: recount.id, docId: recount.docId, sourceFileName: recount.sourceFileName, itemsCount: recount.items.length }));
      return { ok: true, recount: sanitizeActiveRecount(recount) };
    });

    app.post('/api/recounts/:id/progress', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const result = await recountService.saveProgressForUser(request.user.id, id, body, autosaveMinIntervalMs);
      if (result.status === 'not-found') {
        logEvent('warn', 'recount-progress-not-found', buildRequestLogMeta(request, { recountId: id }));
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      if (result.status === 'completed') {
        logEvent('warn', 'recount-progress-completed', buildRequestLogMeta(request, { recountId: result.recount.id, status: result.recount.status }));
        return reply.code(409).send({ ok: false, error: 'Просчет уже завершен' });
      }
      return { ok: true, recount: sanitizeActiveRecount(result.recount) };
    });

    app.post('/api/recounts/:id/complete', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const withoutPdf = Boolean(body.withoutPdf);
      const updateCompletionTime = body.updateCompletionTime === undefined ? true : Boolean(body.updateCompletionTime);
      const counterName = String(body.counterName || '').trim();
      const groupName = String(body.groupName || '').trim();
      const includeTotalSummary = Boolean(body.includeTotalSummary);
      const includeDiscrepancyTable = Boolean(body.includeDiscrepancyTable);

      if (!withoutPdf && (!counterName || !groupName)) {
        logEvent('warn', 'recount-complete-missing-fields', buildRequestLogMeta(request, { recountId: id, hasCounterName: Boolean(counterName), hasGroupName: Boolean(groupName) }));
        return reply.code(400).send({ ok: false, error: 'Укажите просчитывающего и товарную группу' });
      }

      const result = await recountService.completeForUser(request.user.id, id, { ...body, withoutPdf, counterName, groupName, updateCompletionTime });
      if (result.status === 'not-found') {
        logEvent('warn', 'recount-complete-not-found', buildRequestLogMeta(request, { recountId: id }));
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      if (result.status === 'completed') {
        logEvent('warn', 'recount-complete-already-completed', buildRequestLogMeta(request, { recountId: result.recount.id, status: result.recount.status }));
        return reply.code(409).send({ ok: false, error: 'Просчет уже завершен' });
      }

      const recount = result.recount;
      if (withoutPdf) {
        logEvent('info', 'recount-complete-without-pdf', buildRequestLogMeta(request, { recountId: recount.id, docId: recount.docId, updateCompletionTime }));
        return { ok: true, recount: sanitizeActiveRecount(recount) };
      }

      logEvent('info', 'recount-complete-success', buildRequestLogMeta(request, { recountId: recount.id, docId: recount.docId, counterName, groupName, includeTotalSummary, includeDiscrepancyTable, updateCompletionTime }));
      const pdfBuffer = await buildPdfBufferFromRecount(recount, { counterName, groupName, includeTotalSummary, includeDiscrepancyTable });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="recount_${recount.docId || recount.id}.pdf"`);
      return reply.send(pdfBuffer);
    });

    app.post('/api/recount/parse-pdf', { preHandler: authenticate }, async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ ok: false, error: 'PDF file is required' });
      const isPdfMime = file.mimetype === 'application/pdf';
      const isPdfName = file.filename?.toLowerCase().endsWith('.pdf');
      if (!isPdfMime && !isPdfName) return reply.code(400).send({ ok: false, error: 'Only PDF files are supported' });
      const buffer = await readPdfBuffer(file);
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      await parser.destroy();
      const items = parseDocumentLines(textResult.text);
      const docId = `loc_${new Date().toISOString().slice(0, 10)}`;
      return {
        ok: true,
        docId,
        sourceFileName: file.filename,
        pages: textResult.total || textResult.pages?.length || null,
        items,
        summary: { totalItems: items.length, textLength: textResult.text?.length || 0 },
        cache: shopApiService.buildRecountCache(items),
        warnings: items.length === 0 ? ['No items were parsed from the PDF text'] : []
      };
    });
  };
}
