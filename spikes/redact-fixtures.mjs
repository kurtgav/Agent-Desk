// Redacts account identifiers from captured OTLP fixtures in place (hook payloads carry none).
// Usage: node spikes/redact-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';

const SECRET_KEYS = new Set(['user.email', 'user.account_uuid', 'user.account_id', 'organization.id', 'user.id', 'prompt', 'prompt_text']);
const root = path.resolve('spikes/fixtures');

const scrub = (node) => {
  if (Array.isArray(node)) return node.forEach(scrub);
  if (!node || typeof node !== 'object') return;
  if (typeof node.key === 'string' && node.value && SECRET_KEYS.has(node.key)) node.value = { stringValue: 'REDACTED' };
  Object.values(node).forEach(scrub);
};

let n = 0;
for (const dir of fs.readdirSync(root)) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((f) => f.startsWith('otlp-'))) {
    const p = path.join(root, dir, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    scrub(j);
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    n++;
  }
}
const leaks = [];
for (const dir of fs.readdirSync(root))
  for (const f of fs.readdirSync(path.join(root, dir)))
    if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(fs.readFileSync(path.join(root, dir, f), 'utf8'))) leaks.push(`${dir}/${f}`);
console.log(`redacted ${n} OTLP files; email-like strings left in: ${leaks.length ? leaks.join(', ') : 'none'}`);
process.exitCode = leaks.length ? 1 : 0;
