#!/usr/bin/env node
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
const basePath = '/usr/bin:/bin';
function run(command, args, opts={}) { return spawnSync(command, args, { encoding:'utf8', ...opts }); }
function fixture(mode, verify='test -f output.txt') {
  const dir=join(temp, mode+'-'+Math.random().toString(16).slice(2)); mkdirSync(dir);
  run('git',['init','-q',dir]); writeFileSync(join(dir,'README.md'),'fixture\n');
  run('git',['-C',dir,'add','README.md']); run('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const spec=join(dir,'spec.txt'); writeFileSync(spec,'OBJECTIVE: write output.txt\nVERIFICATION: '+verify+'\n');
  const shim=join(dir,'shim'); mkdirSync(shim);
  const home=join(temp,'home-'+Math.random().toString(16).slice(2)); mkdirSync(home);
  const env={...process.env,HOME:home,PATH:shim+':'+basePath,SHIM_MODE:mode,TMPDIR:temp,FABLE_WORKDIR:dir};
  delete env.GEMINI_API_KEY;
  delete env.FABLE_GEMINI_MODEL;
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
if(process.argv.includes('--version')) { console.log('1.2.12'); process.exit(0); }
const mode=process.env.SHIM_MODE;
const args=process.argv.slice(2);
for(const flag of ['--sandbox','--mode','--model','--print-timeout','--input-format','--output-format']) if(!args.includes(flag))throw Error('Missing flag '+flag);
if(args.includes('--approval-mode')||args.includes('--dangerously-skip-permissions')||args.includes('--disable-slash-commands')||args.includes('--prompt')) throw Error('Unsafe or incompatible flag');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(input.event!=='user'||!input.message.content.endsWith(fs.readFileSync('spec.txt','utf8')))throw Error('Spec was truncated');
const diagnostics={auth:'authentication required',authmethod:'API key required', 'unsupported-client':'This client is no longer supported', 'unsupported-code':'UNSUPPORTED_CLIENT',signin:'Failed to sign in',blocked:'blocked by policy',untrusted:'permission denied'};
if(diagnostics[mode]){console.error(diagnostics[mode]);process.exit(1);}
if(mode==='malformed'){console.log('not JSON');process.exit(0);}
const model=args[args.indexOf('--model')+1];
console.log(JSON.stringify({event:'init',init:{model:mode==='wrong-model'?'gemini-3.7-flash-medium':model,permission_mode:'request-review'}}));
if(mode==='soft-denial') {console.error('write_file was auto-denied');console.log(JSON.stringify({event:'step_update',step_update:{tool_info:{error:{type:'TOOL_ERROR',message:'user denied permission for write_file(note.txt)'}}}}));}
if(!['nochange','soft-denial','event-timeout'].includes(mode))fs.writeFileSync('output.txt','implemented');
console.log(JSON.stringify({event:'result',result:{status:mode==='event-timeout'?'TIMEOUT':mode==='error-event'?'ERROR':'SUCCESS',response:'Fixture response'}}));
`;
    writeFileSync(join(shim,'agy'),script); chmodSync(join(shim,'agy'),0o755);
  }
  if (mode === 'timeout') { writeFileSync(join(shim,'gtimeout'),'#!/bin/sh\nexit 124\n'); chmodSync(join(shim,'gtimeout'),0o755); }
  const result=run('bash',[join(root,'scripts/gemini-lane.sh'),spec,verify],{cwd:dir,env});
  return { ...result, dir };
}
for (const [mode,expected,verify] of [
  ['missing','unavailable'],['auth','unavailable'],['authmethod','unavailable'],['blocked','blocked'],['untrusted','blocked'],['nochange','refused'],
  ['unsupported-client','unavailable'],['unsupported-code','unavailable'],['signin','unavailable'],
  ['legacy','unavailable'],['api-env','unavailable'],['api-settings','unavailable'],['unsafe-settings','blocked'],['soft-denial','blocked'],['wrong-model','unavailable'],['event-timeout','timeout'],['malformed','partial'],['error-event','partial'],
  ['timeout','timeout'],['verifyfail','partial','false'],['success','complete']
]) {
  check(`Gemini ${mode} → ${expected}`, () => { const r=fixture(mode,verify); assert(r.stdout.includes(`STATUS: ${expected}`), `observed ${r.stdout}\n${r.stderr}`); assert(!existsSync(join(r.dir,'fallback.txt')), 'old client fallback invoked'); if (expected !== 'complete') assert(r.status !== 0, 'non-complete exit 0'); if (mode==='missing') assert(!existsSync(join(r.dir,'output.txt')), 'fallback wrote file'); if (mode==='success') assert(r.stdout.includes('CHANGES:\noutput.txt') && r.stdout.includes('VERIFIED: test -f output.txt'), 'missing diff or evidence'); });
}
check('Codex preflight unavailable in isolated PATH', () => { const r=run('bash',['-lc','PATH=/usr/bin:/bin; command -v codex >/dev/null 2>&1'],{env:{...process.env,PATH:basePath}}); assert(r.status !== 0, 'Codex unexpectedly present in isolated PATH'); for (const file of ['agents/luna-implementer.md','agents/sol-implementer.md']) assert(read(file).includes('STATUS: unavailable'), file); });
check('version-1 custom choices preserved', () => { const path=join(temp,'lanes-v1.json'); writeFileSync(path,JSON.stringify({version:1,routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}})); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),path]); assert(r.status===0,r.stderr); const value=JSON.parse(r.stdout); assert(value.broad.model==='gemini-3.8-flash-medium' && value.routine.model==='custom-luna' && value.routine.effort==='low' && value.reviewer.model==='opus','migration lost choices'); assert(JSON.parse(readFileSync(path,'utf8')).version===1,'resolver rewrote config'); });
check('version-1 setup migration is backed up and atomic', () => { const target=join(temp,'save-test','lanes.json'); mkdirSync(dirname(target),{recursive:true}); const old={version:1,custom_setting:'keep',routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}}; writeFileSync(target,JSON.stringify(old)); const choices=join(temp,'choices.json'); writeFileSync(choices,JSON.stringify({routine:old.routine,broad:{provider:'google',model:'gemini-3.8-flash-medium'},complex:old.complex,reviewer:old.reviewer})); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status===0,r.stderr); const output=JSON.parse(r.stdout), saved=JSON.parse(readFileSync(target,'utf8')); assert(saved.version===2 && saved.custom_setting==='keep' && saved.routine.model==='custom-luna' && saved.reviewer.model==='opus' && saved.broad.model==='gemini-3.8-flash-medium','bad migration'); assert(JSON.parse(readFileSync(output.backup,'utf8')).version===1,'missing backup'); });
check('invalid migration leaves existing config untouched', () => { const target=join(temp,'invalid-lanes.json'); const old='{"version":3,"custom":"keep"}'; writeFileSync(target,old); const choices=join(temp,'choices.json'); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status!==0,'accepted future version'); assert(readFileSync(target,'utf8')===old,'config changed'); });
check('explicit legacy broad pin is preserved with a warning', () => { const target=join(temp,'legacy.json'); const old=JSON.stringify({version:2,broad:{provider:'google',model:'gemini-3.8-flash'}}); writeFileSync(target,old); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),target]); assert(r.status===0 && JSON.parse(r.stdout).broad.model==='gemini-3.8-flash' && r.stderr.includes('legacy'), 'legacy pin silently changed'); assert(readFileSync(target,'utf8')===old,'user config was rewritten'); });
check('setup refuses legacy broad slug without overwriting', () => { const target=join(temp,'legacy-save.json'); const old=JSON.stringify({version:2,custom:'keep'}); writeFileSync(target,old); const choices=JSON.parse(readFileSync(join(temp,'choices.json'),'utf8')); choices.broad.model='gemini-3.8-flash'; const input=join(temp,'legacy-choice.json'); writeFileSync(input,JSON.stringify(choices)); const r=run('node',[join(root,'scripts/save-lanes.mjs'),input,target]); assert(r.status!==0 && readFileSync(target,'utf8')===old,'legacy migration lost user config'); });
rmSync(temp,{recursive:true,force:true});
let passed=tests.filter(x=>x[1]).length;
console.log('Fable Advisor behavioral evals\n');
console.log(`Static / deterministic          ${passed}/${tests.length}`);
for (const [name,ok,message] of tests) if (!ok) console.log(`FAIL ${name}: ${message}`);
console.log(`\n${passed===tests.length?'PASS':'FAIL'} ${passed}/${tests.length}`);
process.exitCode=passed===tests.length?0:1;
