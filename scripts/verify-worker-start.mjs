import { spawn } from 'node:child_process';

const port = 8800 + Math.floor(Math.random() * 400);
const origin = `http://127.0.0.1:${port}`;
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const worker = spawn(command, ['exec', '--', 'wrangler', 'dev', '--local', '--port', String(port)], {
    cwd: process.cwd(),
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
        },
        { name: 'graphviz', language: 'graphviz', source: 'digraph { a -> b }' },
        { name: 'd2-dagre', language: 'd2', source: 'cluster: {\n  a\n}\ncluster.a -> b: labelled edge' },
        { name: 'pikchr', language: 'pikchr', source: 'box "hello"' },
        { name: 'svgbob', language: 'svgbob', source: '+---+\n| A |\n+---+' },
    ];
    for (const { name, language, source } of probes) {
        const created = await fetch(`${origin}/api/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ language, source }),
            signal: AbortSignal.timeout(45_000),
        });
        if (!created.ok) throw new Error(`Session cell returned HTTP ${created.status}: ${await created.text()}`);
        const session = await created.json();
        if (!/^[0-9a-f]{64}$/i.test(String(session.id))) throw new Error('Session cell returned an invalid identifier');
        const rendered = await fetch(`${origin}/api/sessions/${session.id}/render`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ participantId: 'agent', format: 'svg' }),
            signal: AbortSignal.timeout(45_000),
        });
        const body = await rendered.text();
        if (!rendered.ok) throw new Error(`${language} Worker render returned HTTP ${rendered.status}: ${body}`);
        const result = JSON.parse(body);
        if (result.provenance?.kind !== 'local' || !String(result.data).includes('<svg')) {
            throw new Error(`${language} did not render locally inside workerd: ${body.slice(0, 500)}`);
        }
        process.stdout.write(`Worker rendered ${name} locally.\n`);
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${output}\n`);
    process.exitCode = 1;
} finally {
    worker.kill('SIGTERM');
    await Promise.race([
        new Promise((resolve) => worker.once('exit', resolve)),
        wait(3_000).then(() => worker.kill('SIGKILL')),
    ]);
}
