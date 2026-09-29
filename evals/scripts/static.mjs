#!/usr/bin/env node
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, chmodSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sanitize } from './sanitize.mjs';
import { validateLanes } from '../../scripts/validate-lanes.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = path => readFileSync(join(root, path), 'utf8');
const tests = [];
const check = (name, fn) => { try { fn(); tests.push([name, true]); } catch (error) { tests.push([name, false, error.message]); } };
const assert = (value, message) => { if (!value) throw new Error(message); };
const catalog = JSON.parse(read('config/models.json')).lanes;
const textFiles = ['README.md', 'commands/setup.md', 'skills/orchestration/SKILL.md', 'agents/luna-implementer.md', 'agents/sol-implementer.md', 'agents/gemini-implementer.md', 'agents/fable-advisor.md'];
for (const name of ['routine', 'broad', 'complex', 'reviewer']) {
  check(`catalog ${name}`, () => assert(catalog[name]?.options.some(o => o.id === catalog[name].recommended), `missing recommended ${name}`));
}
check('recommended model IDs', () => assert(catalog.routine.recommended === 'gpt-6-luna' && catalog.broad.recommended === 'gemini-3.8-flash-medium' && catalog.complex.recommended === 'gpt-6-sol' && catalog.reviewer.recommended === 'fable', 'wrong model mapping'));
check('effort preservation', () => assert(catalog.routine.options[0].default_effort === 'max' && catalog.complex.options[0].default_effort === 'high' && !('efforts' in catalog.broad.options[0]), 'invalid effort schema'));
check('all agents exist', () => { for (const name of ['luna','gemini','sol']) assert(existsSync(join(root, `agents/${name}-implementer.md`)), `missing ${name}`); });
check('Markdown frontmatter', () => { for (const file of textFiles.filter(f => f.endsWith('.md') && f !== 'README.md')) { const s = read(file); assert(/^---\n[\s\S]+?\n---\n/.test(s), file); assert(/^(name|description):/m.test(s), file); } });
check('JSON manifests', () => { for (const file of ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json','config/models.json','package.json']) JSON.parse(read(file)); });
check('behavior case JSON', () => { for (const group of ['routing','escalation','fallback','verification','review']) for (const file of readdirSync(join(root,'evals/cases',group)).filter(f=>f.endsWith('.json'))) { const value=JSON.parse(read(`evals/cases/${group}/${file}`)); assert(value.id && value.group && value.prompt && value.expected, file); } });
check('setup four lanes and safe migration', () => { const s=read('commands/setup.md'); for (const lane of Object.keys(catalog)) assert(s.includes(lane), lane); assert(/version.1/i.test(s) && /backup/i.test(s) && /atomically/i.test(s), 'migration'); });
check('orchestration capability names', () => { const s=read('skills/orchestration/SKILL.md'); for (const lane of Object.keys(catalog)) assert(s.includes('`'+lane+'`'), lane); assert(/Do not route by file count alone/i.test(s), 'file count'); });
check('stable report statuses', () => { for (const file of ['agents/luna-implementer.md','agents/sol-implementer.md','agents/gemini-implementer.md']) for (const status of ['complete','partial','timeout','unavailable','refused','blocked']) assert(read(file).includes(status), `${file}: ${status}`); });
check('no silent provider fallback', () => { for (const file of ['agents/luna-implementer.md','agents/sol-implementer.md','agents/gemini-implementer.md']) assert(/never.*(?:fallback|substitut)|no silent fallback/i.test(read(file)), file); });
check('Codex lanes retain model and sandbox flags', () => { assert(read('agents/luna-implementer.md').includes('--model gpt-6-luna') && read('agents/luna-implementer.md').includes('--sandbox workspace-write'), 'Luna command'); assert(read('agents/sol-implementer.md').includes('--model gpt-6-sol') && read('agents/sol-implementer.md').includes('--sandbox workspace-write'), 'Sol command'); });
check('reviewer read-only', () => { const s=read('agents/fable-advisor.md'); assert(/tools: Read, Grep, Glob/.test(s) && !/tools:.*(?:Write|Edit|Bash)/.test(s), 'reviewer tools'); });
check('final review gate', () => assert(/Do not report done before this final review/i.test(read('skills/orchestration/SKILL.md')), 'missing final gate'));
check('safe Gemini execution flags', () => { const s=read('scripts/gemini-lane.sh'); assert(s.includes('--sandbox --mode accept-edits') && s.includes('--input-format stream-json --output-format stream-json') && !s.includes('--dangerously-skip-permissions') && !s.includes(' --yolo') && !s.includes('danger-full-access'), 'unsafe flags'); });
check('deprecated IDs absent from active definitions', () => { for (const file of ['config/models.json','agents/luna-implementer.md','agents/sol-implementer.md','agents/gemini-implementer.md']) assert(!/gpt-5\.|gemini-2\./.test(read(file)), file); });

const temp = mkdtempSync(join(tmpdir(), 'fable-eval-'));
// Shared saver input is fixture setup, not a side effect of another check.
writeFileSync(join(temp,'choices.json'),JSON.stringify({
  routine:{provider:'openai',model:'gpt-6-luna',effort:'max'},
  broad:{provider:'google',model:'gemini-3.8-flash-medium'},
  complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},
  reviewer:{provider:'anthropic',model:'fable'}
}));
const basePath = '/usr/bin:/bin';
function run(command, args, opts={}) { return spawnSync(command, args, { encoding:'utf8', ...opts }); }
function fixture(mode, verify=['test','-f','output.txt'], options={}) {
  const dir=join(temp, mode+'-'+Math.random().toString(16).slice(2)); mkdirSync(dir);
  run('git',['init','-q',dir]); writeFileSync(join(dir,'README.md'),'fixture\n');
  run('git',['-C',dir,'add','README.md']); run('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const spec=join(dir,'spec.txt'); writeFileSync(spec,'OBJECTIVE: write output.txt\nVERIFICATION: '+verify.join(' ')+'\n');
  if (options.ignoredOutput) writeFileSync(join(dir,'.gitignore'),'output.txt\n');
  if (options.verifier) {
    writeFileSync(join(dir,'verify'),`#!/bin/sh\necho invoked >> "$HOME/verifier-calls"\n${options.verifier}\n`);
    chmodSync(join(dir,'verify'),options.verifierMode ?? 0o755);
  }
  const shim=join(dir,'shim'); mkdirSync(shim);
  const home=join(temp,'home-'+Math.random().toString(16).slice(2)); mkdirSync(home);
  const env={...process.env,HOME:home,PATH:shim+':'+basePath,SHIM_MODE:mode,TMPDIR:temp,FABLE_WORKDIR:dir};
  delete env.GEMINI_API_KEY;
  delete env.FABLE_GEMINI_MODEL;
  if (options.config !== undefined) {
    mkdirSync(join(home,'.claude/fable-advisor'),{recursive:true});
    writeFileSync(join(home,'.claude/fable-advisor/lanes.json'),JSON.stringify(options.config));
  }
  if (options.model !== undefined) env.FABLE_GEMINI_MODEL=options.model;
  env.FIXTURE_SECRET=options.secret ?? '';
  env.FIXTURE_LINK_TARGET=options.linkTarget ?? '';
  env.EXPECTED_MODEL=options.expectedModel ?? 'gemini-3.8-flash-medium';
  symlinkSync(process.execPath,join(shim,'node'));
  // Even if the obsolete client is available it must never be called.
  writeFileSync(join(shim,'gemini'),'#!/bin/sh\necho forbidden-fallback > fallback.txt\nexit 99\n'); chmodSync(join(shim,'gemini'),0o755);
  if (mode === 'legacy') env.FABLE_GEMINI_MODEL='gemini-3.8-flash';
  if (mode === 'api-env') env.GEMINI_API_KEY='fixture-not-a-real-key';
  if (mode === 'api-settings' || mode === 'unsafe-settings') {
    mkdirSync(join(home,'.gemini/antigravity-cli'),{recursive:true});
    writeFileSync(join(home,'.gemini/antigravity-cli/settings.json'),JSON.stringify(mode==='api-settings'?{modelProvider:'gemini'}:{toolPermission:'always-proceed'}));
  }
  if (mode !== 'missing') {
    const script=`#!${process.execPath}
const fs=require('fs');
if(process.argv.includes('--version')) { if(process.env.SHIM_MODE==='version-secret'){console.error(process.env.FIXTURE_SECRET);process.exit(1);} console.log('1.2.12'); process.exit(0); }
const mode=process.env.SHIM_MODE;
if(process.env.FIXTURE_SECRET) console.error(process.env.FIXTURE_SECRET);
const args=process.argv.slice(2);
for(const flag of ['--sandbox','--mode','--model','--print-timeout','--input-format','--output-format']) if(!args.includes(flag))throw Error('Missing flag '+flag);
if(args.includes('--approval-mode')||args.includes('--dangerously-skip-permissions')||args.includes('--disable-slash-commands')||args.includes('--prompt')) throw Error('Unsafe or incompatible flag');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(input.event!=='user'||!input.message.content.endsWith(fs.readFileSync('spec.txt','utf8')))throw Error('Spec was truncated');
const diagnostics={auth:'authentication required',authmethod:'API key required', 'unsupported-client':'This client is no longer supported', 'unsupported-code':'UNSUPPORTED_CLIENT',signin:'Failed to sign in',blocked:'blocked by policy',untrusted:'permission denied'};
if(diagnostics[mode]){console.error(diagnostics[mode]);process.exit(1);}
if(mode==='malformed'){console.log('not JSON');process.exit(0);}
const model=args[args.indexOf('--model')+1];
if(model!==process.env.EXPECTED_MODEL)throw Error('Configured model was not passed intact');
console.log(JSON.stringify({event:'init',init:{model:mode==='wrong-model'?'gemini-3.7-flash-medium':model,permission_mode:'request-review'}}));
if(mode==='soft-denial') {console.error('write_file was auto-denied');console.log(JSON.stringify({event:'step_update',step_update:{tool_info:{error:{type:'TOOL_ERROR',message:'user denied permission for write_file(note.txt)'}}}}));}
if(mode==='symlink-output')fs.symlinkSync(process.env.FIXTURE_LINK_TARGET,'output.txt');
else if(!['nochange','soft-denial','event-timeout'].includes(mode))fs.writeFileSync('output.txt','implemented');
console.log(JSON.stringify({event:'result',result:{status:mode==='event-timeout'?'TIMEOUT':mode==='error-event'?'ERROR':'SUCCESS',response:process.env.FIXTURE_SECRET || 'Fixture response'}}));
`;
    writeFileSync(join(shim,'agy'),script); chmodSync(join(shim,'agy'),0o755);
  }
  if (mode === 'timeout') { writeFileSync(join(shim,'gtimeout'),'#!/bin/sh\nexit 124\n'); chmodSync(join(shim,'gtimeout'),0o755); }
  options.prepare?.(dir);
  const result=run('bash',[join(root,'scripts/gemini-lane.sh'),spec,...(options.legacyVerify ? [verify.join(' ')] : ['--',...verify])],{cwd:dir,env,timeout:15000,killSignal:'SIGKILL'});
  return { ...result, dir, home };
}
for (const [mode,expected,verify] of [
  ['missing','unavailable'],['auth','unavailable'],['authmethod','unavailable'],['blocked','blocked'],['untrusted','blocked'],['nochange','refused'],
  ['unsupported-client','unavailable'],['unsupported-code','unavailable'],['signin','unavailable'],
  ['legacy','unavailable'],['api-env','unavailable'],['api-settings','unavailable'],['unsafe-settings','blocked'],['soft-denial','blocked'],['wrong-model','unavailable'],['event-timeout','timeout'],['malformed','partial'],['error-event','partial'],
  ['timeout','timeout'],['verifyfail','partial',['false']],['success','complete']
]) {
  check(`Gemini ${mode} → ${expected}`, () => { const r=fixture(mode,verify); assert(r.stdout.includes(`STATUS: ${expected}`), `observed ${r.stdout}\n${r.stderr}`); assert(!existsSync(join(r.dir,'fallback.txt')), 'old client fallback invoked'); if (expected !== 'complete') assert(r.status !== 0, 'non-complete exit 0'); if (mode==='missing') assert(!existsSync(join(r.dir,'output.txt')), 'fallback wrote file'); if (mode==='success') assert(r.stdout.includes('CHANGES:\noutput.txt') && r.stdout.includes('VERIFIED: test -f output.txt'), 'missing diff or evidence'); });
}
check('scanner streams Git path lists larger than 1 MiB and rejects incomplete results', () => {
  const dir=join(temp,'scan-large'); mkdirSync(dir);
  const shim=join(temp,'scan-git-shim'); mkdirSync(shim);
  const path='long-ü-path.txt'; writeFileSync(join(dir,path),'contents');
  const payload=(path+'\0').repeat(100000);
  assert(Buffer.byteLength(payload)>1024*1024,'fixture must exceed default exec buffer');
  const input=join(temp,'scan-paths'); writeFileSync(input,payload);
  const git=join(shim,'git');
  const scan=()=>run(process.execPath,[join(root,'scripts/worktree-manifest.mjs')],{cwd:dir,env:{...process.env,PATH:shim+':'+basePath},timeout:10000});
  writeFileSync(git,`#!/bin/sh\ncat '${input}'\n`); chmodSync(git,0o755);
  const large=scan();
  assert(large.status===0 && large.stdout.startsWith(path+'\tFILE:') && large.stdout.trim().split('\n').length===1,large.stdout+large.stderr);
  writeFileSync(git,`#!/bin/sh\ncat '${input}'\nexit 1\n`);
  const failed=scan(); assert(failed.status===1 && !failed.stdout,'partial Git output accepted');
  writeFileSync(input,path);
  writeFileSync(git,`#!/bin/sh\ncat '${input}'\n`);
  const truncated=scan(); assert(truncated.status===1 && !truncated.stdout,'unterminated Git path accepted');
  rmSync(git);
  const missing=run(process.execPath,[join(root,'scripts/worktree-manifest.mjs')],{cwd:dir,env:{...process.env,PATH:shim},timeout:3000});
  assert(missing.status===1 && !missing.stdout && missing.stderr.includes('Cannot safely fingerprint'),'spawn error not handled');
});
check('scanner keeps invalid UTF-8 paths byte-distinct from replacement characters', () => {
  const dir=join(temp,'scan-raw-bytes'); mkdirSync(dir);
  const shim=join(temp,'raw-git-shim'); mkdirSync(shim);
  const raw=Buffer.from([98,97,100,45,255]);
  // Some host filesystems reject these names; proxy only the filesystem calls.
  writeFileSync(join(dir,'raw-proxy'),'raw bytes');
  writeFileSync(join(dir,'replacement-proxy'),'replacement character');
  const hook=join(temp,'raw-path-hook.cjs');
  writeFileSync(hook,`const fs=require('node:fs');
for(const method of ['lstatSync','openSync']){const original=fs[method];fs[method]=function(path,...args){
if(Buffer.isBuffer(path)&&path.equals(Buffer.from([98,97,100,45,255])))path='raw-proxy';
else if(Buffer.isBuffer(path)&&path.equals(Buffer.from('bad-�')))path='replacement-proxy';
return original.call(this,path,...args);};}
require('node:module').syncBuiltinESMExports();`);
  const input=join(temp,'raw-paths');
  writeFileSync(input,Buffer.concat([raw,Buffer.from([0]),Buffer.from('bad-�\0')]));
  const git=join(shim,'git'); writeFileSync(git,`#!/bin/sh\ncat '${input}'\n`); chmodSync(git,0o755);
  const args=['--require',hook,join(root,'scripts/worktree-manifest.mjs')];
  const r=run(process.execPath,args,{cwd:dir,env:{...process.env,PATH:shim+':'+basePath},timeout:3000});
  assert(r.status===0,r.stdout+r.stderr);
  const rows=r.stdout.trim().split('\n');
  assert(rows.length===2 && rows.some(row=>row.startsWith('\\x62\\x61\\x64\\x2d\\xff\tFILE:')) && rows.some(row=>row.startsWith('bad-�\tFILE:')),'raw path was replaced or collided');
});
check('scanner fingerprints symlink identity without reading targets', () => {
  const dir=join(temp,'scan-links'); mkdirSync(dir); run('git',['init','-q',dir]);
  const outside=join(temp,'external-file'), fifo=join(temp,'external-fifo');
  writeFileSync(outside,'first external contents');
  assert(run('mkfifo',[fifo]).status===0,'cannot create FIFO fixture');
  symlinkSync(outside,join(dir,'tracked-link')); run('git',['-C',dir,'add','tracked-link']);
  symlinkSync(outside,join(dir,'untracked-link')); symlinkSync(fifo,join(dir,'fifo-link'));
  symlinkSync(join(temp,'does-not-exist'),join(dir,'broken-link'));
  const scan=()=>run(process.execPath,[join(root,'scripts/worktree-manifest.mjs')],{cwd:dir,timeout:3000,killSignal:'SIGKILL'});
  const before=scan(); assert(before.status===0,before.stderr);
  assert(before.stdout.trim().split('\n').every(line=>line.includes('\tLINK:')),'link treated as regular file');
  writeFileSync(outside,'different external contents');
  assert(scan().stdout===before.stdout,'scanner fingerprinted external content');
  rmSync(join(dir,'untracked-link')); symlinkSync(fifo,join(dir,'untracked-link'));
  const after=scan(); assert(after.status===0 && after.stdout!==before.stdout,'retargeted link was invisible');
  assert(!after.stdout.includes(outside) && !after.stdout.includes('external contents'),'target data exposed');
});
check('runner handles links to FIFOs both before and after implementation', () => {
  const fifo=join(temp,'runner-external-fifo'); assert(run('mkfifo',[fifo]).status===0,'FIFO fixture failed');
  const r=fixture('symlink-output',['test','-L','output.txt'],{linkTarget:fifo,prepare:dir=>symlinkSync(fifo,join(dir,'existing-link'))});
  assert(r.status===0 && r.stdout.includes('STATUS: complete') && r.stdout.includes('CHANGES:\noutput.txt'),r.stdout+r.stderr);
});
check('runner rejects tracked paths replaced by special files before model execution', () => {
  // Git does not enumerate new FIFOs; replacing a tracked file exercises the guard.
  const r=fixture('special-file',undefined,{prepare:dir=>{
    rmSync(join(dir,'README.md'));
    assert(run('mkfifo',[join(dir,'README.md')]).status===0,'FIFO fixture failed');
  }});
  assert(r.status!==0 && r.stdout.includes('STATUS: partial') && !existsSync(join(r.dir,'output.txt')),r.stdout+r.stderr);
});
check('scanner reports deletions and rejects symlinked tracked parents', () => {
  const dir=join(temp,'scan-parent'); mkdirSync(dir); run('git',['init','-q',dir]);
  mkdirSync(join(dir,'nested')); writeFileSync(join(dir,'nested','file'),'tracked');
  run('git',['-C',dir,'add','nested/file']); rmSync(join(dir,'nested'),{recursive:true});
  const scan=()=>run(process.execPath,[join(root,'scripts/worktree-manifest.mjs')],{cwd:dir,timeout:3000,killSignal:'SIGKILL'});
  const missing=scan(); assert(missing.status===0 && missing.stdout.includes('nested/file\tMISSING'),missing.stderr);
  const outside=join(temp,'outside-dir'); mkdirSync(outside); writeFileSync(join(outside,'file'),'outside');
  symlinkSync(outside,join(dir,'nested'));
  const linked=scan(); assert(linked.status!==0 && linked.stderr.includes('Cannot safely fingerprint'),linked.stdout+linked.stderr);
});
for(const kind of ['symlink','fifo']) check(`scanner rejects a leaf swapped to ${kind} before open`, () => {
  const dir=join(temp,'scan-swap-'+kind); mkdirSync(dir); run('git',['init','-q',dir]);
  writeFileSync(join(dir,'swap.txt'),'regular');
  const hook=join(temp,`swap-${kind}.cjs`);
  writeFileSync(hook,`const fs=require('node:fs'), cp=require('node:child_process'); const open=fs.openSync;
fs.openSync=function(path,...args){if((Buffer.isBuffer(path)?path.toString('utf8'):path)==='swap.txt'){fs.unlinkSync(path);
if(${JSON.stringify(kind)}==='symlink')fs.symlinkSync(${JSON.stringify(join(temp,'external-file'))},path);else cp.execFileSync('mkfifo',[path]);}
return open.call(this,path,...args);};require('node:module').syncBuiltinESMExports();`);
  const r=run(process.execPath,['--require',hook,join(root,'scripts/worktree-manifest.mjs')],{cwd:dir,timeout:3000,killSignal:'SIGKILL'});
  assert(r.status===1 && r.stderr.includes('Cannot safely fingerprint') && !r.stdout,r.stdout+r.stderr);
});
check('decoder classifies invalid event shapes without throwing', () => {
  const output=join(temp,'invalid-events.ndjson'), diagnostic=join(temp,'invalid-events.stderr');
  for (const event of [null,42,true,'text',[],{}, {event:null}]) {
    for (const [message,expected] of [['','partial'],['permission denied','blocked'],['authentication required','unavailable']]) {
      writeFileSync(output,JSON.stringify(event)+'\n'); writeFileSync(diagnostic,message);
      const r=run(process.execPath,[join(root,'scripts/antigravity-io.mjs'),'decode',output,diagnostic,'gemini-3.8-flash-medium']);
      assert(r.status===0 && r.stdout.startsWith(expected+'\n') && r.stdout.includes('invalid Antigravity event stream'),r.stdout+r.stderr);
      assert(!r.stderr.includes('TypeError'),'decoder threw instead of classifying');
    }
  }
});
check('API-key mentions are not authentication failures', () => {
  const output=join(temp,'auth-mentions.ndjson'), diagnostic=join(temp,'auth-mentions.stderr');
  const model='gemini-3.8-flash-medium';
  for(const [message,expected] of [
    ['Read optional api.key setting','ready'],['API key is not required for account login','ready'],
    ['api_key field is unset; using account credentials','ready'],
    ['API key required','unavailable'],['Invalid API key','unavailable'],['API key is expired','unavailable']
  ]) for(const channel of ['diagnostic','result.error']) {
    writeFileSync(output,[{event:'init',init:{model,permission_mode:'request-review'}},
      {event:'result',result:{status:'SUCCESS',response:'Finished',...(channel==='result.error'?{error:message}:{})}}].map(JSON.stringify).join('\n')+'\n');
    writeFileSync(diagnostic,channel==='diagnostic'?message:'');
    const r=run(process.execPath,[join(root,'scripts/antigravity-io.mjs'),'decode',output,diagnostic,model]);
    assert(r.status===0 && r.stdout.startsWith(expected+'\n'),`${channel}: ${message}: ${r.stdout}${r.stderr}`);
  }
});
check('ignored-only output does not claim completion or no filesystem changes', () => {
  const r=fixture('ignored-output',undefined,{ignoredOutput:true});
  assert(existsSync(join(r.dir,'output.txt')),'fixture produced no ignored edit');
  assert(r.status!==0 && r.stdout.includes('STATUS: refused') && r.stdout.includes('No reviewable diff') && r.stdout.includes('ignored-only edits require architect inspection'),r.stdout+r.stderr);
  assert(r.stdout.includes('not independently run'),'unreviewable change reached verification');
});
check('Codex preflight unavailable in isolated PATH', () => {
  const emptyPath=join(temp,'no-executables'); mkdirSync(emptyPath);
  const env={...process.env,PATH:emptyPath}; delete env.BASH_ENV; delete env.ENV;
  const r=run('/bin/bash',['--noprofile','--norc','-c','command -v codex >/dev/null 2>&1'],{env});
  assert(r.status===1,'isolated preflight did not report unavailable');
  for (const file of ['agents/luna-implementer.md','agents/sol-implementer.md']) assert(read(file).includes('STATUS: unavailable'),file);
});
check('version-1 custom choices preserved', () => { const path=join(temp,'lanes-v1.json'); writeFileSync(path,JSON.stringify({version:1,routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}})); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),path]); assert(r.status===0,r.stderr); const value=JSON.parse(r.stdout); assert(value.broad.model==='gemini-3.8-flash-medium' && value.routine.model==='custom-luna' && value.routine.effort==='low' && value.reviewer.model==='opus','migration lost choices'); assert(JSON.parse(readFileSync(path,'utf8')).version===1,'resolver rewrote config'); });
check('version-1 setup migration is backed up and atomic', () => { const target=join(temp,'save-test','lanes.json'); mkdirSync(dirname(target),{recursive:true}); const old={version:1,custom_setting:'keep',routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}}; writeFileSync(target,JSON.stringify(old)); const choices=join(temp,'migration-choices.json'); writeFileSync(choices,JSON.stringify({routine:old.routine,broad:{provider:'google',model:'gemini-3.8-flash-medium'},complex:old.complex,reviewer:old.reviewer})); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status===0,r.stderr); const output=JSON.parse(r.stdout), saved=JSON.parse(readFileSync(target,'utf8')); assert(saved.version===2 && saved.custom_setting==='keep' && saved.routine.model==='custom-luna' && saved.reviewer.model==='opus' && saved.broad.model==='gemini-3.8-flash-medium','bad migration'); assert(JSON.parse(readFileSync(output.backup,'utf8')).version===1,'missing backup'); });
check('invalid migration leaves existing config untouched', () => { const target=join(temp,'invalid-lanes.json'); const old='{"version":3,"custom":"keep"}'; writeFileSync(target,old); const choices=join(temp,'choices.json'); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status!==0,'accepted future version'); assert(readFileSync(target,'utf8')===old,'config changed'); });
check('explicit legacy broad pin is preserved with a warning', () => { const target=join(temp,'legacy.json'); const old=JSON.stringify({version:2,broad:{provider:'google',model:'gemini-3.8-flash'}}); writeFileSync(target,old); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),target]); assert(r.status===0 && JSON.parse(r.stdout).broad.model==='gemini-3.8-flash' && r.stderr.includes('legacy'), 'legacy pin silently changed'); assert(readFileSync(target,'utf8')===old,'user config was rewritten'); });
check('setup refuses legacy broad slug without overwriting', () => { const target=join(temp,'legacy-save.json'); const old=JSON.stringify({version:2,custom:'keep'}); writeFileSync(target,old); const choices=JSON.parse(readFileSync(join(temp,'choices.json'),'utf8')); choices.broad.model='gemini-3.8-flash'; const input=join(temp,'legacy-choice.json'); writeFileSync(input,JSON.stringify(choices)); const r=run('node',[join(root,'scripts/save-lanes.mjs'),input,target]); assert(r.status!==0 && readFileSync(target,'utf8')===old,'legacy migration lost user config'); });

