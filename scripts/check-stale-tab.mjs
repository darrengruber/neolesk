// Does a tab opened before a deploy still load its lazy engines afterwards?
// It serves dist/ the way production does (a missing /assets/* file is a 404,
// any other unknown path answers index.html),
// opens an iPhone WebKit tab, then "deploys" a copy of the build in which every
// hashed asset has a new name, and renders Mermaid and D2 in the old tab.
// Build first: NEOLESK_CACHE_SKIP=1 npm run build && node scripts/check-stale-tab.mjs
import { createServer } from 'node:http';
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { webkit, devices } from '@playwright/test';

const A = 'dist'; const B = `${process.env.TMPDIR || '/tmp'}/neolesk-stale-tab-dist`;
rmSync(B, { recursive: true, force: true }); cpSync(A, B, { recursive: true });
const assets = readdirSync(join(B, 'assets'));
const renames = new Map(assets.filter((f) => /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(f)).map((f) => [f, f.replace(/(\.[a-z0-9]+)$/, 'N$1')]));
for (const [from, to] of renames) renameSync(join(B, 'assets', from), join(B, 'assets', to));
const rewrite = (file) => { let s = readFileSync(file, 'utf8'); for (const [from, to] of renames) s = s.split(from).join(to); writeFileSync(file, s); };
rewrite(join(B, 'index.html'));
for (const f of readdirSync(join(B, 'assets'))) if (/\.(js|css|html)$/.test(f)) rewrite(join(B, 'assets', f));

let root = A;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, path);
  if (path.endsWith('/') || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback, as production
  if (path.startsWith('/assets/') && file.endsWith('index.html')) { res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('Not found\n'); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(8991);

const b = await webkit.launch(); const ctx = await b.newContext(devices['iPhone 15 Pro']);
await ctx.addInitScript(() => localStorage.setItem('neolesk:preferences:v3', JSON.stringify({ appearance: 'light', editorWrapping: true, remoteRendering: 'local-only', consentedRenderServer: null, transparency: 1 })));
const p = await ctx.newPage(); let reloads = 0;
p.on('framenavigated', (frame) => { if (frame === p.mainFrame()) reloads += 1; });
await p.goto('http://127.0.0.1:8991/'); await p.getByRole('button', { name: /^Diagram language:/ }).waitFor({ timeout: 60000 }); await p.waitForTimeout(1000);
root = B; // the deploy happens while the tab stays open
let red = false;
for (const language of ['Mermaid', 'D2']) {
  await p.getByRole('button', { name: /^Diagram language:/ }).click();
  await p.getByRole('searchbox', { name: 'Search languages' }).fill(language);
  await p.getByText(language, { exact: true }).click();
  await p.getByRole('tab', { name: 'Preview' }).click();
  await p.waitForTimeout(20000);
  const outcome = {
    alert: await p.locator('.PreviewPanel [role=alert]').textContent({ timeout: 1000 }).catch(() => null),
    image: await p.locator('.PreviewPanel img').count(),
    preview: (await p.locator('.PreviewPanel').textContent({ timeout: 1000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 80),
    lang: await p.getByRole('button', { name: /^Diagram language:/ }).getAttribute('aria-label').catch(() => '?'),
  };
  const ok = !outcome.alert && outcome.image > 0 && outcome.lang.endsWith(language);
  red ||= !ok;
  console.log(`${ok ? 'GREEN' : 'RED  '} ${language} after deploy: ${outcome.alert ? 'error: ' + outcome.alert.replace('Can’t Render This Diagram', '').slice(0, 140) : outcome.image ? 'rendered' : 'no image: ' + outcome.preview} | ${outcome.lang} | page loads: ${reloads}`);
}
await b.close(); server.close(); rmSync(B, { recursive: true, force: true });
process.exit(red ? 1 : 0);
