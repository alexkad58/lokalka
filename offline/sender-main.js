import QRCode from 'qrcode';
import { GlobalWorkerOptions, getDocument } from '../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { encode } from '../shared/txqr.js';
import { extractRecountMeta, parseDocumentLines } from '../shared/recount-parser.js';

const fileInput = document.querySelector('#file-input');
const chunkSizeInput = document.querySelector('#chunk-size');
const redundancyInput = document.querySelector('#redundancy');
const fileSummary = document.querySelector('#file-summary');
const parseSummary = document.querySelector('#parse-summary');
const startButton = document.querySelector('#start-button');
const stopButton = document.querySelector('#stop-button');
const status = document.querySelector('#status');
const canvas = document.querySelector('#qr-canvas');
const frameCounter = document.querySelector('#frame-counter');
const elapsed = document.querySelector('#elapsed');
const progress = document.querySelector('#progress');

let selectedFile = null;
let frames = [];
let frameIndex = 0;
let timerId = 0;
let startedAt = 0;

GlobalWorkerOptions.workerSrc = globalThis.__txqrPdfWorkerSrc || '';

function buildPageText(items) {
  const rows = [];
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;
    const y = Number(item.transform?.[5] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x: Number(item.transform?.[4] || 0), text });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map(row => row.items.sort((left, right) => left.x - right.x).map(item => item.text).join(' '))
    .join('\n');
}

async function parsePdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data: bytes }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(buildPageText(content.items));
  }
  const text = pages.join('\n');
  const items = parseDocumentLines(text);
  const meta = extractRecountMeta(text);
  return { bytes, text, items, meta, pages: document.numPages };
}

function formatBytes(value) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(2)} МБ`;
}

function formatElapsed() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  elapsed.textContent = `${minutes}:${rest}`;
}

function setStatus(message, tone = '') {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

function stopTransfer(message = 'Передача остановлена') {
  if (timerId) window.clearTimeout(timerId);
  timerId = 0;
  stopButton.disabled = true;
  startButton.disabled = !selectedFile;
  setStatus(message);
}

async function renderFrame() {
  if (!frames.length) return;
  await QRCode.toCanvas(canvas, frames[frameIndex], {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 560
  });
  frameCounter.textContent = `Кадр ${frameIndex + 1} из ${frames.length}`;
  progress.value = (frameIndex + 1) / frames.length;
  formatElapsed();
}

async function showNextFrame() {
  if (!frames.length) return;
  try {
    await renderFrame();
    frameIndex = (frameIndex + 1) % frames.length;
    timerId = window.setTimeout(showNextFrame, 220);
  } catch (error) {
    stopTransfer('Не удалось сформировать QR-код');
    setStatus(error instanceof Error ? error.message : 'Не удалось сформировать QR-код', 'error');
  }
}

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files?.[0] || null;
  stopTransfer();
  if (!selectedFile) {
    fileSummary.textContent = 'PDF еще не выбран';
    parseSummary.textContent = 'Данные еще не разобраны';
    return;
  }
  fileSummary.textContent = `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
  parseSummary.textContent = 'Нажмите запуск для разбора PDF';
  setStatus('Файл выбран. Можно запускать передачу.');
});

startButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  stopTransfer();
  startButton.disabled = true;
  setStatus('Подготовка QR-кадров...');

  try {
    const parsed = await parsePdf(selectedFile);
    if (!parsed.items.length) throw new Error('В PDF не найдены товарные позиции');
    const payload = {
      version: 1,
      sourceFileName: selectedFile.name,
      pages: parsed.pages,
      ...parsed.meta,
      items: parsed.items
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    parseSummary.textContent = `Разобрано позиций: ${parsed.items.length} · ${formatBytes(payloadBytes.length)} данных`;
    frames = encode(payloadBytes, {
      chunkSize: Number(chunkSizeInput.value),
      redundancy: Number(redundancyInput.value),
      sessionId: undefined
    });
    frameIndex = 0;
    startedAt = Date.now();
    stopButton.disabled = false;
    setStatus(`Передача идет · ${frames.length} QR-кадров`);
    await showNextFrame();
  } catch (error) {
    stopTransfer();
    setStatus(error instanceof Error ? error.message : 'Не удалось подготовить файл', 'error');
  }
});

stopButton.addEventListener('click', () => stopTransfer());