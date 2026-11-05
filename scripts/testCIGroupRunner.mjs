import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Exercise the actual runner in an isolated fixture workspace, including two
// failures around a successful test. No application state or real suite changes.
mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(path.resolve('tmp/ci-runner-'));
mkdirSync(path.join(dir, 'ci'));
copyFileSync('scripts/runCIGroup.mjs', path.join(dir, 'runner.mjs'));
writeFileSync(path.join(dir, 'ci/test-groups.json'), JSON.stringify({ fixture: ['fail-a.ts', 'pass.ts', 'fail-b.ts'] }));
writeFileSync(path.join(dir, 'fail-a.ts'), 'process.exitCode=1;');
writeFileSync(path.join(dir, 'fail-b.ts'), 'throw new Error("expected second failure");');
writeFileSync(path.join(dir, 'pass.ts'), 'import {writeFileSync} from "node:fs";writeFileSync("continued.txt","yes");');
const result = spawnSync(process.execPath, ['runner.mjs', 'fixture'], { cwd: dir, encoding: 'utf8', timeout: 120_000, windowsHide: true });
assert.ifError(result.error);
assert.equal(result.status, 1, result.stdout + result.stderr);
const results = JSON.parse(readFileSync(path.join(dir, 'artifacts/ci/fixture-results.json'), 'utf8'));
assert.deepEqual(results.map(r => r.exitCode), [1, 0, 1]);
assert(existsSync(path.join(dir, 'continued.txt')));
for (const row of results) assert(existsSync(path.join(dir, 'artifacts/ci', row.logFile)));
const unknown = spawnSync(process.execPath, ['runner.mjs', 'unknown'], { cwd: dir, encoding: 'utf8', timeout: 15_000, windowsHide: true });
assert.ifError(unknown.error);
assert.equal(unknown.status, 1);
assert.match(unknown.stderr, /Unknown CI group/);
console.log('PASS: both failures reported, intervening test executed, logs retained, unknown group rejected.');
