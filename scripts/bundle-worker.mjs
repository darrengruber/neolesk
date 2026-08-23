import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const executable = resolve('node_modules/.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
const result = spawnSync(executable, ['deploy', '--dry-run', '--minify'], {
    cwd: process.cwd(),
    encoding: 'utf8',
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const match = output.match(/gzip:\s+([\d.]+)\s+KiB/i);
if (!match) throw new Error('Wrangler did not report the compressed Worker bundle size');

const compressedKiB = Number(match[1]);
const paidWorkerLimitKiB = 10 * 1024;
if (compressedKiB > paidWorkerLimitKiB) {
    throw new Error(`Compressed Worker bundle is ${compressedKiB.toFixed(2)} KiB; limit is ${paidWorkerLimitKiB} KiB`);
}
process.stdout.write(`Worker bundle size gate passed (${compressedKiB.toFixed(2)} KiB / ${paidWorkerLimitKiB} KiB).\n`);
