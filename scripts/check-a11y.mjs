// Accessibility check (WCAG 2.1 AA) of every built page with axe-core in a headless browser.
// Usage: npm run build && node scripts/check-a11y.mjs
// Set CHROME_PATH to use an installed Chrome instead of Playwright's own browser.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain', '.xml': 'application/xml' };

const server = createServer((req, res) => {
  let file = join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name === 'index.html' ? ['/' + relative(dist, dirname(p)).split('\\').join('/')] : [];
  });
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
let failures = 0;
for (const path of pages(dist)) {
  const url = base + (path.endsWith('/') ? path : path + '/');
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(url);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of result.violations) {
      failures++;
      console.error(`${path} @${width}px: ${v.id} – ${v.help} (${v.nodes.length} element(s))`);
    }
    await context.close();
  }
}
await browser.close();
server.close();
if (failures) { console.error(`\n${failures} accessibility problem(s).`); process.exit(1); }
console.log('Accessibility OK (WCAG 2.1 AA, mobile and desktop).');
