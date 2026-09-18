import QRCode from 'qrcode';
import { getDocument } from '../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import '../client/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
import { encode } from '../shared/txqr.js';
import { extractRecountMeta, parseDocumentLines } from '../shared/recount-parser.js';

const fileInput = document.querySelector('#file-input');
const chunkSizeInput = document.querySelector('#chunk-size');
const redundancyInput = document.querySelector('#redundancy');
const frameDurationInput = document.querySelector('#frame-duration');
const fileSummary = document.querySelector('#file-summary');
const parseSummary = document.querySelector('#parse-summary');
const startButton = document.querySelector('#start-button');
const stopButton = document.querySelector('#stop-button');
const status = document.querySelector('#status');
const canvas = document.querySelector('#qr-canvas');
const frameCounter = document.querySelector('#frame-counter');
const elapsed = document.querySelector('#elapsed');
const progress = document.querySelector('#progress');
const ctx = canvas.getContext('2d');

let selectedFile = null;
let frames = [];
let frameImages = [];
let frameIndex = 0;
let rafId = 0;
let startedAt = 0;
let nextFrameAt = 0;
let playing = false;

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
  playing = false;
  if (rafId) window.cancelAnimationFrame(rafId);
  rafId = 0;
  stopButton.disabled = true;
  startButton.disabled = !selectedFile;
  setStatus(message);
}

// Render every QR frame to an off-screen bitmap up front so playback only has to
// blit an already-decoded image each tick instead of re-running QR encoding live.
async function buildFrameImages(sourceFrames, onProgress) {
  const images = new Array(sourceFrames.length);
  const concurrency = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < sourceFrames.length) {
      const index = cursor;
      cursor += 1;
      const offscreen = document.createElement('canvas');
      await QRCode.toCanvas(offscreen, sourceFrames[index], {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 560
      });
      images[index] = await createImageBitmap(offscreen);
      onProgress(index + 1, sourceFrames.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sourceFrames.length) }, worker));
  return images;
}

function drawFrame(index) {
  const image = frameImages[index];
  if (!image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  frameCounter.textContent = `Кадр ${index + 1} из ${frameImages.length}`;
  progress.value = (index + 1) / frameImages.length;
  formatElapsed();
}

function playbackTick(timestamp) {
  if (!playing) return;
  if (timestamp >= nextFrameAt) {
    drawFrame(frameIndex);
    frameIndex = (frameIndex + 1) % frameImages.length;
    const frameDuration = Number(frameDurationInput.value) || 220;
    // Advance from the scheduled time (not "now") so occasional slow ticks don't
    // accumulate drift across a long-running transfer.
    nextFrameAt = (nextFrameAt || timestamp) + frameDuration;
    if (timestamp - nextFrameAt > frameDuration) nextFrameAt = timestamp + frameDuration;
  }
  rafId = window.requestAnimationFrame(playbackTick);
}

function startPlayback() {
  if (!frameImages.length) return;
  playing = true;
  frameIndex = 0;
  nextFrameAt = 0;
  rafId = window.requestAnimationFrame(playbackTick);
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
    frameImages = await buildFrameImages(frames, (done, total) => {
      setStatus(`Готовим QR-кадры: ${done} из ${total}...`);
    });
    startedAt = Date.now();
    stopButton.disabled = false;
    setStatus(`Передача идет · ${frames.length} QR-кадров`);
    startPlayback();
  } catch (error) {
    stopTransfer();
    setStatus(error instanceof Error ? error.message : 'Не удалось подготовить файл', 'error');
  }
});

stopButton.addEventListener('click', () => stopTransfer());