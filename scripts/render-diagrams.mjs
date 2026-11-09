/**
 * Renders the README diagrams (docs/images/diagrams/src/*.html) to PNG.
 * Icons are real Lucide SVGs, the same set the app uses.
 *
 *   npm run docs:diagrams        (CHROME_PATH overrides the browser)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Icons from 'lucide-react';
import { chromium } from 'playwright-core';

const root = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(root, '../docs/images/diagrams/src');
const OUT = path.resolve(root, '../docs/images/diagrams');
const only = process.argv.slice(2);

const missing = new Set();
const icon = (name) => {
  const C = Icons[name];
  if (!C) {
    missing.add(name);
    return '';
  }
  return renderToStaticMarkup(createElement(C, { strokeWidth: 2, 'aria-hidden': true }));
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.html'))) {
  const name = file.replace(/\.html$/, '');
  if (only.length && !only.includes(name)) continue;
  const html = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/<i data-icon="([A-Za-z0-9]+)"[^>]*><\/i>/g, (_, n) => icon(n));
  const tmp = path.join(SRC, `.render-${file}`);
  fs.writeFileSync(tmp, html);
  try {
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
    });
    await page.locator('#d').screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
    console.log(`  ✔ ${name}.png`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
await browser.close();
if (missing.size) console.log(`  ! missing icons: ${[...missing].join(', ')}`);
