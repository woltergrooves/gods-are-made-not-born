// Copies static files next to the compiled JS so dist/ is a complete static site.
import { cpSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
if (!existsSync('dist/js/main.js')) { console.error('dist/js/main.js missing — run tsc first'); process.exit(1); }
const stamp = new Date().toISOString();
writeFileSync('dist/build.json', JSON.stringify({ name: 'gods-are-made-not-born', version: JSON.parse(readFileSync('package.json', 'utf8')).version, built: stamp }, null, 2));
console.log('dist ready', stamp);
