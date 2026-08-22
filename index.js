import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

function toIsoNow() {
	return new Date().toISOString();
}

function asNumber(value) {
	const parsed = Number.parseFloat(String(value).replace(',', '.'));
	return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeFactExpression(value) {
	let normalized = String(value || '').replace(/[^\d+]/g, '');
	normalized = normalized.replace(/\++/g, '+');
	normalized = normalized.replace(/^\+/, '');
	return normalized;
}

function sumFactExpression(value) {
	const normalized = sanitizeFactExpression(value);
	const parts = normalized.split('+').filter(Boolean);
	if (!parts.length) return null;

	return parts.reduce((acc, part) => acc + asNumber(part), 0);
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
		width: width - 4,
		height: height - 4,
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
			docQty: docQty || 0,
			fact: rawExpression || (factNumber === null ? '' : factNumber),
			delta: delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`
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

	const includeTotalSummary = Boolean(options.includeTotalSummary);
	const completedAt = recount.completedAt || toIsoNow();
	const createdAt = recount.createdAt || toIsoNow();
	const tableData = buildTableRows(recount);

	doc.fontSize(12).text('Акт контрольно-ревизионной проверки по количеству и качеству', { align: 'center' });
	doc.fontSize(10).text(`от ${formatRuDate(new Date())} г.`, { align: 'center' });
	doc.moveDown(0.3);

	const summaryTopY = doc.y + 8;
	const pageInnerWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
	const leftSummaryWidth = Math.floor(pageInnerWidth * 0.55);
	const rightSummaryX = doc.page.margins.left + leftSummaryWidth + 10;
	const rightSummaryWidth = pageInnerWidth - leftSummaryWidth - 10;

	doc.fontSize(9).text(`- ${formatMoney(tableData.minusSum)}`, doc.page.margins.left, summaryTopY, {
		width: leftSummaryWidth,
		align: 'left'
	});

	// "Свести -/+": off shows only the shortage total, on nets plus against minus.
	let totalLineY = summaryTopY + 12;
	if (includeTotalSummary) {
		doc.fontSize(9).text(`+ ${formatMoney(tableData.plusSum)}`, doc.page.margins.left, totalLineY, {
			width: leftSummaryWidth,
			align: 'left'
		});
		totalLineY += 12;
	}

	const totalValue = includeTotalSummary ? tableData.totalSum : -tableData.minusSum;
	doc.fontSize(9).text(`Итого: ${formatMoney(totalValue)}`, doc.page.margins.left, totalLineY, {
		width: leftSummaryWidth,
		align: 'left'
	});
	const summaryBottomY = totalLineY + 12;

	const counterLineY = totalLineY;
	doc.fontSize(9).text(`Считал: ${String(options.counterName || '-')}`, rightSummaryX, counterLineY, {
		width: rightSummaryWidth,
		align: 'left'
	});

	const signLineStartX = rightSummaryX + 52;
	const signLineEndX = rightSummaryX + rightSummaryWidth;
	const firstSignLineY = counterLineY + 14;
	const secondSignLineY = counterLineY + 30;

	doc.save();
	doc.lineWidth(0.6);
	doc.moveTo(signLineStartX, firstSignLineY).lineTo(signLineEndX, firstSignLineY).stroke();
	doc.moveTo(signLineStartX, secondSignLineY).lineTo(signLineEndX, secondSignLineY).stroke();
	doc.restore();

	doc.y = Math.max(summaryBottomY + 6, secondSignLineY) + 6;

	const tableLeft = doc.page.margins.left;
	const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

	const storeLabel = recount.storeLabel || '№____ (адрес не определен)';
	const storeText = `По магазину: ${storeLabel}`;
	const timeText = `Просчет с ${formatRuTime(createdAt)} по ${formatRuTime(completedAt)}`;
	const storeInfoY = doc.y;
	const rightInfoWidth = 190;
	const leftInfoWidth = tableWidth - rightInfoWidth - 8;

	doc.fontSize(9).text(storeText, tableLeft, storeInfoY, {
		width: leftInfoWidth,
		align: 'left'
	});
	doc.text(timeText, tableLeft + leftInfoWidth + 8, storeInfoY, {
		width: rightInfoWidth,
		align: 'right'
	});

	const storeBlockHeight = Math.max(
		doc.heightOfString(storeText, { width: leftInfoWidth }),
		doc.heightOfString(timeText, { width: rightInfoWidth })
	);
	doc.y = storeInfoY + storeBlockHeight;

	const tableTopStart = doc.y + 6;
	const headerHeight = 16;
	const rowHeight = 12;

	const columns = [
		{ key: 'index', title: '№', width: 18, align: 'center' },
		{ key: 'code', title: 'Код', width: 34, align: 'center' },
		{ key: 'name', title: 'Товар', width: 220, align: 'left' },
		{ key: 'unit', title: 'Размерность', width: 52, align: 'center' },
		{ key: 'price', title: 'Цена', width: 52, align: 'right' },
		{ key: 'docQty', title: 'По документам', width: 62, align: 'right' },
		{ key: 'fact', title: 'Фактически', width: 62, align: 'right' },
		{ key: 'delta', title: 'Расхождение', width: tableWidth - (18 + 34 + 220 + 52 + 52 + 62 + 62), align: 'right' }
	];

	function drawHeader(y) {
		let x = tableLeft;
		for (const col of columns) {
			drawCell(doc, x, y, col.width, headerHeight, col.title, { align: 'center', fontSize: 6.5 });
			x += col.width;
		}
	}

	function drawRow(y, row) {
		let x = tableLeft;
		for (const col of columns) {
			drawCell(doc, x, y, col.width, rowHeight, row[col.key], { align: col.align, fontSize: 6.5 });
			x += col.width;
		}
	}

	let y = tableTopStart;
	drawHeader(y);
	y += headerHeight;

	for (const row of tableData.rows) {
		if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 80) {
			doc.addPage();
			configurePdfFont(doc);
			y = doc.page.margins.top;
			drawHeader(y);
			y += headerHeight;
		}

		drawRow(y, row);
		y += rowHeight;
	}

	doc.y = y + 14;
	const footerLineLeft = doc.page.margins.left + 120;
	const footerLineRight = doc.page.width - doc.page.margins.right;
	const footerFirstLineY = doc.y;

	doc.save();
	doc.lineWidth(0.6);
	doc.moveTo(footerLineLeft, footerFirstLineY).lineTo(footerLineRight, footerFirstLineY).stroke();
	doc.moveTo(footerLineLeft, footerFirstLineY + 18).lineTo(footerLineRight, footerFirstLineY + 18).stroke();
	doc.moveTo(footerLineLeft, footerFirstLineY + 36).lineTo(footerLineRight, footerFirstLineY + 36).stroke();
	doc.restore();

	doc.y = footerFirstLineY + 42;

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
