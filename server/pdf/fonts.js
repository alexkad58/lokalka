import { existsSync } from 'node:fs';

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/Library/Fonts/Arial.ttf'
];

export function configurePdfFont(document) {
  const fontPath = FONT_CANDIDATES.find(candidate => existsSync(candidate));
  if (fontPath) document.font(fontPath);
}
