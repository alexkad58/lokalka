import PDFDocument from 'pdfkit';

export function createPdfService({ configurePdfFont, drawCell, buildTableRows, asNumber, sanitizeFactExpression, sumFactExpression, toIsoNow, formatRuDate, formatRuTime, formatMoney }) {
  async function buildPdfBufferFromRecount(recount, options = {}) {
    const doc = new PDFDocument({ margin: 20, size: 'A4' });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    configurePdfFont(doc);
    const completedAt = recount.completedAt || toIsoNow();
    const tableData = buildTableRows(recount, { asNumber, sanitizeFactExpression, sumFactExpression });
    const includeDiscrepancyTable = Boolean(options.includeDiscrepancyTable);

    doc.fontSize(10).text('Акт контрольно-ревизионной проверки по количеству и качеству', { align: 'center' });
    doc.fontSize(8).text(`от ${formatRuDate(new Date())} г.`, { align: 'center' });
    doc.moveDown(0.3);

    const commissionTopY = doc.y + 8;
    const tableLeft = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const signLineStartX = tableLeft + Math.round(tableWidth * 0.33);
    const signLineEndX = tableLeft + tableWidth;
    const summaryWidth = signLineStartX - tableLeft - 8;
    const summaryFontSize = 7;
    const counterName = String(options.counterName || recount.counterName || '-');
    const includeTotalSummary = Boolean(options.includeTotalSummary);
    let summaryLineY = commissionTopY;

    doc.save();
    doc.lineWidth(0.6);
    doc.fontSize(summaryFontSize).text(`- ${formatMoney(tableData.minusSum)}`, tableLeft, summaryLineY, { width: summaryWidth, align: 'left' });
    summaryLineY += 9;
    if (includeTotalSummary) {
      doc.text(`+ ${formatMoney(tableData.plusSum)}`, tableLeft, summaryLineY, { width: summaryWidth, align: 'left' });
      summaryLineY += 9;
    }
    doc.text(`Итого: ${formatMoney(includeTotalSummary ? tableData.totalSum : -tableData.minusSum)}`, tableLeft, summaryLineY, { width: summaryWidth, align: 'left' });
    const commissionTopLineY = commissionTopY + 28;
    const firstSignLineY = commissionTopLineY + 14;
    const secondSignLineY = commissionTopLineY + 30;
    doc.fontSize(summaryFontSize).text('Проверка осуществлялась комиссией в составе:', tableLeft, commissionTopLineY, { width: summaryWidth, align: 'left' });
    doc.fontSize(summaryFontSize).text(counterName, signLineStartX, firstSignLineY - 8, { width: signLineEndX - signLineStartX, align: 'right' });
    doc.moveTo(signLineStartX, firstSignLineY).lineTo(signLineEndX, firstSignLineY).stroke();
    doc.moveTo(signLineStartX, secondSignLineY).lineTo(signLineEndX, secondSignLineY).stroke();
    doc.restore();
    doc.y = secondSignLineY + 8;

    const storeLabel = recount.storeLabel || '№____ (адрес не определен)';
    const createdAt = recount.createdAt || toIsoNow();
    const storeText = `По магазину: ${storeLabel}`;
    const timeText = `Просчет с ${formatRuTime(createdAt)} по ${formatRuTime(completedAt)}`;
    const rightInfoWidth = 190;
    const leftInfoWidth = tableWidth - rightInfoWidth - 8;
    const tableHeaderHeight = 16;
    const rowHeight = 8.8;
    const columns = { index: 16, code: 24, name: tableWidth - (16 + 24 + 24 + 30 + 50 + 101 + 40), unit: 24, price: 30, docPack: 50, factTotal: 101, discrepancy: 40 };

    const drawStoreLine = y => {
      doc.fontSize(7).text(storeText, tableLeft, y, { width: leftInfoWidth, align: 'left' });
      doc.text(timeText, tableLeft + leftInfoWidth + 8, y, { width: rightInfoWidth, align: 'right' });
      return y + Math.max(doc.heightOfString(storeText, { width: leftInfoWidth }), doc.heightOfString(timeText, { width: rightInfoWidth })) + 4;
    };
    const drawTableHeader = y => {
      let x = tableLeft;
      for (const [key, label] of [['index', '№'], ['code', 'Код'], ['name', 'Товар'], ['unit', 'Размер-\nность'], ['price', 'Цена'], ['docPack', 'По документам'], ['factTotal', 'Фактически'], ['discrepancy', 'Расхождение']]) {
        drawCell(doc, x, y, columns[key], tableHeaderHeight, label, { align: 'center', fontSize: 5.5 });
        x += columns[key];
      }
    };
    const drawPageHeader = y => {
      const tableStartY = drawStoreLine(y);
      drawTableHeader(tableStartY);
      return tableStartY + tableHeaderHeight;
    };
    const drawRow = (y, row) => {
      let x = tableLeft;
      for (const [key, value, align] of [['index', row.index, 'center'], ['code', row.code, 'center'], ['name', row.name, 'left'], ['unit', row.unit, 'center'], ['price', row.price, 'right'], ['docPack', row.docUnits, 'right'], ['factTotal', row.factTotal, 'right'], ['discrepancy', row.discrepancy, 'center']]) {
        drawCell(doc, x, y, columns[key], rowHeight, value, { align, fontSize: 5.5 });
        x += columns[key];
      }
    };

    let y = drawPageHeader(doc.y + 2);
    for (const row of tableData.rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 16) {
        doc.addPage();
        configurePdfFont(doc);
        y = drawPageHeader(doc.page.margins.top);
      }
      drawRow(y, row);
      y += rowHeight;
    }

    const statementHeight = 28;
    const signatureBlockHeight = 110;
    if (y + statementHeight + signatureBlockHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      configurePdfFont(doc);
      y = drawPageHeader(doc.page.margins.top);
    }

    doc.fontSize(6).text('Все остатки товарно-материальных ценностей поименованные в данной учетной ведомости с позиции № ______ по № ______,', tableLeft + 30, y + 4, { width: tableWidth - 30, align: 'left' });
    doc.text('проверены комиссией в натуре и внесены в учетную ведомость в графу "фактически".', tableLeft + 30, y + 14, { width: tableWidth - 30, align: 'left' });
    doc.text('Подписи (Ф. И. О. разборчиво)', tableLeft + 30, y + 24, { width: tableWidth - 30, align: 'left' });

    const signatureY = y + 38;
    doc.fontSize(7).text('Члены комиссии:', tableLeft + 30, signatureY + 2, { width: tableWidth - 30, align: 'left' });
    const leftLineStartX = tableLeft + 30;
    const leftLineEndX = tableLeft + Math.round(tableWidth * 0.43);
    const rightLineStartX = leftLineEndX + 26;
    const rightLineEndX = tableLeft + tableWidth;
    const rightHalfWidth = (rightLineEndX - rightLineStartX) / 2;
    const firstLineY = signatureY + 28;
    doc.save();
    doc.lineWidth(0.6);
    for (let lineIndex = 0; lineIndex < 4; lineIndex += 1) {
      const lineY = firstLineY + lineIndex * 26;
      doc.moveTo(leftLineStartX, lineY).lineTo(leftLineEndX, lineY).stroke();
      doc.moveTo(rightLineStartX, lineY).lineTo(rightLineEndX, lineY).stroke();
      doc.fontSize(5.5);
      doc.text('Должность', leftLineStartX, lineY + 2, { width: leftLineEndX - leftLineStartX, align: 'center' });
      doc.text('Подпись', rightLineStartX, lineY + 2, { width: rightHalfWidth, align: 'center' });
      doc.text('Расшифровка подписи', rightLineStartX + rightHalfWidth, lineY + 2, { width: rightHalfWidth, align: 'center' });
    }
    doc.restore();

    if (includeDiscrepancyTable && tableData.mismatchRows.length) {
      doc.addPage();
      configurePdfFont(doc);
      y = drawPageHeader(doc.page.margins.top);
      doc.fontSize(10).text('Таблица расхождений', tableLeft, y + 6, { width: tableWidth, align: 'center' });
      y += 18;
      const diffColumns = { index: 22, name: tableWidth - 22 - 52 - 60 - 38, code: 52, discrepancy: 38 };
      let diffX = tableLeft;
      for (const [key, label] of [['index', '№'], ['name', 'Название'], ['code', 'Артикул'], ['discrepancy', 'Расхождение']]) {
        drawCell(doc, diffX, y, diffColumns[key], 12, label, { align: 'center', fontSize: 6.3 });
        diffX += diffColumns[key];
      }
      y += 12;
      for (const row of tableData.mismatchRows) {
        const diffRowHeight = 12;
        if (y + diffRowHeight > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          configurePdfFont(doc);
          y = drawPageHeader(doc.page.margins.top);
        }
        let diffRowX = tableLeft;
        for (const [key, value, align] of [['index', row.index, 'center'], ['name', row.name, 'left'], ['code', row.code, 'center'], ['discrepancy', row.discrepancy, 'center']]) {
          drawCell(doc, diffRowX, y, diffColumns[key], diffRowHeight, value, { align, fontSize: 6.1 });
          diffRowX += diffColumns[key];
        }
        y += diffRowHeight;
      }
    }

    doc.end();
    return done;
  }

  return { buildPdfBufferFromRecount };
}
