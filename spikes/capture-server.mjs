// M0 spike only: records hook + OTLP request bodies to disk and returns scripted replies.
// Usage: node spikes/capture-server.mjs port=47821 out=spikes/fixtures/s1 mode=ok|slow|allow|deny
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const port = Number(args.port ?? 47821);
const token = args.token ?? 'spike-token-0001';
const outDir = path.resolve(args.out ?? 'spikes/fixtures');
let mode = args.mode ?? 'ok';
const counts = {};
fs.mkdirSync(outDir, { recursive: true });
const log = fs.createWriteStream(path.join(outDir, '_requests.jsonl'), { flags: 'a' });

const decision = (behavior, extra = {}) => ({
  hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...extra } },
});

http
  .createServer((req, res) => {
    const t0 = Date.now();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // spike-only control endpoint, loopback-bound
      if (req.url.startsWith('/__mode')) {
        mode = new URL(req.url, 'http://x').searchParams.get('m');
        res.end(mode);
        return;
      }
      const isHook = req.url.startsWith('/hooks');
      if (req.headers.origin || (isHook && req.headers['x-agentdeck-token'] !== token)) {
        log.write(JSON.stringify({ t: t0, url: req.url, rejected: true }) + '\n');
        res.writeHead(403).end();
        return;
      }
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        json = { _raw: body };
      }
      const name = isHook ? (json.hook_event_name ?? 'unknown') : 'otlp-' + req.url.replace(/\W/g, '');
      counts[name] = (counts[name] ?? 0) + 1;
      fs.writeFileSync(path.join(outDir, `${name}-${counts[name]}.json`), JSON.stringify(json, null, 2));
      log.write(JSON.stringify({ t: t0, url: req.url, event: name, mode, ct: req.headers['content-type'] }) + '\n');
      const reply = (obj) => {
        res.writeHead(200, obj ? { 'content-type': 'application/json' } : {});
        res.end(obj ? JSON.stringify(obj) : '');
      };
      if (mode === 'slow' && name === 'PreToolUse') return setTimeout(() => reply(), 5000);
      if (mode === 'hold' && name === 'PermissionRequest') return setTimeout(() => (log.write(JSON.stringify({ t: Date.now(), released: name }) + '\n'), reply()), 8000);
      if (mode === 'allow' && name === 'PermissionRequest') return reply(decision('allow'));
      if (mode === 'deny' && name === 'PermissionRequest') return reply(decision('deny', { message: 'Rejected in AgentDeck' }));
      reply();
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`capture 127.0.0.1:${port} mode=${mode} out=${outDir}`));
