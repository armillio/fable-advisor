#!/usr/bin/env node
// Atomically merge confirmed lane choices; never silently reset existing keys.
import { readFileSync, lstatSync, fstatSync, openSync, closeSync, mkdirSync, rmdirSync, writeFileSync, renameSync, unlinkSync, constants } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLanes } from './validate-lanes.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const catalog=JSON.parse(readFileSync(join(root,'config/models.json'),'utf8')).lanes;
const choicesPath=process.argv[2];
const target=process.argv[3] ?? join(homedir(),'.claude/fable-advisor/lanes.json');
if (!choicesPath) throw new Error('Usage: save-lanes.mjs CONFIRMED_CHOICES_JSON [TARGET_LANES_JSON]');
const choices=JSON.parse(readFileSync(choicesPath,'utf8'));
validateLanes(choices,catalog);
const dir=dirname(target); mkdirSync(dir,{recursive:true,mode:0o700});
// Fail rather than queue a competing setup and overwrite its confirmed choices.
const lock=`${target}.lock`;
const owner=join(lock,'owner.json');
const temp=join(dir,`.lanes.${process.pid}.${Date.now()}.tmp`);
let ownsLock=false;
function cleanup() {
  if (!ownsLock) return;
  ownsLock=false;
  for (const [remove,path] of [[unlinkSync,temp],[unlinkSync,owner],[rmdirSync,lock]]) {
    try { remove(path); }
    catch (error) {
      if (error.code==='ENOENT') continue;
      console.error(`Setup cleanup failed for ${path}; inspect manually after confirming no setup is running.`);
      // Preserve signal/error status, but do not report a clean exit on failure.
      process.exitCode=process.exitCode || 1;
    }
  }
}
function readTarget() {
  let stat;
  try { stat=lstatSync(target); }
  catch (error) { if (error.code==='ENOENT') return null; throw error; }
  if (stat.isSymbolicLink()) throw new Error('Symlinked lane configuration is not supported; explicitly select its real file as the setup target. No link was replaced.');
  if (!stat.isFile()) throw new Error('Lane configuration target must be a regular file');
  if (constants.O_NOFOLLOW===undefined || constants.O_NONBLOCK===undefined) throw new Error('Safe file-open flags unavailable');
  const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const opened=fstatSync(fd);
    if (!opened.isFile() || opened.dev!==stat.dev || opened.ino!==stat.ino) throw new Error('Lane configuration changed during setup');
    return {raw:readFileSync(fd),dev:opened.dev,ino:opened.ino};
  } finally { closeSync(fd); }
}
// Synchronous filesystem operations finish before JS signal handlers run.
// Exit cleanup only removes this process's lock, never a competing writer's.
const signals={SIGINT:130,SIGTERM:143,SIGHUP:129};
const handlers=Object.entries(signals).map(([signal,code])=>[signal,()=>process.exit(code)]);
process.on('exit',cleanup);
for (const [signal,handler] of handlers) process.on(signal,handler);
try { mkdirSync(lock,{mode:0o700}); }
catch (error) {
  if (error.code==='EEXIST') throw new Error(`Lane configuration lock exists at ${lock}; inspect owner.json and confirm no setup is running before manual recovery. Reread and reconfirm choices before retrying.`);
  throw error;
}
ownsLock=true;
try {
  writeFileSync(owner,JSON.stringify({pid:process.pid,hostname:hostname(),started_at:new Date().toISOString(),temp})+'\n',{mode:0o600,flag:'wx'});
  // Give pending termination signals a chance to stop before reading/writing config.
  await setImmediate();
  const previous=readTarget();
  const current=previous?JSON.parse(previous.raw.toString('utf8')):{};
  validateLanes(current,catalog);
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
    // Broad/reviewer effort is not used by this plugin; preserve stored metadata.
  }
  const backup=previous?`${target}.backup-${Date.now()}-${process.pid}`:null;
  writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});
  JSON.parse(readFileSync(temp,'utf8'));
  if (backup) writeFileSync(backup,previous.raw,{mode:0o600,flag:'wx'});
  await setImmediate();
  const final=readTarget();
  if (Boolean(final)!==Boolean(previous) || (final && (final.dev!==previous.dev || final.ino!==previous.ino || !final.raw.equals(previous.raw)))) {
    throw new Error('Lane configuration changed during setup; reread and reconfirm choices before retrying');
  }
  renameSync(temp,target);
  console.log(JSON.stringify({target,backup,version:2}));
} finally {
  cleanup();
  process.off('exit',cleanup);
  for (const [signal,handler] of handlers) process.off(signal,handler);
}
