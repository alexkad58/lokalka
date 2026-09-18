import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from '../client/node_modules/vite/dist/node/index.js';

const root = resolve(import.meta.dirname, '..');
const offlineRoot = resolve(root, 'offline');
const outputDir = resolve(offlineRoot, '.generated');

await build({
  root: offlineRoot,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: resolve(offlineRoot, 'sender.html'),
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'sender.js',
        assetFileNames: 'sender.[ext]'
      }
    }
  }
});

const generatedHtmlPath = resolve(outputDir, 'sender.html');
let html = await readFile(generatedHtmlPath, 'utf8');
const scriptMatch = html.match(/<script type="module"[^>]+src="([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);

if (!scriptMatch || !styleMatch) throw new Error('Could not find generated sender assets');

const scriptPath = resolve(outputDir, scriptMatch[1].replace(/^\/+/, ''));
const stylePath = resolve(outputDir, styleMatch[1].replace(/^\/+/, ''));
const workerPath = resolve(root, 'client/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const script = await readFile(scriptPath, 'utf8');
const style = await readFile(stylePath, 'utf8');
const worker = await readFile(workerPath, 'utf8');
const encodedScript = Buffer.from(script, 'utf8').toString('base64');
const encodedWorker = Buffer.from(worker, 'utf8').toString('base64');
const bootstrapScript = `if(typeof Promise.withResolvers!=='function'){Promise.withResolvers=()=>{let resolve;let reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};}const decode=b=>Uint8Array.from(atob(b),char=>char.charCodeAt(0));const workerUrl=URL.createObjectURL(new Blob([decode('${encodedWorker}')],{type:'text/javascript'}));globalThis.__txqrPdfWorkerSrc=workerUrl;const url=URL.createObjectURL(new Blob([decode('${encodedScript}')],{type:'text/javascript'}));import(url).finally(()=>URL.revokeObjectURL(url));`;

html = html
  .replace(scriptMatch[0], `<script type="module">${bootstrapScript}</script>`)
  .replace(styleMatch[0], `<style>${style}</style>`);

const finalPath = resolve(offlineRoot, 'txqr-sender.html');
await writeFile(finalPath, html, 'utf8');
await rm(outputDir, { recursive: true, force: true });

console.log(`Built ${finalPath}`);