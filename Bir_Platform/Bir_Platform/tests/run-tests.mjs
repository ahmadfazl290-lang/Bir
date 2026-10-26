import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'tests/core.test.cjs',
  'tests/text-import.test.cjs',
  'tests/import-cards.test.cjs',
  'tests/deck-actions.test.cjs',
  'tests/speech.test.cjs',
  'tests/integration.test.cjs'
];
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
});
const stdout = result.stdout || '';
const stderr = result.stderr || '';
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
if (result.error) process.stderr.write(result.error.message + '\n');

const number = name => {
  const match = stdout.match(new RegExp('^# ' + name + ' (\\d+)', 'm'));
  return match ? Number(match[1]) : null;
};
const summary = {
  passed: result.status === 0 && !result.error,
  tests: number('tests'),
  pass: number('pass'),
  fail: number('fail'),
  skipped: number('skipped'),
  todo: number('todo'),
  node: process.version,
  files,
  browserTested: false,
  actualAudioDeviceTested: false,
  timestamp: new Date().toISOString()
};
const reports = resolve(root, '.test-results');
mkdirSync(reports, { recursive: true });
writeFileSync(resolve(reports, 'tests.tap'), stdout + stderr, 'utf8');
writeFileSync(resolve(reports, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
