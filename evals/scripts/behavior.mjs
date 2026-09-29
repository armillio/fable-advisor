#!/usr/bin/env node
// Opt-in, token-consuming Claude Code decision evals. No implementation tools.
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sanitize } from './sanitize.mjs';

const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repeatInput=process.env.FABLE_EVAL_REPEATS ?? '1';
if (!/^[1-3]$/.test(repeatInput)) {
  console.error('FABLE_EVAL_REPEATS must be an integer from 1 to 3; no cases were run.');
  process.exit(2);
}
const repeats=Number(repeatInput);
const auth=spawnSync('claude',['auth','status'],{encoding:'utf8',timeout:10000,killSignal:'SIGKILL'});
if (auth.error?.code==='ETIMEDOUT') {
  console.error('UNTESTED: Claude Code authentication probe timed out after 10 seconds; no cases were run.');
  process.exit(2);
}
let state; try { state=JSON.parse(auth.stdout); } catch { state={}; }
if (auth.error || auth.status!==0 || !state.loggedIn) {
  console.error('UNTESTED: Claude Code is not authenticated; behavioral integration evals were not run.');
  process.exit(2);
}
const groups=['routing','escalation','fallback','verification','review'];
const cases=groups.flatMap(group=>readdirSync(join(root,'evals/cases',group)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(root,'evals/cases',group,f),'utf8'))));
const transcriptDir=mkdtempSync(join(tmpdir(),'fable-behavior-'));
const schema={type:'object',properties:{lane:{type:'string',enum:['routine','broad','complex','architect']},status:{type:'string',enum:['complete','partial','timeout','unavailable','refused','blocked']},implementation_by:{type:'string',enum:['none','provider']},next_action:{type:'string',enum:['fable_review','completion','architect_verification']},reason:{type:'string'},complete:{type:'boolean'},events:{type:'array',items:{type:'string'}}},additionalProperties:false};
const expectedKeys=['lane','status','implementation_by','next_action','complete','events'];
const allowedValues={
  lane:new Set(['routine','broad','complex','architect']),
  status:new Set(['complete','partial','timeout','unavailable','refused','blocked']),
  implementation_by:new Set(['none','provider']),
  next_action:new Set(['fable_review','completion','architect_verification'])
};
const allowedEvents=new Set(['implementation','architect_diff','architect_verification','fable_review','completion']);
function safeDecision(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return {};
  const safe={};
  for(const [key,options] of Object.entries(allowedValues)) {
    if(key in value) safe[key]=options.has(value[key])?value[key]:'<INVALID>';
  }
  if('complete' in value) safe.complete=typeof value.complete==='boolean'?value.complete:'<INVALID>';
  if('events' in value) safe.events=Array.isArray(value.events)
    ? value.events.slice(0,20).map(event=>allowedEvents.has(event)?event:'<INVALID>')
    : '<INVALID>';
  return safe;
}
const normalize=(value)=>typeof value==='string'?value.trim().toLowerCase():value;
const rows=[];
for (const test of cases) for (let attempt=1;attempt<=repeats;attempt++) {
  const prompt=`Use the locally loaded fable-advisor orchestration skill. This is an evaluation of an orchestration decision only: do not implement, edit, invoke an implementation agent, or access user configuration. Scenario: ${test.prompt}\nReturn a JSON decision using only relevant fields. For routing/escalation, lane is one of routine, broad, complex, architect. For fallback/verification, status is one of complete, partial, timeout, unavailable, refused, blocked; implementation_by is none when no model implemented. For final-review, next_action is fable_review or completion and events (when asked) uses the ordered enum sequence: implementation, architect_diff, architect_verification, fable_review, completion. Give a short reason.`;
  const args=['--plugin-dir',root,'--print','--output-format','json','--json-schema',JSON.stringify(schema),'--permission-mode','plan','--no-session-persistence','--max-budget-usd','0.25','--tools','Skill',prompt];
  const run=spawnSync('claude',args,{encoding:'utf8',cwd:root,timeout:180000,killSignal:'SIGKILL',maxBuffer:1024*1024});
  const executionStatus=run.error?.code==='ETIMEDOUT' ? 'timeout' : run.error || run.status!==0 ? 'error' : 'complete';
  let observed={};
  try { const outer=JSON.parse(run.stdout); const raw=outer.structured_output??outer.result??outer; observed=typeof raw==='string'?JSON.parse(raw):raw; }
  catch { observed={parse_error:true}; }
  const pass=executionStatus==='complete' && observed !== null && typeof observed==='object' && expectedKeys.every(key=>!(key in test.expected) || JSON.stringify(normalize(observed[key]))===JSON.stringify(normalize(test.expected[key])));
  const ref=join(transcriptDir,`${test.id}-${attempt}.json`);
  // Persist only bounded decision enums and process metadata, never raw stderr
  // or unbounded model prose; arbitrary credentials cannot be regex-redacted.
  const record=sanitize({case:test.id,attempt,expected:test.expected,observed:safeDecision(observed),execution_status:executionStatus,error_code:run.error?.code ?? null,signal:run.signal,exit:run.status,stderr_present:Boolean(run.stderr)},root);
  writeFileSync(ref,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  rows.push({test,attempt,pass,ref});
  console.log(`${pass?'PASS':'FAIL'} ${test.id} run ${attempt} (${executionStatus}): expected ${JSON.stringify(record.expected)}; observed ${JSON.stringify(record.observed)}; ${ref}`);
}
console.log('\nFable Advisor behavioral evals\n');
for (const group of ['Routing','Escalation','Fallback','Verification','Final-review']) {
  const subset=rows.filter(r=>r.test.group===group); console.log(`${group.padEnd(28)} ${subset.filter(r=>r.pass).length}/${subset.length}`);
}
const passed=rows.filter(r=>r.pass).length;
console.log(`\n${passed===rows.length?'PASS':'FAIL'} ${passed}/${rows.length}`);
console.log(`Case transcripts: ${transcriptDir} (temporary, sanitized decision records; delete when no longer needed)`);
process.exitCode=passed===rows.length?0:1;
