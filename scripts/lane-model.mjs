#!/usr/bin/env node
// Resolve one Codex lane to "model<TAB>effort<TAB>label<TAB>source" for codex-lane.sh.
// The model always comes from lane configuration; only the effort can be overridden,
// and an override must be one of the model's catalog efforts.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findModel } from './validate-lanes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(dirname(here), 'config/models.json'), 'utf8')).lanes;
const fail = message => { process.stderr.write(message + '\n'); process.exit(1); };
const [lane, override = ''] = process.argv.slice(2);
if (!['routine', 'complex', 'pr_review'].includes(lane)) fail(`Unknown Codex lane: ${JSON.stringify(lane)}`);

let resolved;
try {
  resolved = JSON.parse(execFileSync(process.execPath, [join(here, 'resolve-lanes.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[lane];
} catch (error) {
  fail(`Invalid lane configuration; no model substituted: ${(error.stderr || error.message).trim()}`);
}
const safe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const model = resolved.model;
if (!safe.test(model)) fail(`Configured ${lane} model has unsupported characters: ${JSON.stringify(model)}`);
const effort = override || resolved.effort;
if (!safe.test(effort)) fail(`Effort has unsupported characters: ${JSON.stringify(effort)}`);
const option = findModel(catalog, catalog[lane], model);
if (option?.efforts && !option.efforts.includes(effort)) fail(`effort ${effort} not supported by ${model}`);
process.stdout.write([model, effort, option?.label ?? model, override ? 'override' : 'config'].join('\t') + '\n');
