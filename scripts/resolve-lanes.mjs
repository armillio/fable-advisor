#!/usr/bin/env node
// Read-only lane resolution for version-1 and version-2 user configuration.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLanes } from './validate-lanes.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(readFileSync(join(root, 'config/models.json'), 'utf8')).lanes;
const path = process.argv[2] ?? join(homedir(), '.claude/fable-advisor/lanes.json');
const stored = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
validateLanes(stored, catalog);
const result = { version: stored.version ?? 2 };
for (const [name, lane] of Object.entries(catalog)) {
  const choice = stored[name] ?? {};
  if (choice.provider && choice.provider !== lane.provider) {
    throw new Error(`Incompatible provider for ${name}: ${choice.provider}`);
  }
  result[name] = { provider: lane.provider, model: choice.model ?? lane.recommended };
  if (name === 'broad' && choice.model === 'gemini-3.8-flash') {
    console.error('Broad lane retains a legacy Gemini CLI slug. Run setup to confirm an Antigravity model slug; no config was changed.');
  }
  if (name === 'routine' || name === 'complex') {
    const model = lane.options.find(option => option.id === result[name].model);
    const effort = choice.effort ?? model?.default_effort;
    if (effort === undefined) {
      throw new Error(`Custom ${name} model requires an explicit effort; run setup to confirm a supported pairing. No config was changed.`);
    }
    result[name].effort = effort;
  }
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
