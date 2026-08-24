#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const PROTOCOL_VERSION = '2025-11-25';
const CLIENT_INFO = { name: 'neolesk-diagrams-skill', version: '1.0.0' };

const usage = `Usage:
  neolesk-mcp.mjs <mcp-url> tools
  neolesk-mcp.mjs <mcp-url> get
  neolesk-mcp.mjs <mcp-url> set-language <language>
  neolesk-mcp.mjs <mcp-url> set-source <file|->
  neolesk-mcp.mjs <mcp-url> set-renderer-options <json|file>
  neolesk-mcp.mjs <mcp-url> view
  neolesk-mcp.mjs <mcp-url> set-view <json|file>
  neolesk-mcp.mjs <mcp-url> render [--output <svg-file>]
  neolesk-mcp.mjs <mcp-url> export <svg|png|jpeg|pdf> --output <file>
  neolesk-mcp.mjs <mcp-url> snapshot
  neolesk-mcp.mjs <mcp-url> undo
  neolesk-mcp.mjs <mcp-url> close --confirm-close

Set NEOLESK_MCP_URL instead of passing <mcp-url> to keep the capability out of command text.`;

const fail = (message) => {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
};

const readStdin = async () => {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
};

const readJsonValue = async (value) => {
    if (!value) throw new Error('A JSON object or JSON file is required');
    const text = value.trim().startsWith('{') ? value : await readFile(value, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object');
    }
    return parsed;
};

const parseInvocation = () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) return { help: true };

    const environmentUrl = process.env.NEOLESK_MCP_URL;
    const endpoint = environmentUrl || args.shift();
    const command = args.shift();
    if (!endpoint || !command) throw new Error(usage);

    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.includes('/mcp/')) {
        throw new Error('Expected an HTTP(S) neolesk /mcp/<capability> URL');
    }
    return { endpoint: url.href, command, args };
};

let requestId = 0;
const rpc = async (endpoint, method, params = {}) => {
    requestId += 1;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'mcp-protocol-version': PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
    }
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return payload?.result;
};

const initialize = async (endpoint) => rpc(endpoint, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
});

const decodeToolPayload = (result) => {
    if (result?.structuredContent && typeof result.structuredContent === 'object') {
        return result.structuredContent;
    }
    const text = result?.content?.find((item) => item.type === 'text')?.text;
    if (text) {
        try { return JSON.parse(text); } catch { return { text }; }
    }
    return {};
};

const callTool = async (endpoint, name, args = {}) => {
    const result = await rpc(endpoint, 'tools/call', { name, arguments: args });
    const payload = decodeToolPayload(result);
    if (result?.isError) throw new Error(payload.error || JSON.stringify(payload));
    return { result, payload };
};

const outputPath = (args) => {
    const index = args.indexOf('--output');
    if (index === -1 || !args[index + 1]) return undefined;
    return args[index + 1];
};

const printJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const summarizeRender = (payload, writtenTo) => {
    const { data, ...summary } = payload;
    return {
        ...summary,
        ...(typeof data === 'string' ? { byteLength: Buffer.byteLength(data) } : {}),
        ...(writtenTo ? { writtenTo } : {}),
    };
};

const writeExport = async (result, payload, destination) => {
    if (!destination) throw new Error('export requires --output <file>');
    let bytes;
    const textData = typeof payload.data === 'string' ? payload.data : undefined;
    const image = result.content?.find((item) => item.type === 'image');
    const resource = result.content?.find((item) => item.type === 'resource');
    if (textData) bytes = Buffer.from(textData, 'utf8');
    else if (image?.data) bytes = Buffer.from(image.data, 'base64');
    else if (resource?.resource?.blob) bytes = Buffer.from(resource.resource.blob, 'base64');
    else throw new Error('The export response did not contain file data');
    await writeFile(destination, bytes);
    return { format: payload.format, mimeType: payload.mimeType, byteLength: bytes.byteLength, writtenTo: destination };
};

const main = async () => {
    const invocation = parseInvocation();
    if (invocation.help) {
        process.stdout.write(`${usage}\n`);
        return;
    }
    const { endpoint, command, args } = invocation;
    await initialize(endpoint);

    if (command === 'tools') {
        const result = await rpc(endpoint, 'tools/list');
        printJson(result.tools);
        return;
    }
    if (command === 'get') {
        printJson((await callTool(endpoint, 'get_session')).payload);
        return;
    }
    if (command === 'set-language') {
        if (!args[0]) throw new Error('set-language requires a language');
        printJson((await callTool(endpoint, 'set_language', { language: args[0] })).payload);
        return;
    }
    if (command === 'set-source') {
        if (!args[0]) throw new Error('set-source requires a file path or - for stdin');
        const source = args[0] === '-' ? await readStdin() : await readFile(args[0], 'utf8');
        printJson((await callTool(endpoint, 'set_source', { source })).payload);
        return;
    }
    if (command === 'set-renderer-options') {
        const options = await readJsonValue(args[0]);
        printJson((await callTool(endpoint, 'set_renderer_options', { options })).payload);
        return;
    }
    if (command === 'view') {
        printJson((await callTool(endpoint, 'get_view_settings')).payload);
        return;
    }
    if (command === 'set-view') {
        printJson((await callTool(endpoint, 'set_view_settings', await readJsonValue(args[0]))).payload);
        return;
    }
    if (command === 'render') {
        const destination = outputPath(args);
        const { payload } = await callTool(endpoint, 'render', { format: 'svg' });
        if (destination) {
            if (typeof payload.data !== 'string') throw new Error('Render response did not contain SVG data');
            await writeFile(destination, payload.data, 'utf8');
        }
        printJson(summarizeRender(payload, destination));
        return;
    }
    if (command === 'export') {
        const format = args[0];
        if (!['svg', 'png', 'jpeg', 'pdf'].includes(format)) throw new Error('export requires svg, png, jpeg, or pdf');
        const { result, payload } = await callTool(endpoint, 'export', { format });
        printJson(await writeExport(result, payload, outputPath(args)));
        return;
    }
    if (command === 'snapshot') {
        printJson((await callTool(endpoint, 'create_snapshot_link')).payload);
        return;
    }
    if (command === 'undo') {
        printJson((await callTool(endpoint, 'undo_last_agent_write')).payload);
        return;
    }
    if (command === 'close') {
        if (!args.includes('--confirm-close')) throw new Error('Refusing to close without --confirm-close');
        printJson((await callTool(endpoint, 'close_session')).payload);
        return;
    }
    throw new Error(`Unknown command ${command}\n\n${usage}`);
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