check('agent delegates configured model instead of hardcoding the default', () => {
  assert(!/FABLE_GEMINI_MODEL="gemini-3\.8-flash-medium"/.test(read('agents/gemini-implementer.md')), 'hardcoded agent override');
  const template=read('agents/gemini-implementer.md').split('GEMINI REPORT')[1];
  assert(template.includes('<exact resolved model ID from runner>') && !template.includes('gemini-3.8-flash-medium'),'hardcoded report model');
  const custom='gemini-3.8-flash-high';
  const r=fixture('configured',undefined,{config:{version:2,broad:{provider:'google',model:custom}},expectedModel:custom});
  assert(r.status===0 && r.stdout.includes(`(${custom})`),r.stdout+r.stderr);
});
check('saved legacy slug fails before model execution', () => {
  const r=fixture('saved-legacy',undefined,{config:{version:2,broad:{model:'gemini-3.8-flash'}}});
  assert(r.status!==0 && r.stdout.includes('STATUS: unavailable') && !existsSync(join(r.dir,'output.txt')),r.stdout);
});
check('explicit model override takes precedence over saved choice', () => {
  const r=fixture('override',undefined,{config:{broad:{model:'gemini-3.8-flash-high'}},model:'gemini-3.8-flash-low',expectedModel:'gemini-3.8-flash-low'});
  assert(r.status===0,r.stdout+r.stderr);
});
check('runner reports redact GitHub credentials in every output channel', () => {
  const tokens=['ghp_','gho_','ghu_','ghs_','ghr_','github_pat_'].map(prefix=>prefix+'x'.repeat(36));
  const secret=tokens.join(' ');
  const r=fixture('report-secret',['./verify',...tokens],{secret,verifier:`echo '${secret}'; exit 0`});
  assert(r.status===0 && r.stdout.includes('STATUS: complete'),r.stdout+r.stderr);
  for (const heading of ['VERIFIED:','GEMINI SAID:','DIAGNOSTICS:']) assert(r.stdout.includes(heading),'missing report channel');
  assert(r.stdout.includes('<REDACTED>'),'no redaction evidence');
  const early=fixture('version-secret',undefined,{secret});
  assert(early.status!==0 && early.stdout.includes('STATUS: unavailable') && early.stdout.includes('<REDACTED>'),'early failure not reported');
  for(const token of tokens) assert(![r.stdout,r.stderr,early.stdout,early.stderr].some(text=>text.includes(token)),'credential leaked');
});
check('verification arguments never undergo shell evaluation', () => {
  const literal='$(touch injected.txt); touch another.txt';
  const r=fixture('literal-argv',['test',literal,'=',literal]);
  assert(r.status===0,r.stdout+r.stderr);
  assert(!existsSync(join(r.dir,'injected.txt')) && !existsSync(join(r.dir,'another.txt')),'shell syntax executed');
});
for (const [label,verifier,mode,expected,exitCode] of [
  ['not executable','exit 0',0o644,'blocked',126],
  ['permission denial contract','echo "permission denied" >&2; exit 126',0o755,'blocked',126],
  ['policy denial contract','echo "blocked by policy" >&2; exit 126',0o755,'blocked',126],
  ['quoted permission assertion','echo "Assertion failed: expected permission denied" >&2; exit 1',0o755,'partial',1],
  ['quoted policy assertion','echo "Assertion failed: expected blocked by policy" >&2; exit 1',0o755,'partial',1],
  ['ambiguous permission log','echo "permission denied" >&2; exit 1',0o755,'partial',1],
  ['ordinary failure','echo "assertion failed" >&2; exit 1',0o755,'partial',1]
]) check(`verification ${label} → ${expected} without retry`, () => {
  const r=fixture('verify-denial',['./verify'],{verifier,verifierMode:mode});
  assert(r.status!==0 && r.stdout.includes(`STATUS: ${expected}`) && r.stdout.includes(`verification attempted; exit ${exitCode}`),r.stdout+r.stderr);
  const calls=join(r.home,'verifier-calls');
  assert(mode===0o644 ? !existsSync(calls) : readFileSync(calls,'utf8')==='invoked\n','verifier retried or bypassed');
  assert(!existsSync(join(r.dir,'fallback.txt')),'fallback invoked');
});
for (const [label,verifier,expected,changes] of [
  ['creates a file','echo generated > generated.txt','partial',['generated.txt','output.txt']],
  ['reformats output','echo formatted > output.txt','partial',['output.txt']],
  ['reverts implementation','rm output.txt','partial',[]],
  ['deletes tracked file','rm README.md','partial',['README.md','output.txt']],
  ['fails after editing','echo generated > generated.txt; exit 1','partial',['generated.txt','output.txt']],
  ['denied after editing','echo generated > generated.txt; exit 126','blocked',['generated.txt','output.txt']]
]) check(`verifier ${label} reports final changes without claiming completion`, () => {
  const r=fixture('verify-mutation',['./verify'],{verifier});
  assert(r.status!==0 && r.stdout.includes(`STATUS: ${expected}`) && r.stdout.includes('verifier changed reviewable files'),r.stdout+r.stderr);
  const actual=r.stdout.split('CHANGES:\n')[1]?.split('VERIFIED:')[0].trim();
  assert(actual?.split('\n').sort().join('\n')===[...changes].sort().join('\n'),`stale final changes: ${actual}`);
  assert(readFileSync(join(r.home,'verifier-calls'),'utf8')==='invoked\n','verifier retried');
});
for(const exitCode of [0,126]) check(`unsafe post-verification scan at exit ${exitCode} cannot report stale evidence`, () => {
  const r=fixture('verify-unsafe',['./verify'],{verifier:`rm README.md; mkfifo README.md; exit ${exitCode}`});
  assert(r.status!==0 && r.stdout.includes(`STATUS: ${exitCode===126?'blocked':'partial'}`),r.stdout+r.stderr);
  assert(r.stdout.includes('CHANGES:\nUnavailable: final worktree inspection failed\n') && r.stdout.includes('cannot safely inspect the worktree after verification'),r.stdout);
  assert(readFileSync(join(r.home,'verifier-calls'),'utf8')==='invoked\n','verifier retried');
});
check('old shell-string verifier is rejected without execution', () => {
  const r=fixture('shell-string',['touch injected.txt'],{legacyVerify:true});
  assert(r.status!==0 && r.stdout.includes('STATUS: partial') && !existsSync(join(r.dir,'injected.txt')),'legacy shell command executed');
});
check('malformed root and lane values are rejected without rewriting', () => {
  const invalid=[null,[],42,'invalid',...['broad','routine','complex','reviewer'].flatMap(lane=>
    [null,[],42,'invalid',{model:null},{model:42},{model:''},{provider:null},{effort:[]}].map(value=>({version:2,[lane]:value})))];
  const target=join(temp,'malformed.json');
  for(const value of invalid) {
    const raw=JSON.stringify(value); writeFileSync(target,raw);
    for(const [file,args] of [['resolve-lanes.mjs',[target]],['save-lanes.mjs',[join(temp,'choices.json'),target]]]) {
      const r=run(process.execPath,[join(root,'scripts',file),...args]);
      assert(r.status!==0,`${file} accepted ${raw}`);
      assert(readFileSync(target,'utf8')===raw,'invalid config rewritten');
    }
    assert(!existsSync(`${target}.lock`),'validation failure leaked lock');
  }
});
check('invalid config cannot invoke default broad model', () => {
  const r=fixture('invalid-config',undefined,{config:{broad:null}});
  assert(r.status!==0 && r.stdout.includes('STATUS: unavailable') && !existsSync(join(r.dir,'output.txt')),r.stdout);
});
check('saving choices preserves unused broad and reviewer effort metadata', () => {
  const target=join(temp,'unused-efforts.json');
  writeFileSync(target,JSON.stringify({version:2,broad:{effort:'custom-broad',note:'keep'},reviewer:{effort:'custom-reviewer',note:'keep'}}));
  const r=run(process.execPath,[join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target]);
  assert(r.status===0,r.stderr);
  const saved=JSON.parse(readFileSync(target,'utf8'));
  assert(saved.broad.effort==='custom-broad' && saved.reviewer.effort==='custom-reviewer' && saved.broad.note==='keep' && saved.reviewer.note==='keep','unused metadata lost');
  const resolved=run(process.execPath,[join(root,'scripts/resolve-lanes.mjs'),target]);
  assert(resolved.status===0,resolved.stderr);
  const lanes=JSON.parse(resolved.stdout);
  assert(!('effort' in lanes.broad) && !('effort' in lanes.reviewer),'unused metadata became an active setting');
});
check('custom Codex models require explicit effort without changing config', () => {
  const target=join(temp,'custom-effort.json');
  for (const lane of ['routine','complex']) {
    for (const effort of [undefined,'low']) {
      const raw=JSON.stringify({version:2,[lane]:{model:'custom-model',effort}}); writeFileSync(target,raw);
      const r=run(process.execPath,[join(root,'scripts/resolve-lanes.mjs'),target]);
      if (effort===undefined) assert(r.status!==0 && r.stderr.includes('requires an explicit effort'),r.stdout+r.stderr);
      else assert(r.status===0 && JSON.parse(r.stdout)[lane].effort===effort,r.stdout+r.stderr);
      assert(readFileSync(target,'utf8')===raw,'config rewritten');
    }
  }
  writeFileSync(target,JSON.stringify({routine:{model:'gpt-6-sol'},complex:{model:'gpt-6-luna'}}));
  const r=run(process.execPath,[join(root,'scripts/resolve-lanes.mjs'),target]);
  const value=JSON.parse(r.stdout);
  assert(r.status===0 && value.routine.effort==='medium' && value.complex.effort==='max','known model defaults lost');
});
check('known cross-provider models are rejected even with matching provider and effort', () => {
  for(const [name,lane] of Object.entries(catalog)) {
    for(const source of Object.values(catalog)) for(const model of source.options) {
      for(const provider of [undefined,lane.provider]) {
        const config={[name]:{model:model.id,effort:'low',...(provider?{provider}:{})}};
        let error; try { validateLanes(config,catalog); } catch(e) { error=e; }
        assert(source.provider===lane.provider ? !error : error?.message.includes('Incompatible model provider'),`${name}: ${model.id}`);
      }
    }
    validateLanes({[name]:{provider:lane.provider,model:'custom-model',effort:'low'}},catalog);
  }
});
check('resolver and saver reject incompatible model choices without rewriting config', () => {
  const target=join(temp,'wrong-provider.json'), input=join(temp,'wrong-provider-choices.json');
  for(const [name,lane] of Object.entries(catalog)) {
    const model=Object.values(catalog).find(other=>other.provider!==lane.provider).recommended;
    const wrong={provider:lane.provider,model,effort:'low'};
    const raw=JSON.stringify({version:2,[name]:wrong}); writeFileSync(target,raw);
    for(const [script,args] of [['resolve-lanes.mjs',[target]],['save-lanes.mjs',[join(temp,'choices.json'),target]]]) {
      const r=run(process.execPath,[join(root,'scripts',script),...args]);
      assert(r.status!==0 && r.stderr.includes('Incompatible model provider'),r.stdout+r.stderr);
      assert(readFileSync(target,'utf8')===raw && !existsSync(target+'.lock'),'invalid existing config changed');
    }
    const old='{"version":2,"note":"preserved"}'; writeFileSync(target,old);
    writeFileSync(input,JSON.stringify({...JSON.parse(readFileSync(join(temp,'choices.json'),'utf8')),[name]:wrong}));
    const r=run(process.execPath,[join(root,'scripts/save-lanes.mjs'),input,target]);
    assert(r.status!==0 && r.stderr.includes('Incompatible model provider') && readFileSync(target,'utf8')===old && !existsSync(target+'.lock'),'invalid confirmed choices accepted');
  }
});
check('a live competing setup cannot overwrite confirmed choices', () => {
  const dir=join(temp,'concurrent'); mkdirSync(dir);
  const target=join(dir,'lanes.json'), ready=join(dir,'ready'), release=join(dir,'release');
  const choices=JSON.parse(readFileSync(join(temp,'choices.json'),'utf8'));
  const first=join(dir,'first.json'), second=join(dir,'second.json');
  writeFileSync(first,JSON.stringify(choices));
  writeFileSync(second,JSON.stringify({...choices,broad:{provider:'google',model:'gemini-3.8-flash-low'}}));
  writeFileSync(target,JSON.stringify({version:1,custom_setting:'preserved'}));
  const hook=join(dir,'hold-lock.cjs');
  // Test-only preload: pause the first process immediately before its rename.
  writeFileSync(hook,`const fs=require('node:fs'); const rename=fs.renameSync;
fs.renameSync=function(...args) {fs.writeFileSync(${JSON.stringify(ready)},'ready'); const end=Date.now()+10000;
while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('test release timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
return rename(...args);}; require('node:module').syncBuiltinESMExports();`);
  const driver=`const {spawn,spawnSync}=require('node:child_process'); const fs=require('node:fs');
const writer=spawn(process.execPath,['--require',${JSON.stringify(hook)},${JSON.stringify(join(root,'scripts/save-lanes.mjs'))},${JSON.stringify(first)},${JSON.stringify(target)}],{stdio:['ignore','pipe','pipe']});
const end=Date.now()+10000; while(!fs.existsSync(${JSON.stringify(ready)})){if(Date.now()>end){writer.kill();throw Error('first writer not ready');}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
const other=spawnSync(process.execPath,[${JSON.stringify(join(root,'scripts/save-lanes.mjs'))},${JSON.stringify(second)},${JSON.stringify(target)}],{encoding:'utf8'});
fs.writeFileSync(${JSON.stringify(release)},'release');
writer.on('exit',code=>{if(code!==0||other.status===0||!other.stderr.includes('configuration lock'))process.exitCode=1;});`;
  const r=run(process.execPath,['-e',driver],{timeout:15000});
  assert(r.status===0,r.stderr);
  const saved=JSON.parse(readFileSync(target,'utf8'));
  assert(saved.broad.model===choices.broad.model && saved.custom_setting==='preserved','competing write lost choices');
  assert(!existsSync(`${target}.lock`),'successful save leaked lock');
});
check('setup termination signals release the owned lock without replacing config', () => {
  for(const [signal,exitCode] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]]) {
    for(const phase of ['lock','temp']) {
      const dir=join(temp,`signal-${signal}-${phase}`); mkdirSync(dir);
      const target=join(dir,'lanes.json'), hook=join(dir,'interrupt.cjs');
      const old=JSON.stringify({version:1,custom:'preserved'}); writeFileSync(target,old);
      writeFileSync(hook,`const fs=require('node:fs'); const mkdir=fs.mkdirSync, write=fs.writeFileSync;
fs.mkdirSync=function(path,...args){const result=mkdir.call(this,path,...args); if(${JSON.stringify(phase)}==='lock' && path===${JSON.stringify(target+'.lock')})process.kill(process.pid,${JSON.stringify(signal)});return result;};
fs.writeFileSync=function(path,...args){const result=write.call(this,path,...args);if(${JSON.stringify(phase)}==='temp' && String(path).endsWith('.tmp'))process.kill(process.pid,${JSON.stringify(signal)});return result;};
require('node:module').syncBuiltinESMExports();`);
      const args=[join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target];
      const r=run(process.execPath,['--require',hook,...args],{timeout:10000});
      assert(r.status===exitCode,`${signal}/${phase}: ${r.status} ${r.signal} ${r.stderr}`);
      assert(readFileSync(target,'utf8')===old,'interrupted save replaced config');
      assert(!existsSync(target+'.lock') && !readdirSync(dir).some(name=>name.endsWith('.tmp')),'interrupted save leaked lock/temp');
      const retry=run(process.execPath,args);
      assert(retry.status===0,retry.stderr);
    }
  }
});
check('cleanup attempts every owned path and preserves termination status on filesystem errors', () => {
  for(const [signal,exitCode] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129],[null,1]]) {
    for(const failure of ['temp','owner','lock']) {
      const dir=join(temp,`cleanup-${signal}-${failure}`); mkdirSync(dir);
      const target=join(dir,'lanes.json'), hook=join(dir,'fault.cjs'), attempts=join(dir,'attempts');
      const old='{"version":1,"note":"preserved"}'; writeFileSync(target,old);
      writeFileSync(hook,`const fs=require('node:fs'); const write=fs.writeFileSync;
for(const method of ['unlinkSync','rmdirSync']) {const original=fs[method];fs[method]=function(path,...args){
const kind=String(path).endsWith('.tmp')?'temp':String(path).endsWith('/owner.json')?'owner':'lock';
fs.appendFileSync(${JSON.stringify(attempts)},kind+'\\n');
if(kind===${JSON.stringify(failure)})throw Object.assign(Error('injected cleanup error'),{code:'EACCES'});
return original.call(this,path,...args);};}
fs.writeFileSync=function(path,...args){const result=write.call(this,path,...args);if(${JSON.stringify(signal)} && String(path).endsWith('.tmp'))process.kill(process.pid,${JSON.stringify(signal)});return result;};
require('node:module').syncBuiltinESMExports();`);
      const r=run(process.execPath,['--require',hook,join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target],{timeout:10000});
      assert(r.status===exitCode,`${signal}/${failure}: ${r.status} ${r.stderr}`);
      assert(readFileSync(attempts,'utf8')==='temp\nowner\nlock\n','cleanup skipped a resource or retried');
      assert(r.stderr.includes('Setup cleanup failed') && r.stderr.includes('inspect manually') && !r.stderr.includes('Error: injected'),r.stderr);
      if(signal) assert(readFileSync(target,'utf8')===old,'terminated save replaced config');
    }
  }
});
check('setup refuses live and dangling symlink targets without replacing links or destinations', () => {
  for(const live of [true,false]) {
    const dir=join(temp,`symlink-config-${live}`); mkdirSync(dir);
    const target=join(dir,'lanes.json'), destination=join(dir,'actual.json');
    const raw='{"version":1,"note":"preserved"}';
    if(live) writeFileSync(destination,raw);
    symlinkSync('actual.json',target);
    const r=run(process.execPath,[join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target]);
    assert(r.status!==0 && r.stderr.includes('Symlinked lane configuration'),r.stdout+r.stderr);
    assert(lstatSync(target).isSymbolicLink() && readlinkSync(target)==='actual.json','link replaced');
    assert(live ? readFileSync(destination,'utf8')===raw : !existsSync(destination),'destination changed');
    assert(!existsSync(target+'.lock') && !readdirSync(dir).some(name=>name.endsWith('.tmp') || name.includes('.backup-')),'rejected link leaked artifacts');
  }
});
check('setup rechecks a target swapped to a symlink before publishing', () => {
  const dir=join(temp,'symlink-config-swap'); mkdirSync(dir);
  const target=join(dir,'lanes.json'), destination=join(dir,'actual.json'), hook=join(dir,'swap.cjs');
  writeFileSync(target,'{"version":1}'); writeFileSync(destination,'{"note":"untouched"}');
  writeFileSync(hook,`const fs=require('node:fs');const copy=fs.copyFileSync;
fs.copyFileSync=function(...args){const result=copy.apply(this,args);fs.unlinkSync(${JSON.stringify(target)});fs.symlinkSync('actual.json',${JSON.stringify(target)});return result;};require('node:module').syncBuiltinESMExports();`);
  const r=run(process.execPath,['--require',hook,join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target]);
  assert(r.status!==0 && r.stderr.includes('Symlinked lane configuration'),r.stdout+r.stderr);
  assert(lstatSync(target).isSymbolicLink() && readFileSync(destination,'utf8')==='{"note":"untouched"}','swapped link or destination overwritten');
  assert(!existsSync(target+'.lock') && !readdirSync(dir).some(name=>name.endsWith('.tmp')),'swap failure leaked lock/temp');
});
check('uncatchable setup termination preserves a diagnosable lock for manual recovery', () => {
  const dir=join(temp,'killed-setup'); mkdirSync(dir);
  const target=join(dir,'lanes.json'), hook=join(dir,'kill.cjs');
  const old=JSON.stringify({version:1,custom:'preserved'}); writeFileSync(target,old);
  writeFileSync(hook,`const fs=require('node:fs'); const write=fs.writeFileSync;
fs.writeFileSync=function(path,...args){const result=write.call(this,path,...args);if(String(path).endsWith('/owner.json'))process.kill(process.pid,'SIGKILL');return result;};require('node:module').syncBuiltinESMExports();`);
  const args=[join(root,'scripts/save-lanes.mjs'),join(temp,'choices.json'),target];
  const killed=run(process.execPath,['--require',hook,...args],{timeout:10000});
  assert(killed.signal==='SIGKILL','fixture did not terminate');
  const ownerPath=join(target+'.lock','owner.json'), raw=readFileSync(ownerPath,'utf8'), owner=JSON.parse(raw);
  assert(owner.pid>0 && owner.hostname && owner.started_at && owner.temp,'missing recovery metadata');
  const retry=run(process.execPath,args);
  assert(retry.status!==0 && retry.stderr.includes('manual recovery'),'orphan lock silently stolen');
  assert(readFileSync(target,'utf8')===old && readFileSync(ownerPath,'utf8')===raw,'retry modified protected files');
});
check('behavior repeat count rejects invalid inputs before invoking Claude', () => {
  const dir=join(temp,'repeat-test'); mkdirSync(dir);
  const marker=join(dir,'invoked'); const cli=join(dir,'claude');
  writeFileSync(cli,`#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(marker)},'called');\n`); chmodSync(cli,0o755);
  for(const value of ['abc','NaN','Infinity','0','-1','4','1.5','']) {
    const r=run(process.execPath,[join(root,'evals/scripts/behavior.mjs')],{env:{...process.env,PATH:dir,FABLE_EVAL_REPEATS:value}});
    assert(r.status===2 && r.stderr.includes('must be an integer'),`accepted repeat ${value}`);
    assert(!existsSync(marker),'invalid repeats reached Claude');
  }
});
check('behavior authentication timeout stops before cases or transcripts', () => {
  const dir=join(temp,'auth-timeout'); mkdirSync(dir);
  const marker=join(dir,'auth-started'), cases=join(dir,'case-started'), cli=join(dir,'claude');
  writeFileSync(cli,`#!${process.execPath}\nconst fs=require('fs');
if(process.argv.includes('auth')) {
  fs.writeFileSync(${JSON.stringify(marker)},'called');
  process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);
} else fs.writeFileSync(${JSON.stringify(cases)},'called');\n`);
  chmodSync(cli,0o755);
  const r=run(process.execPath,[join(root,'evals/scripts/behavior.mjs')],{
    env:{...process.env,PATH:dir,HOME:dir,TMPDIR:dir,FABLE_EVAL_REPEATS:'1'},timeout:20000,killSignal:'SIGKILL'
  });
  assert(existsSync(marker),'authentication probe never started');
  assert(r.status===2 && r.stderr.includes('UNTESTED:') && r.stderr.includes('timed out after 10 seconds'),r.stderr);
  assert(!existsSync(cases) && !readdirSync(dir).some(name=>name.startsWith('fable-behavior-')),'timeout reached cases or created transcripts');
});
check('behavior distinguishes process timeout from a model timeout decision', () => {
  const dir=join(temp,'case-timeout'); mkdirSync(dir);
  const hook=join(dir,'timeout.cjs');
  // Inject spawnSync's timeout result; do not wait three minutes or invoke a provider.
  writeFileSync(hook,`const cp=require('node:child_process');
cp.spawnSync=(command,args,options)=>{
  if(args.includes('auth'))return {status:0,stdout:'{"loggedIn":true}'};
  if(options.timeout!==180000 || options.killSignal!=='SIGKILL')throw Error('case deadline not enforced');
  return {status:null,signal:'SIGKILL',error:{code:'ETIMEDOUT'},stdout:'{"status":"timeout"}',stderr:''};
}; require('node:module').syncBuiltinESMExports();`);
  const r=run(process.execPath,['--require',hook,join(root,'evals/scripts/behavior.mjs')],{
    env:{...process.env,TMPDIR:dir,FABLE_EVAL_REPEATS:'1'},timeout:10000
  });
  assert(r.status===1 && r.stdout.includes('(timeout)') && r.stdout.includes('FAIL 0/18'),r.stdout+r.stderr);
  const records=join(dir,readdirSync(dir).find(name=>name.startsWith('fable-behavior-')));
  for(const file of readdirSync(records)) {
    const record=JSON.parse(readFileSync(join(records,file),'utf8'));
    assert(record.execution_status==='timeout' && record.error_code==='ETIMEDOUT' && record.exit===null,'lost infrastructure failure');
    assert(record.observed.status==='timeout','model decision overwritten with infrastructure status');
  }
});
check('behavior records and console recursively redact structured model output', () => {
  const dir=join(temp,'behavior-redaction'); mkdirSync(dir);
  const home=join(dir,'home'); mkdirSync(home);
  const token='sk-proj-'+ 'x'.repeat(32), bearer='fixture-credential-value';
  const reason=`${home}/private ${root}/private ${token} Bearer ${bearer}`;
  const cli=join(dir,'claude');
  writeFileSync(cli,`#!${process.execPath}\nif(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true}));}else{console.log(JSON.stringify({structured_output:{lane:'routine',reason:${JSON.stringify(reason)},nested:[{${JSON.stringify(token)}:${JSON.stringify(reason)}}]}}));console.error(${JSON.stringify(reason)});}\n`);
  chmodSync(cli,0o755);
  const r=run(process.execPath,[join(root,'evals/scripts/behavior.mjs')],{env:{...process.env,PATH:dir,HOME:home,TMPDIR:dir,FABLE_EVAL_REPEATS:'1'},timeout:30000});
  assert(r.status===1 && r.stdout.includes('FAIL'),'raw decision grading did not run');
  assert(!r.stdout.includes(token) && !r.stdout.includes(bearer) && !r.stdout.includes(home) && !r.stdout.includes(root),'console leaked model output');
  const records=join(dir,readdirSync(dir).find(name=>name.startsWith('fable-behavior-')));
  const files=readdirSync(records); assert(files.length===18,'expected all 18 behavioral cases');
  for(const name of files) {
    const raw=readFileSync(join(records,name),'utf8'); JSON.parse(raw);
    assert(!raw.includes(token) && !raw.includes(bearer) && !raw.includes(home) && !raw.includes(root),'transcript leaked model output');
    assert(raw.includes('<REDACTED>') && raw.includes('<HOME>') && raw.includes('<PLUGIN>'),'missing recursive redaction');
  }
  const value=sanitize({reason:[reason]},root);
  assert(value.reason[0].includes('<REDACTED>'),'nested sanitizer regression');
});

rmSync(temp,{recursive:true,force:true});
let passed=tests.filter(x=>x[1]).length;
console.log('Fable Advisor behavioral evals\n');
console.log(`Static / deterministic          ${passed}/${tests.length}`);
for (const [name,ok,message] of tests) if (!ok) console.log(`FAIL ${name}: ${message}`);
console.log(`\n${passed===tests.length?'PASS':'FAIL'} ${passed}/${tests.length}`);
process.exitCode=passed===tests.length?0:1;
