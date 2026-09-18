import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const rootDir = process.cwd();
const mdPath = path.join(rootDir, 'docs', 'user-guide-lokalka-full.md');
const assetsDir = path.join(rootDir, 'docs', 'guide-assets');
const pdfOutputPath = path.join(rootDir, 'docs', 'user-guide-lokalka-full.pdf');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function toFileUri(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((#[^)]+)\)/g, '<a href="$2">$1</a>');
}

function mdToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  let listBuffer = null; // { type: 'ul'|'ol', items: [] }

  function flushList() {
    if (listBuffer) {
      html.push(`<${listBuffer.type}>${listBuffer.items.map(it => `<li>${renderInline(it)}</li>`).join('')}</${listBuffer.type}>`);
      listBuffer = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { flushList(); i++; continue; }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugify(text);
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i++; continue;
    }

    if (/^---+$/.test(line.trim())) { flushList(); html.push('<hr/>'); i++; continue; }

    if (/^<img /.test(line.trim())) {
      flushList();
      html.push(`<div class="img-wrap">${line.trim()}</div>`);
      i++; continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      html.push(`<blockquote>${renderInline(quoteMatch[1])}</blockquote>`);
      i++; continue;
    }

    const ulMatch = line.match(/^\s*-\s+(.*)$/);
    if (ulMatch) {
      if (!listBuffer || listBuffer.type !== 'ul') { flushList(); listBuffer = { type: 'ul', items: [] }; }
      listBuffer.items.push(ulMatch[1]);
      i++; continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!listBuffer || listBuffer.type !== 'ol') { flushList(); listBuffer = { type: 'ol', items: [] }; }
      listBuffer.items.push(olMatch[1]);
      i++; continue;
    }

    flushList();
    const boldLineMatch = line.match(/^\*\*([^*]+)\*\*$/);
    if (boldLineMatch) {
      html.push(`<p><strong>${renderInline(boldLineMatch[1])}</strong></p>`);
      i++; continue;
    }

    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }
  flushList();
  return html.join('\n');
}

const markdown = readFileSync(mdPath, 'utf8');
const bodyHtml = mdToHtml(markdown);

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 18mm 16mm; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.55;
    color: #1a1a1a;
  }
  h1 { font-size: 22px; margin: 0 0 10px; page-break-after: avoid; }
  h2 { font-size: 17px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; page-break-after: avoid; }
  h3 { font-size: 14px; margin: 14px 0 6px; page-break-after: avoid; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
  code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; font-family: "Consolas", monospace; font-size: 11px; }
  blockquote { margin: 8px 0; padding: 6px 12px; background: #fff8e6; border-left: 3px solid #e0a800; }
  a { color: #1a5fb4; text-decoration: none; }
  strong { color: #111; }
  .img-wrap { text-align: center; margin: 10px 0; page-break-inside: avoid; }
  .img-wrap img { border: 1px solid #ddd; border-radius: 8px; max-width: 260px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const tempHtmlPath = path.join(rootDir, 'docs', '.user-guide-full.tmp.html');
writeFileSync(tempHtmlPath, html, 'utf8');

async function main() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!existsSync(edgePath)) {
    throw new Error(`Edge not found at ${edgePath}`);
  }

  const edgeProc = spawn(edgePath, [
    '--remote-debugging-port=9227',
    '--headless',
    '--disable-gpu',
    '--user-data-dir=C:\\Windows\\Temp\\edge-guide-pdf-profile'
  ], { detached: true });

  await new Promise(r => setTimeout(r, 1500));

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9227' });
  const page = await browser.newPage();
  await page.goto(toFileUri(tempHtmlPath), { waitUntil: 'networkidle0' });
  await page.pdf({
    path: pdfOutputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' }
  });
  await browser.disconnect();
  try { process.kill(edgeProc.pid); } catch { /* ignore */ }

  console.log('PDF generated at', pdfOutputPath);
}

main().catch(err => { console.error(err); process.exit(1); });
