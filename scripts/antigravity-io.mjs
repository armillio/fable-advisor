#!/usr/bin/env node
// Small protocol adapter for agy 1.2.12. Never reads or copies credentials.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [command, ...args] = process.argv.slice(2);
const authError = /unauthenticated|authentication required|failed to sign in|not logged in|login required|UNSUPPORTED_CLIENT|IneligibleTierError|client is no longer supported|model.*(?:not available|not found|not supported|unknown)|unknown model|invalid.*model|quota exceeded|api.key/i;
const denied = /soft[- ]denied|permission denied|approval denied|requires? (?:user )?approval|denied.*(?:tool|permission)|(?:tool|permission).*denied|blocked by policy|operation not permitted|sandbox.*(?:denied|unavailable|not supported|failed)/i;
const report = (status, reason, response = '') => process.stdout.write(`${status}\n${reason}\n${response}\n`);
if (command === 'preflight') {
  const file = join(homedir(), '.gemini/antigravity-cli/settings.json');
  try {
    const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    if (settings.modelProvider === 'gemini' || process.env.GEMINI_API_KEY) {
      report('unavailable', 'Account-only lane: API-key configuration detected. Select account authentication in agy; no configuration was changed.');
      process.exit(1);
    }
    if (settings.toolPermission === 'always-proceed') {
      report('blocked', 'Unrestricted Antigravity permission preset detected; select request-review before using this lane.');
      process.exit(1);
    }
  } catch {
    report('blocked', 'Cannot safely read Antigravity settings; no configuration was changed.');
    process.exit(1);
  }
} else if (command === 'encode') {
  const spec = readFileSync(args[0], 'utf8');
  const instruction = 'Implement the delegated specification below in the current repository. Do not expand scope or change architecture. Do not bypass any denied tool. Report changes, verification evidence, and judgment calls. The caller independently runs the verification command after your implementation.\n\n';
  process.stdout.write(JSON.stringify({ event: 'user', message: { content: instruction + spec } }) + '\n');
} else if (command === 'decode') {
  const [outputFile, diagnosticFile, expectedModel] = args;
  const raw = readFileSync(outputFile, 'utf8');
  const diagnostics = readFileSync(diagnosticFile, 'utf8');
  let events;
  try { events = raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
  catch {
    const status = authError.test(diagnostics) ? 'unavailable' : denied.test(diagnostics) ? 'blocked' : 'partial';
    report(status, 'Missing or invalid Antigravity event stream', diagnostics);
    process.exit(0);
  }
  const results = events.filter(event => event.event === 'result');
  const init = events.find(event => event.event === 'init')?.init;
  const result = results.length === 1 ? results[0].result : undefined;
  const errors = events.map(event => event.step_update?.tool_info?.error ?? event.error ?? '').map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');
  const evidence = diagnostics + '\n' + errors + '\n' + JSON.stringify(result?.error ?? '');
  const response = result?.response ?? '';
  if (authError.test(evidence)) report('unavailable', 'Antigravity account or model access failed', evidence);
  else if (denied.test(evidence) || init?.permission_mode === 'always-proceed') report('blocked', 'Antigravity tool denied or unsafe permission mode; no bypass attempted', evidence);
  else if (result?.status === 'TIMEOUT' || /timed out|deadline exceeded/i.test(evidence)) report('timeout', 'Antigravity execution timed out', evidence);
  else if (!result || results.length !== 1) report('partial', 'Expected exactly one terminal result event', evidence);
  else if (init?.model !== expectedModel) report('unavailable', 'Antigravity did not confirm the requested model; refusing silent substitution', response);
  else if (result.status !== 'SUCCESS') report('partial', `Antigravity terminal status: ${result.status}`, response);
  else report('ready', 'Antigravity success; independent diff and verification still required', response);
} else {
  throw new Error('Usage: antigravity-io.mjs preflight | encode SPEC_FILE | decode OUTPUT DIAGNOSTICS MODEL');
}
