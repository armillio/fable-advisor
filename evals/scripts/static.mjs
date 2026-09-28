#!/usr/bin/env node
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sanitize } from './sanitize.mjs';

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
function fixture(mode, verify=['test','-f','output.txt'], options={}) {
  const dir=join(temp, mode+'-'+Math.random().toString(16).slice(2)); mkdirSync(dir);
  run('git',['init','-q',dir]); writeFileSync(join(dir,'README.md'),'fixture\n');
  run('git',['-C',dir,'add','README.md']); run('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const spec=join(dir,'spec.txt'); writeFileSync(spec,'OBJECTIVE: write output.txt\nVERIFICATION: '+verify.join(' ')+'\n');
  if (options.verifier) {
    writeFileSync(join(dir,'verify'),`#!/bin/sh\necho invoked >> verifier-calls\n${options.verifier}\n`);
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
if(!['nochange','soft-denial','event-timeout'].includes(mode))fs.writeFileSync('output.txt','implemented');
console.log(JSON.stringify({event:'result',result:{status:mode==='event-timeout'?'TIMEOUT':mode==='error-event'?'ERROR':'SUCCESS',response:process.env.FIXTURE_SECRET || 'Fixture response'}}));
`;
    writeFileSync(join(shim,'agy'),script); chmodSync(join(shim,'agy'),0o755);
  }
  if (mode === 'timeout') { writeFileSync(join(shim,'gtimeout'),'#!/bin/sh\nexit 124\n'); chmodSync(join(shim,'gtimeout'),0o755); }
  const result=run('bash',[join(root,'scripts/gemini-lane.sh'),spec,...(options.legacyVerify ? [verify.join(' ')] : ['--',...verify])],{cwd:dir,env});
  return { ...result, dir };
}
for (const [mode,expected,verify] of [
  ['missing','unavailable'],['auth','unavailable'],['authmethod','unavailable'],['blocked','blocked'],['untrusted','blocked'],['nochange','refused'],
  ['unsupported-client','unavailable'],['unsupported-code','unavailable'],['signin','unavailable'],
  ['legacy','unavailable'],['api-env','unavailable'],['api-settings','unavailable'],['unsafe-settings','blocked'],['soft-denial','blocked'],['wrong-model','unavailable'],['event-timeout','timeout'],['malformed','partial'],['error-event','partial'],
  ['timeout','timeout'],['verifyfail','partial',['false']],['success','complete']
]) {
  check(`Gemini ${mode} → ${expected}`, () => { const r=fixture(mode,verify); assert(r.stdout.includes(`STATUS: ${expected}`), `observed ${r.stdout}\n${r.stderr}`); assert(!existsSync(join(r.dir,'fallback.txt')), 'old client fallback invoked'); if (expected !== 'complete') assert(r.status !== 0, 'non-complete exit 0'); if (mode==='missing') assert(!existsSync(join(r.dir,'output.txt')), 'fallback wrote file'); if (mode==='success') assert(r.stdout.includes('CHANGES:\noutput.txt') && r.stdout.includes('VERIFIED: test -f output.txt'), 'missing diff or evidence'); });
}
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
check('Codex preflight unavailable in isolated PATH', () => {
  const emptyPath=join(temp,'no-executables'); mkdirSync(emptyPath);
  const env={...process.env,PATH:emptyPath}; delete env.BASH_ENV; delete env.ENV;
  const r=run('/bin/bash',['--noprofile','--norc','-c','command -v codex >/dev/null 2>&1'],{env});
  assert(r.status===1,'isolated preflight did not report unavailable');
  for (const file of ['agents/luna-implementer.md','agents/sol-implementer.md']) assert(read(file).includes('STATUS: unavailable'),file);
});
check('version-1 custom choices preserved', () => { const path=join(temp,'lanes-v1.json'); writeFileSync(path,JSON.stringify({version:1,routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}})); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),path]); assert(r.status===0,r.stderr); const value=JSON.parse(r.stdout); assert(value.broad.model==='gemini-3.8-flash-medium' && value.routine.model==='custom-luna' && value.routine.effort==='low' && value.reviewer.model==='opus','migration lost choices'); assert(JSON.parse(readFileSync(path,'utf8')).version===1,'resolver rewrote config'); });
check('version-1 setup migration is backed up and atomic', () => { const target=join(temp,'save-test','lanes.json'); mkdirSync(dirname(target),{recursive:true}); const old={version:1,custom_setting:'keep',routine:{provider:'openai',model:'custom-luna',effort:'low'},complex:{provider:'openai',model:'gpt-6-sol',effort:'high'},reviewer:{provider:'anthropic',model:'opus'}}; writeFileSync(target,JSON.stringify(old)); const choices=join(temp,'choices.json'); writeFileSync(choices,JSON.stringify({routine:old.routine,broad:{provider:'google',model:'gemini-3.8-flash-medium'},complex:old.complex,reviewer:old.reviewer})); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status===0,r.stderr); const output=JSON.parse(r.stdout), saved=JSON.parse(readFileSync(target,'utf8')); assert(saved.version===2 && saved.custom_setting==='keep' && saved.routine.model==='custom-luna' && saved.reviewer.model==='opus' && saved.broad.model==='gemini-3.8-flash-medium','bad migration'); assert(JSON.parse(readFileSync(output.backup,'utf8')).version===1,'missing backup'); });
check('invalid migration leaves existing config untouched', () => { const target=join(temp,'invalid-lanes.json'); const old='{"version":3,"custom":"keep"}'; writeFileSync(target,old); const choices=join(temp,'choices.json'); const r=run('node',[join(root,'scripts/save-lanes.mjs'),choices,target]); assert(r.status!==0,'accepted future version'); assert(readFileSync(target,'utf8')===old,'config changed'); });
check('explicit legacy broad pin is preserved with a warning', () => { const target=join(temp,'legacy.json'); const old=JSON.stringify({version:2,broad:{provider:'google',model:'gemini-3.8-flash'}}); writeFileSync(target,old); const r=run('node',[join(root,'scripts/resolve-lanes.mjs'),target]); assert(r.status===0 && JSON.parse(r.stdout).broad.model==='gemini-3.8-flash' && r.stderr.includes('legacy'), 'legacy pin silently changed'); assert(readFileSync(target,'utf8')===old,'user config was rewritten'); });
check('setup refuses legacy broad slug without overwriting', () => { const target=join(temp,'legacy-save.json'); const old=JSON.stringify({version:2,custom:'keep'}); writeFileSync(target,old); const choices=JSON.parse(readFileSync(join(temp,'choices.json'),'utf8')); choices.broad.model='gemini-3.8-flash'; const input=join(temp,'legacy-choice.json'); writeFileSync(input,JSON.stringify(choices)); const r=run('node',[join(root,'scripts/save-lanes.mjs'),input,target]); assert(r.status!==0 && readFileSync(target,'utf8')===old,'legacy migration lost user config'); });

check('agent delegates configured model instead of hardcoding the default', () => {
  assert(!/FABLE_GEMINI_MODEL="gemini-3\.8-flash-medium"/.test(read('agents/gemini-implementer.md')), 'hardcoded agent override');
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
  ['permission denied','echo "permission denied" >&2; exit 1',0o755,'blocked',1],
  ['policy denied','echo "blocked by policy" >&2; exit 1',0o755,'blocked',1],
  ['ordinary failure','echo "assertion failed" >&2; exit 1',0o755,'partial',1]
]) check(`verification ${label} → ${expected} without retry`, () => {
  const r=fixture('verify-denial',['./verify'],{verifier,verifierMode:mode});
  assert(r.status!==0 && r.stdout.includes(`STATUS: ${expected}`) && r.stdout.includes(`verification attempted; exit ${exitCode}`),r.stdout+r.stderr);
  const calls=join(r.dir,'verifier-calls');
  assert(mode===0o644 ? !existsSync(calls) : readFileSync(calls,'utf8')==='invoked\n','verifier retried or bypassed');
  assert(!existsSync(join(r.dir,'fallback.txt')),'fallback invoked');
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
