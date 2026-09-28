#!/usr/bin/env node
// Atomically merge confirmed lane choices; never silently reset existing keys.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, unlinkSync, chmodSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const catalog=JSON.parse(readFileSync(join(root,'config/models.json'),'utf8')).lanes;
const choicesPath=process.argv[2];
const target=process.argv[3] ?? join(homedir(),'.claude/fable-advisor/lanes.json');
if (!choicesPath) throw new Error('Usage: save-lanes.mjs CONFIRMED_CHOICES_JSON [TARGET_LANES_JSON]');
const choices=JSON.parse(readFileSync(choicesPath,'utf8'));
const current=existsSync(target)?JSON.parse(readFileSync(target,'utf8')):{};
if (current.version !== undefined && ![1,2].includes(current.version)) throw new Error(`Unsupported existing config version ${current.version}`);
const next={...current,version:2};
for (const [name,lane] of Object.entries(catalog)) {
  const choice=choices[name];
  if (!choice || choice.provider!==lane.provider || typeof choice.model!=='string' || !choice.model.trim()) throw new Error(`Invalid confirmed ${name} choice`);
  if (name==='broad' && choice.model==='gemini-3.8-flash') throw new Error('Legacy Gemini CLI slug: explicitly choose an Antigravity model from agy models; existing configuration was not changed');
  if ((name==='routine'||name==='complex') && (typeof choice.effort!=='string' || !choice.effort.trim())) throw new Error(`Missing ${name} effort`);
  const known=lane.options.find(o=>o.id===choice.model);
  if (known?.efforts && !known.efforts.includes(choice.effort)) throw new Error(`Unsupported ${name} effort ${choice.effort}`);
  next[name]={...(current[name]??{}),provider:lane.provider,model:choice.model};
  if (name==='routine'||name==='complex') next[name].effort=choice.effort;
  else delete next[name].effort;
}
const dir=dirname(target); mkdirSync(dir,{recursive:true,mode:0o700});
const temp=join(dir,`.lanes.${process.pid}.${Date.now()}.tmp`);
const backup=existsSync(target)?`${target}.backup-${Date.now()}-${process.pid}`:null;
try {
  writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});
  JSON.parse(readFileSync(temp,'utf8'));
  if (backup) { copyFileSync(target,backup,constants.COPYFILE_EXCL); chmodSync(backup,0o600); }
  renameSync(temp,target);
} catch (error) { try { unlinkSync(temp); } catch {} throw error; }
console.log(JSON.stringify({target,backup,version:2}));
