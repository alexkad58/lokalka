import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { sanitizeFactExpression as sanitizeFactExpressionUtil, sumFactExpression as sumFactExpressionUtil } from './shared/recount-utils.js';

function toIsoNow() {
	return new Date().toISOString();
}

function asNumber(value) {
	const parsed = Number.parseFloat(String(value).replace(',', '.'));
	return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeFactExpression(value) {
	return sanitizeFactExpressionUtil(value);
}

function sumFactExpression(value) {
	return sumFactExpressionUtil(value);
}

function computeItemFact(item, values, options = {}) {
	const treatEmptyAsZero = Boolean(options.treatEmptyAsZero);
	const raw = values?.[item.code];
	if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
		return sumFactExpression(raw);
	}
	if (treatEmptyAsZero) {
		return 0;
	}
	return null;
}

function formatRuDate(dateValue) {
	const date = dateValue ? new Date(dateValue) : new Date();
	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: 'long',
		year: 'numeric'
	});
}

function formatRuTime(dateValue) {
	const date = dateValue ? new Date(dateValue) : new Date();
	return date.toLocaleTimeString('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

function formatMoney(value) {
	return `${asNumber(value).toFixed(2)} руб.`;
}

function configurePdfFont(doc) {
	const candidates = [
		'C:/Windows/Fonts/arial.ttf',
		'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
		'/Library/Fonts/Arial.ttf'
	];

	const fontPath = candidates.find(fontFilePath => existsSync(fontFilePath));
	if (fontPath) doc.font(fontPath);
}

function drawCell(doc, x, y, width, height, text, options = {}) {
	doc.save();
	doc.lineWidth(0.3);
	doc.rect(x, y, width, height).stroke();
	doc.restore();
	doc.fontSize(options.fontSize || 7);
	doc.text(String(text ?? ''), x + 2, y + 2, {
		width: width - 2,
		height: height - 2,
		align: options.align || 'left'
	});
}

function buildTableRows(recount) {
	const rows = [];
	const values = recount.values || {};

	let plusSum = 0;
	let minusSum = 0;

	let index = 1;
	for (const item of recount.items || []) {
		const docQty = asNumber(item.docQty);
		const rawExpression = sanitizeFactExpression(values?.[item.code] ?? '');
		const fact = computeItemFact(item, values, { treatEmptyAsZero: true });
		const factNumber = fact === null ? null : asNumber(fact);
		const delta = factNumber === null ? null : factNumber - docQty;

		if (delta !== null && delta > 0) plusSum += delta * asNumber(item.price);
		if (delta !== null && delta < 0) minusSum += Math.abs(delta) * asNumber(item.price);

		rows.push({
			index,
			code: item.code,
			name: item.name,
			unit: item.unit || '',
			price: asNumber(item.price).toFixed(2),
			docPack: '',
			docUnits: docQty || '',
			factTotal: factNumber === null ? '' : (rawExpression || String(factNumber)),
			discrepancy: delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`
		});

		index += 1;
	}

	return {
		rows,
		plusSum,
		minusSum,
		totalSum: plusSum - minusSum
	};
}

async function buildPdfBufferFromRecount(recount, options) {
	const doc = new PDFDocument({ margin: 20, size: 'A4' });
	const chunks = [];

	const done = new Promise((resolve, reject) => {
		doc.on('data', chunk => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	configurePdfFont(doc);

	const completedAt = recount.completedAt || toIsoNow();
	const tableData = buildTableRows(recount);

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
	doc.fontSize(summaryFontSize).text(`- ${formatMoney(tableData.minusSum)}`, tableLeft, summaryLineY, {
		width: summaryWidth,
		align: 'left'
	});
	 summaryLineY += 9;
	if (includeTotalSummary) {
		doc.text(`+ ${formatMoney(tableData.plusSum)}`, tableLeft, summaryLineY, {
			width: summaryWidth,
			align: 'left'
		});
		summaryLineY += 9;
	}
	doc.text(`Итого: ${formatMoney(includeTotalSummary ? tableData.totalSum : -tableData.minusSum)}`, tableLeft, summaryLineY, {
		width: summaryWidth,
		align: 'left'
	});
	const commissionTopLineY = commissionTopY + 28;
	const firstSignLineY = commissionTopLineY + 14;
	const secondSignLineY = commissionTopLineY + 30;
	doc.fontSize(summaryFontSize).text('Проверка осуществлялась комиссией в составе:', tableLeft, commissionTopLineY, {
		width: summaryWidth,
		align: 'left'
	});
	doc.fontSize(summaryFontSize).text(counterName, signLineStartX, firstSignLineY - 8, {
		width: signLineEndX - signLineStartX,
		align: 'right'
	});
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
	const tableHeaderTopHeight = 9;
	const tableHeaderBottomHeight = 7;
	const tableHeaderHeight = tableHeaderTopHeight + tableHeaderBottomHeight;
	const rowHeight = 8.8;

	const columns = {
		index: 16,
		code: 24,
		name: tableWidth - (16 + 24 + 24 + 30 + 50 + 101 + 40),
		unit: 24,
		price: 30,
		docPack: 50,
		factTotal: 101,
		discrepancy: 40
	};

	function drawStoreLine(y) {
		doc.fontSize(7).text(storeText, tableLeft, y, {
			width: leftInfoWidth,
			align: 'left'
		});
		doc.text(timeText, tableLeft + leftInfoWidth + 8, y, {
			width: rightInfoWidth,
			align: 'right'
		});

		return y + Math.max(
			doc.heightOfString(storeText, { width: leftInfoWidth }),
			doc.heightOfString(timeText, { width: rightInfoWidth })
		) + 4;
	}

	function drawTableHeader(y) {
		let x = tableLeft;
		drawCell(doc, x, y, columns.index, tableHeaderHeight, '№', { align: 'center', fontSize: 5.5 });
		x += columns.index;
		drawCell(doc, x, y, columns.code, tableHeaderHeight, 'Код', { align: 'center', fontSize: 5.5 });
		x += columns.code;
		drawCell(doc, x, y, columns.name, tableHeaderHeight, 'Товар', { align: 'center', fontSize: 5.5 });
		x += columns.name;
		drawCell(doc, x, y, columns.unit, tableHeaderHeight, 'Размер-\nность', { align: 'center', fontSize: 5.5 });
		x += columns.unit;
		drawCell(doc, x, y, columns.price, tableHeaderHeight, 'Цена', { align: 'center', fontSize: 5.5 });
		x += columns.price;

		drawCell(doc, x, y, columns.docPack, tableHeaderHeight, 'По документам', { align: 'center', fontSize: 5.5 });
		x += columns.docPack;

		drawCell(doc, x, y, columns.factTotal, tableHeaderHeight, 'Фактически', { align: 'center', fontSize: 5.5 });
		x += columns.factTotal;

		drawCell(doc, x, y, columns.discrepancy, tableHeaderHeight, 'Расхождение', { align: 'center', fontSize: 5.5 });
	}

	function drawPageHeader(y) {
		const tableStartY = drawStoreLine(y);
		drawTableHeader(tableStartY);
		return tableStartY + tableHeaderHeight;
	}

	function drawRow(y, row) {
		let x = tableLeft;
		drawCell(doc, x, y, columns.index, rowHeight, row.index, { align: 'center', fontSize: 5.5 });
		x += columns.index;
		drawCell(doc, x, y, columns.code, rowHeight, row.code, { align: 'center', fontSize: 5.5 });
		x += columns.code;
		drawCell(doc, x, y, columns.name, rowHeight, row.name, { align: 'left', fontSize: 5.5 });
		x += columns.name;
		drawCell(doc, x, y, columns.unit, rowHeight, row.unit, { align: 'center', fontSize: 5.5 });
		x += columns.unit;
		drawCell(doc, x, y, columns.price, rowHeight, row.price, { align: 'right', fontSize: 5.5 });
		x += columns.price;
		drawCell(doc, x, y, columns.docPack, rowHeight, row.docUnits, { align: 'right', fontSize: 5.5 });
		x += columns.docPack;
		drawCell(doc, x, y, columns.factTotal, rowHeight, row.factTotal, { align: 'right', fontSize: 5.5 });
		x += columns.factTotal;
		drawCell(doc, x, y, columns.discrepancy, rowHeight, row.discrepancy, { align: 'center', fontSize: 5.5 });
	}

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
	if (y + statementHeight > doc.page.height - doc.page.margins.bottom) {
		doc.addPage();
		configurePdfFont(doc);
		y = drawPageHeader(doc.page.margins.top);
	}

	doc.fontSize(6).text('Все остатки товарно-материальных ценностей поименованные в данной учетной ведомости с позиции № ______ по № ______,', tableLeft + 30, y + 4, {
		width: tableWidth - 30,
		align: 'left'
	});
	doc.text('проверены комиссией в натуре и внесены в учетную ведомость в графу "фактически".', tableLeft + 30, y + 14, {
		width: tableWidth - 30,
		align: 'left'
	});
	doc.text('Подписи (Ф. И. О. разборчиво)', tableLeft + 30, y + 24, {
		width: tableWidth - 30,
		align: 'left'
	});

	doc.addPage();
	configurePdfFont(doc);
	y = drawPageHeader(doc.page.margins.top);

	doc.fontSize(7).text('Члены комиссии:', tableLeft + 30, y + 12, {
		width: tableWidth - 30,
		align: 'left'
	});

	const leftLineStartX = tableLeft + 30;
	const leftLineEndX = tableLeft + Math.round(tableWidth * 0.43);
	const rightLineStartX = leftLineEndX + 26;
	const rightLineEndX = tableLeft + tableWidth;
	const rightLineWidth = rightLineEndX - rightLineStartX;
	const rightHalfWidth = rightLineWidth / 2;
	const firstLineY = y + 40;

	doc.save();
	doc.lineWidth(0.6);
	for (let lineIndex = 0; lineIndex < 4; lineIndex += 1) {
		const lineY = firstLineY + lineIndex * 26;
		doc.moveTo(leftLineStartX, lineY).lineTo(leftLineEndX, lineY).stroke();
		doc.moveTo(rightLineStartX, lineY).lineTo(rightLineEndX, lineY).stroke();
		doc.fontSize(5.5);
		doc.text('Должность', leftLineStartX, lineY + 2, {
			width: leftLineEndX - leftLineStartX,
			align: 'center'
		});
		doc.text('Подпись', rightLineStartX, lineY + 2, {
			width: rightHalfWidth,
			align: 'center'
		});
		doc.text('Расшифровка подписи', rightLineStartX + rightHalfWidth, lineY + 2, {
			width: rightHalfWidth,
			align: 'center'
		});
	}
	doc.restore();

	doc.end();
	return done;
}

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		recountId: '',
		counterName: '',
		groupName: '',
		includeTotalSummary: true,
		outputPath: ''
	};

	for (const arg of args) {
		if (arg.startsWith('--id=')) {
			options.recountId = arg.slice('--id='.length).trim();
			continue;
		}
		if (arg.startsWith('--counter=')) {
			options.counterName = arg.slice('--counter='.length).trim() || options.counterName;
			continue;
		}
		if (arg.startsWith('--group=')) {
			options.groupName = arg.slice('--group='.length).trim() || options.groupName;
			continue;
		}
		if (arg.startsWith('--includeTotalSummary=')) {
			options.includeTotalSummary = arg.slice('--includeTotalSummary='.length).trim() !== '0';
			continue;
		}
		if (arg.startsWith('--out=')) {
			options.outputPath = arg.slice('--out='.length).trim();
		}
	}

	return options;
}

function loadStorage() {
	const storagePath = path.resolve(process.cwd(), 'server', 'storage.json');
	const raw = readFileSync(storagePath, 'utf8');
	return JSON.parse(raw);
}

function pickRecount(storage, recountId) {
	const recounts = Array.isArray(storage?.recounts) ? storage.recounts : [];
	if (!recounts.length) {
		throw new Error('В server/storage.json нет просчетов. Нечего генерировать.');
	}

	if (recountId) {
		const found = recounts.find(item => String(item.id) === recountId);
		if (!found) {
			throw new Error(`Просчет с id ${recountId} не найден.`);
		}
		return found;
	}

	return [...recounts]
		.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0];
}

function resolveOutputPath(selectedRecount, customOutputPath) {
	if (customOutputPath) {
		return path.resolve(process.cwd(), customOutputPath);
	}

	const baseName = `recount_${selectedRecount.docId || selectedRecount.id}.pdf`;
	return path.resolve(process.cwd(), '.local', baseName);
}

async function main() {
	const options = parseArgs();
	const storage = loadStorage();
	const recount = pickRecount(storage, options.recountId);
	const recountSnapshot = {
		...recount,
		values: recount.values || {},
		items: Array.isArray(recount.items) ? recount.items : [],
		completedAt: recount.completedAt || toIsoNow(),
		createdAt: recount.createdAt || toIsoNow()
	};

	const pdfBuffer = await buildPdfBufferFromRecount(recountSnapshot, {
		counterName: options.counterName || recount.counterName || '-',
		groupName: options.groupName || recount.groupName || '-',
		includeTotalSummary: options.includeTotalSummary
	});

	const outputPath = resolveOutputPath(recountSnapshot, options.outputPath);
	mkdirSync(path.dirname(outputPath), { recursive: true });

	const writer = createWriteStream(outputPath);
	await new Promise((resolve, reject) => {
		writer.on('finish', resolve);
		writer.on('error', reject);
		writer.end(pdfBuffer);
	});

	console.log(`Generated same-template completion PDF: ${outputPath}`);
	console.log(`Source recount id: ${recountSnapshot.id}`);
	console.log(`Doc id: ${recountSnapshot.docId || '-'}`);
}

main().catch(error => {
	console.error('Failed to generate completion PDF sample:', error.message);
	process.exitCode = 1;
});
