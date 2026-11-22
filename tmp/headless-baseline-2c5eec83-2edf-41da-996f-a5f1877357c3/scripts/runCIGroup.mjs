import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const groups = JSON.parse(readFileSync(new URL('./ci/test-groups.json', import.meta.url), 'utf8'));
const requested = process.argv[2] || 'all';
if (requested !== 'all' && !Object.hasOwn(groups, requested)) throw new Error(`Unknown CI group: ${requested}`);
const names = requested === 'all' ? Object.keys(groups) : [requested];
const output = path.resolve('artifacts/ci');
mkdirSync(output, { recursive: true });
let failed = false;
for (const name of names) {
  const results = [];
  for (const file of groups[name]) {
    console.log(`\n=== ${name}: ${file} ===`);
    let log = '';
    const started = Date.now();
    const exitCode = await new Promise(resolve => {
      const child = spawn(process.execPath, [require.resolve('tsx/cli'), file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', chunk => { log += chunk; target.write(chunk); });
      child.on('error', error => { log += String(error); console.error(error); resolve(1); });
      child.on('close', code => resolve(code ?? 1));
    });
    const logFile = `${name}-${path.basename(file)}.log`;
    writeFileSync(path.join(output, logFile), log);
    results.push({ file, exitCode, durationMs: Date.now() - started, logFile });
    if (exitCode !== 0) failed = true;
  }
  writeFileSync(path.join(output, `${name}-results.json`), JSON.stringify(results, null, 2) + '\n');
  console.table(results.map(({ file, exitCode }) => ({ test: path.basename(file), exitCode })));
}
// Every test runs, but any failure still makes the job red.
process.exitCode = failed ? 1 : 0;
