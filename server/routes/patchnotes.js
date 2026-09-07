function toErrorReply(reply, error, fallbackMessage) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return reply.code(statusCode).send({ ok: false, error: error?.message || fallbackMessage });
}

export function createPatchNotesRoutes({
  authenticate,
  requireAdmin,
  patchNotesService,
  logEvent,
  buildRequestLogMeta
}) {
  return async function patchNotesRoutes(app) {
    app.get('/api/patchnotes', { preHandler: authenticate }, async () => ({
      ok: true,
      items: patchNotesService.list()
    }));

    app.get('/api/admin/patchnotes', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      items: patchNotesService.list()
    }));

    app.post('/api/admin/patchnotes', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      try {
        const item = await patchNotesService.create(request.body);
        logEvent('info', 'admin-patchnote-create', buildRequestLogMeta(request, { patchNoteId: item.id }));
        return { ok: true, item };
      } catch (error) {
        return toErrorReply(reply, error, 'Не удалось создать патчноут');
      }
    });

    app.put('/api/admin/patchnotes/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      try {
        const item = await patchNotesService.update(request.params?.id, request.body);
        logEvent('info', 'admin-patchnote-update', buildRequestLogMeta(request, { patchNoteId: item.id }));
        return { ok: true, item };
      } catch (error) {
        return toErrorReply(reply, error, 'Не удалось обновить патчноут');
      }
    });

    app.delete('/api/admin/patchnotes/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      try {
        await patchNotesService.remove(request.params?.id);
        logEvent('warn', 'admin-patchnote-delete', buildRequestLogMeta(request, { patchNoteId: request.params?.id }));
        return { ok: true };
      } catch (error) {
        return toErrorReply(reply, error, 'Не удалось удалить патчноут');
      }
    });
  };
}
