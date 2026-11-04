// Asserts every captured hook fixture carries the fields docs/EVENT_SCHEMA.md maps from.
// Usage: node spikes/check-fixtures.mjs   (exit 1 on any mismatch)
import fs from 'node:fs';
import path from 'node:path';

const COMMON = ['session_id', 'hook_event_name', 'cwd'];
const REQUIRED = {
  UserPromptSubmit: ['prompt'],
  PreToolUse: ['tool_name', 'tool_input', 'tool_use_id'],
  PostToolUse: ['tool_name', 'tool_input', 'tool_use_id', 'tool_response'],
  PostToolUseFailure: ['tool_name', 'tool_input', 'tool_use_id', 'error'],
  PermissionRequest: ['tool_name', 'tool_input'],
  SubagentStart: ['agent_id', 'agent_type'],
  SubagentStop: ['agent_id', 'agent_type', 'last_assistant_message'],
  TaskCreated: ['task_id', 'task_subject'],
  TaskCompleted: ['task_id', 'task_subject'],
  Stop: ['last_assistant_message'],
  SessionEnd: ['reason'],
};
const FORBIDDEN = { PermissionRequest: ['tool_use_id'] }; // docs + spike S4: never present

const root = path.resolve('spikes/fixtures');
const errors = [];
let checked = 0;
for (const dir of fs.readdirSync(root)) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json') && !f.startsWith('otlp-'))) {
    const j = JSON.parse(fs.readFileSync(path.join(root, dir, f), 'utf8'));
    const ev = j.hook_event_name;
    for (const k of [...COMMON, ...(REQUIRED[ev] ?? [])]) if (!(k in j)) errors.push(`${dir}/${f}: missing ${k}`);
    for (const k of FORBIDDEN[ev] ?? []) if (k in j) errors.push(`${dir}/${f}: unexpected ${k}`);
    // subagent attribution rule: agent_id present <=> event came from inside a subagent
    if (ev === 'SubagentStart' && !j.agent_id) errors.push(`${dir}/${f}: SubagentStart without agent_id`);
    checked++;
  }
}
console.log(`checked ${checked} hook fixtures, ${errors.length} problems`);
errors.forEach((e) => console.log('  ' + e));
process.exitCode = errors.length ? 1 : 0;
