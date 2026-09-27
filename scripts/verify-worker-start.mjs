import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
    throw new Error('test:worker requires POSIX process-group signaling and is not supported on Windows.');
}

const port = 8800 + Math.floor(Math.random() * 400);
const origin = `http://127.0.0.1:${port}`;
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port)], {
    cwd: process.cwd(),
    // Wrangler -> workerd is a process tree. Giving it its own POSIX process
    // group lets CI stop every descendant instead of leaving workerd holding
    // stdout/stderr open after Wrangler exits.
    detached: true,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const capture = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
};
worker.stdout.on('data', capture);
worker.stderr.on('data', capture);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const deadline = Date.now() + 30_000;
const terminateWorkerTree = (signal) => {
    try {
        if (worker.pid) process.kill(-worker.pid, signal);
        else worker.kill(signal);
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
            return error instanceof Error ? error : new Error(String(error));
        }
    }
    return null;
};

try {
    let configuration;
    while (Date.now() < deadline && !configuration) {
        if (worker.exitCode !== null) throw new Error(`Worker exited with code ${worker.exitCode}`);
        try {
            const response = await fetch(`${origin}/config.json`);
            if (response.ok) configuration = await response.json();
        } catch {
            await wait(250);
        }
    }
    if (!configuration) throw new Error('Worker did not become ready within 30 seconds');

    const probes = [
        // PlantUML must be first: Graphviz used to mask its fresh-isolate startup bug.
        { name: 'plantuml-fresh-isolate', language: 'plantuml', source: '@startuml\nAlice -> Bob\n@enduml' },
        {
            name: 'plantuml-catalog-default',
            language: 'plantuml',
            source: [
                'skinparam monochrome true',
                'skinparam ranksep 20',
                'skinparam dpi 150',
                'rectangle "Main" {',
                '  (main.view)',
                '  (singleton)',
                '}',
                'rectangle "Base" {',
                '  (base.component)',
                '  (component)',
                '  (model)',
                '}',
                '(component) ..> (base.component)',
                '(main.view) --> (component)',
            ].join('\n'),
        },
        {
            // The MIT build cannot include the C4 library. It must hand the source to the
            // render server (unreachable here) instead of reporting its error image as a render.
            name: 'c4plantuml-catalog-default',
            language: 'c4plantuml',
            source: [
                '@startuml',
                '!include C4_Context.puml',
                'title System Context diagram',
                'Person(customer, "Banking Customer")',
                'System(banking_system, "Internet Banking System")',
                'Rel(customer, banking_system, "Uses")',
                '@enduml',
            ].join('\n'),
            expectFallback: /cannot include C4_Context\.puml/,
        },
        {
            // A stdlib include used to leave the TeaVM thread waiting forever.
            name: 'c4plantuml-stdlib-include',
            language: 'c4plantuml',
            source: '@startuml\n!include <C4/C4_Context>\nPerson(customer, "Customer")\n@enduml',
            expectFallback: /line 2/,
        },
        { name: 'plantuml-after-include', language: 'plantuml', source: '@startuml\nBob -> Alice\n@enduml' },
        {
            // Salt is not in the MIT build, which draws a "not supported" picture instead.
            name: 'plantuml-salt',
            language: 'plantuml',
            source: '@startsalt\n{\n  [OK] | [Cancel]\n}\n@endsalt',
            expectFallback: /does not support @startsalt/,
        },
        { name: 'graphviz', language: 'graphviz', source: 'digraph { a -> b }' },
        { name: 'd2-dagre', language: 'd2', source: 'cluster: {\n  a\n}\ncluster.a -> b: labelled edge' },
        {
            name: 'd2-sketch',
            language: 'd2',
            source: 'a -> b\nc: {shape: circle}',
            options: { layout: 'dagre', sketch: 'true' },
        },
        { name: 'pikchr', language: 'pikchr', source: 'box "hello"' },
        { name: 'pikchr-invalid', language: 'pikchr', source: 'box "unterminated', expectLocalError: /unrecognized token/ },
        { name: 'svgbob', language: 'svgbob', source: '+---+\n| A |\n+---+' },
    ];
    for (const [index, { name, language, source, options, expectFallback, expectLocalError }] of probes.entries()) {
        const created = await fetch(`${origin}/api/sessions`, {
            method: 'POST',
            // One documentation-range client per probe keeps the probes under the
            // per-client session creation limit (10 each minute).
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${index + 1}` },
            body: JSON.stringify({ language, source }),
            signal: AbortSignal.timeout(45_000),
        });
        if (!created.ok) throw new Error(`Session cell returned HTTP ${created.status}: ${await created.text()}`);
        const session = await created.json();
        if (!/^[0-9a-f]{64}$/i.test(String(session.id))) throw new Error('Session cell returned an invalid identifier');
        if (options) {
            const set = await fetch(`${origin}/api/sessions/${session.id}/renderer-options/agent`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(options),
            });
            if (!set.ok) throw new Error(`${name} renderer options returned HTTP ${set.status}: ${await set.text()}`);
        }
        const startedAt = Date.now();
        const rendered = await fetch(`${origin}/api/sessions/${session.id}/render`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ participantId: 'agent', format: 'svg' }),
            signal: AbortSignal.timeout(45_000),
        });
        const body = await rendered.text();
        if (expectFallback || expectLocalError) {
            // No render server is reachable here, so a structured 422 is the correct outcome.
            const result = rendered.status === 422 ? JSON.parse(body) : null;
            const first = result?.diagnostics?.[0];
            const expected = expectFallback || expectLocalError;
            if (!first || first.kind !== 'fallback' || !expected.test(first.message)
                || (expectLocalError && result.code !== 'LOCAL_RENDER_FAILED')
                || Date.now() - startedAt > 20_000) {
                throw new Error(`${name} did not fail with a structured diagnostic: HTTP ${rendered.status} ${body.slice(0, 500)}`);
            }
            process.stdout.write(`Worker reported ${name} with a structured diagnostic.\n`);
            continue;
        }
        if (!rendered.ok) throw new Error(`${language} Worker render returned HTTP ${rendered.status}: ${body}`);
        const result = JSON.parse(body);
        if (result.provenance?.kind !== 'local' || !String(result.data).includes('<svg')) {
            throw new Error(`${language} did not render locally inside workerd: ${body.slice(0, 500)}`);
        }
        // A renderer can answer with a picture of its own error. That is not a render.
        const errorPicture = String(result.data).match(/Diagram not supported|Syntax Error\?|cannot include|ERROR:/);
        if (errorPicture) throw new Error(`${name} rendered an error picture ("${errorPicture[0]}") inside workerd`);
        process.stdout.write(`Worker rendered ${name} locally.\n`);
    }

    // The configured render server is unreachable here. The proxy must answer, not crash.
    const proxied = await fetch(`${origin}/render/mermaid/svg`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'graph TD\n  A --> B',
        signal: AbortSignal.timeout(45_000),
    });
    const proxiedBody = await proxied.text();
    if (proxied.status !== 502 || JSON.parse(proxiedBody).error !== 'Render server is unreachable') {
        throw new Error(`Unreachable render server returned HTTP ${proxied.status}: ${proxiedBody.slice(0, 300)}`);
    }
    const after = await fetch(`${origin}/config.json`, { signal: AbortSignal.timeout(10_000) });
    if (!after.ok) throw new Error(`Worker stopped answering after an unreachable render server (HTTP ${after.status})`);
    process.stdout.write('Worker answered an unreachable render server with a structured 502.\n');
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${output}\n`);
    process.exitCode = 1;
} finally {
    const exited = worker.exitCode !== null || worker.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => worker.once('exit', resolve));
    const cleanupError = terminateWorkerTree('SIGTERM');
    await Promise.race([
        exited,
        wait(3_000),
    ]);
    // The Wrangler leader can exit before workerd. Address the process group again,
    // then release the inherited pipes so an orphan cannot keep Node alive.
    const finalCleanupError = terminateWorkerTree('SIGKILL');
    worker.stdout.destroy();
    worker.stderr.destroy();
    worker.unref();
    if (cleanupError || finalCleanupError) {
        process.stderr.write(`${cleanupError?.message ?? finalCleanupError?.message}\n`);
        process.exitCode = 1;
    }
}
