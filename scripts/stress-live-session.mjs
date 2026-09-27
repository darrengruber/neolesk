// Stress test for live sessions. It creates its own throwaway session and never
// touches another one. Real browsers (iPhone WebKit, iPad WebKit, desktop
// Chromium) join it while an agent writes through MCP, two humans type at the
// same time, and one browser drops off the network and comes back. Every phase
// checks that the server and every editor end on the same document.
//
// Usage: node scripts/stress-live-session.mjs <origin> [browsers=4] [writes=30]
//   origin: a full deployment with sessions, for example `wrangler dev --local`
//   (set --var KROKI_ORIGIN to a reachable render server) or production.
import { chromium, devices, webkit } from '@playwright/test';

const origin = process.argv[2];
const browserCount = Number(process.argv[3] || 4);
const writeCount = Number(process.argv[4] || 30);
const mcpUrl = (id) => `${origin}/mcp/${id}`;

let rpcId = 0;
const rpc = async (id, method, params = {}) => {
    const started = Date.now();
    const response = await fetch(mcpUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, ms: Date.now() - started, json, retryAfter: response.headers.get('retry-after') };
};
const initialized = new Set();
const mcp = async (id, name, args = {}) => {
    if (!initialized.has(id)) {
        await rpc(id, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stress', version: '0' } });
        initialized.add(id);
    }
    return rpc(id, 'tools/call', { name, arguments: args });
};
const payloadOf = (result) => result.json?.result?.structuredContent
    ?? JSON.parse(result.json?.result?.content?.find((item) => item.type === 'text')?.text || '{}');
const serverSource = async (id) => payloadOf(await mcp(id, 'get_session')).source;

const created = await (await fetch(`${origin}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'graphviz', source: 'digraph { start }' }),
})).json();
console.log(`session created (id hidden); ${browserCount} browsers, ${writeCount} agent writes`);

const profiles = [
    ['iphone-local', webkit, devices['iPhone 15 Pro'], 'local-only'],
    ['desktop-neolesk', chromium, { viewport: { width: 1440, height: 900 } }, 'neolesk'],
    ['iphone-neolesk', webkit, devices['iPhone 15 Pro'], 'neolesk'],
    ['desktop-local', chromium, { viewport: { width: 1280, height: 820 } }, 'local-only'],
    ['ipad-local', webkit, devices['iPad Mini'], 'local-only'],
    ['desktop-2', chromium, { viewport: { width: 1440, height: 900 } }, 'neolesk'],
];

const clients = [];
const openClient = async ([name, type, options, consent]) => {
    const browser = await type.launch();
    const context = await browser.newContext(options);
    await context.addInitScript((choice) => localStorage.setItem('neolesk:preferences:v3', JSON.stringify({
        appearance: 'light', editorWrapping: true, remoteRendering: choice,
        consentedRenderServer: choice === 'neolesk' ? `${location.origin}/render/` : null, transparency: 1,
    })), consent);
    const page = await context.newPage();
    const client = { name, browser, context, page, errors: [], sockets: 0, closes: 0 };
    page.on('pageerror', (error) => client.errors.push(`pageerror ${error.message.slice(0, 120)}`));
    page.on('console', (message) => { if (message.type() === 'error') client.errors.push(message.text().slice(0, 120)); });
    page.on('websocket', (socket) => { client.sockets += 1; socket.on('close', () => { client.closes += 1; }); });
    await page.goto(`${origin}/s/${created.id}`);
    await page.locator('.PreviewPanel, .cm-content').first().waitFor({ timeout: 30_000 });
    // The editor lives on the Code tab on a phone.
    const codeTab = page.getByRole('tab', { name: /^(Code|Editor)$/ });
    if (await codeTab.count()) await codeTab.click();
    await page.locator('.cm-content').waitFor({ timeout: 30_000 });
    clients.push(client);
    return client;
};
// CodeMirror keeps its view on the content element; read the whole document, not the drawn lines.
const editorSource = (client) => client.page.evaluate(() => document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString() ?? null);

const converge = async (label, expected, timeoutMs = 15_000) => {
    const started = Date.now();
    const pending = new Set(clients.filter((client) => client.online !== false));
    while (pending.size && Date.now() - started < timeoutMs) {
        for (const client of [...pending]) if ((await editorSource(client)) === expected) pending.delete(client);
        if (pending.size) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const ms = Date.now() - started;
    const failed = [...pending].map((client) => client.name);
    console.log(`${failed.length ? 'RED  ' : 'GREEN'} ${label}: ${failed.length ? `not converged after ${ms} ms: ${failed.join(', ')}` : `all converged in ${ms} ms`}`);
    return failed.length === 0;
};

let green = true;
for (const profile of profiles.slice(0, Math.min(2, browserCount))) await openClient(profile);

// Phase 1: agent burst.
const latencies = [];
const statuses = {};
let expected = '';
for (let index = 0; index < writeCount; index += 1) {
    expected = `digraph { start -> n${index} }`;
    const result = await mcp(created.id, 'set_source', { source: expected });
    latencies.push(result.ms);
    const key = result.json?.result?.isError
        ? `tool-error:${JSON.stringify(payloadOf(result)).slice(0, 80)}`
        : result.status === 200 ? '200' : `${result.status}${result.retryAfter ? ` retry-after=${result.retryAfter}` : ''}:${JSON.stringify(result.json).slice(0, 80)}`;
    statuses[key] = (statuses[key] || 0) + 1;
    // Phase 4: joiners arrive mid-stream.
    if (index === Math.floor(writeCount / 2)) for (const profile of profiles.slice(2, browserCount)) await openClient(profile);
}
latencies.sort((a, b) => a - b);
console.log(`agent writes: statuses ${JSON.stringify(statuses)}; latency p50 ${latencies[Math.floor(latencies.length / 2)]} ms, p95 ${latencies[Math.floor(latencies.length * 0.95)]} ms`);
const lastAccepted = await serverSource(created.id);
green = (await converge('agent burst + mid-stream joiners', lastAccepted)) && green;
if (lastAccepted !== expected) console.log(`note: server kept "${lastAccepted}", not the last write (rate limit or rejection)`);

// Phase 2: two humans type at the same time.
const [first, second] = clients;
const typeAtEnd = async (client, text) => {
    await client.page.locator('.cm-content').click();
    await client.page.keyboard.press('ControlOrMeta+End');
    await client.page.keyboard.type(text, { delay: 15 });
};
await Promise.all([typeAtEnd(first, ' /*A-typing*/'), typeAtEnd(second, ' /*B-typing*/')]);
await new Promise((resolve) => setTimeout(resolve, 1500));
const merged = await serverSource(created.id);
const bothKept = merged.includes('/*A-typing*/') && merged.includes('/*B-typing*/');
console.log(`${bothKept ? 'GREEN' : 'RED  '} concurrent typing: server has A=${merged.includes('/*A-typing*/')} B=${merged.includes('/*B-typing*/')}`);
green = bothKept && green;
green = (await converge('concurrent typing reaches every browser', merged)) && green;

// Phase 3: one browser drops off the network during edits, then returns.
const dropped = clients[clients.length - 1];
await dropped.context.setOffline(true);
dropped.online = false;
for (let index = 0; index < 5; index += 1) {
    expected = `digraph { offline_phase -> m${index} }`;
    await mcp(created.id, 'set_source', { source: expected });
}
await new Promise((resolve) => setTimeout(resolve, 3000));
await dropped.context.setOffline(false);
dropped.online = true;
green = (await converge(`${dropped.name} catches up after going offline`, await serverSource(created.id), 30_000)) && green;

for (const client of clients) {
    console.log(`  ${client.name}: websockets opened ${client.sockets}, closed ${client.closes}, errors ${client.errors.length ? JSON.stringify([...new Set(client.errors)].slice(0, 3)) : 'none'}`);
    await client.browser.close();
}
console.log(green ? 'OVERALL GREEN' : 'OVERALL RED');
process.exit(green ? 0 : 1);
