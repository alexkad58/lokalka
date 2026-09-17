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
const script = await readFile(scriptPath, 'utf8');
const style = await readFile(stylePath, 'utf8');

html = html
  .replace(scriptMatch[0], `<script type="module">${script}</script>`)
  .replace(styleMatch[0], `<style>${style}</style>`);

const finalPath = resolve(offlineRoot, 'txqr-sender.html');
await writeFile(finalPath, html, 'utf8');
await rm(outputDir, { recursive: true, force: true });

console.log(`Built ${finalPath}`);