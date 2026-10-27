// Runs the compiled unit tests with Node's built-in test runner.
import { writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
writeFileSync('.test-build/package.json', '{"type":"module"}');
const files = readdirSync('.test-build/tests').filter((f) => f.endsWith('.test.js')).map((f) => `.test-build/tests/${f}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
