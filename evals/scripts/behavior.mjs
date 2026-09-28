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
const auth=spawnSync('claude',['auth','status'],{encoding:'utf8'});
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
const normalize=(value)=>typeof value==='string'?value.trim().toLowerCase():value;
const rows=[];
for (const test of cases) for (let attempt=1;attempt<=repeats;attempt++) {
  const prompt=`Use the locally loaded fable-advisor orchestration skill. This is an evaluation of an orchestration decision only: do not implement, edit, invoke an implementation agent, or access user configuration. Scenario: ${test.prompt}\nReturn a JSON decision using only relevant fields. For routing/escalation, lane is one of routine, broad, complex, architect. For fallback/verification, status is one of complete, partial, timeout, unavailable, refused, blocked; implementation_by is none when no model implemented. For final-review, next_action is fable_review or completion and events (when asked) uses the ordered enum sequence: implementation, architect_diff, architect_verification, fable_review, completion. Give a short reason.`;
  const args=['--plugin-dir',root,'--print','--output-format','json','--json-schema',JSON.stringify(schema),'--permission-mode','plan','--no-session-persistence','--max-budget-usd','0.25','--tools','Skill',prompt];
  const run=spawnSync('claude',args,{encoding:'utf8',cwd:root,timeout:180000,maxBuffer:1024*1024});
  let observed={};
  try { const outer=JSON.parse(run.stdout); const raw=outer.structured_output??outer.result??outer; observed=typeof raw==='string'?JSON.parse(raw):raw; }
  catch { observed={parse_error:true}; }
  const pass=run.status===0 && observed !== null && typeof observed==='object' && expectedKeys.every(key=>!(key in test.expected) || JSON.stringify(normalize(observed[key]))===JSON.stringify(normalize(test.expected[key])));
  const ref=join(transcriptDir,`${test.id}-${attempt}.json`);
  const record=sanitize({case:test.id,attempt,expected:test.expected,observed,exit:run.status,stderr:run.stderr ?? ''},root);
  record.stderr=record.stderr.slice(0,3000);
  writeFileSync(ref,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  rows.push({test,attempt,pass,ref});
  console.log(`${pass?'PASS':'FAIL'} ${test.id} run ${attempt}: expected ${JSON.stringify(record.expected)}; observed ${JSON.stringify(record.observed)}; ${ref}`);
}
console.log('\nFable Advisor behavioral evals\n');
for (const group of ['Routing','Escalation','Fallback','Verification','Final-review']) {
  const subset=rows.filter(r=>r.test.group===group); console.log(`${group.padEnd(28)} ${subset.filter(r=>r.pass).length}/${subset.length}`);
}
const passed=rows.filter(r=>r.pass).length;
console.log(`\n${passed===rows.length?'PASS':'FAIL'} ${passed}/${rows.length}`);
console.log(`Case transcripts: ${transcriptDir} (temporary, sanitized decision records; delete when no longer needed)`);
process.exitCode=passed===rows.length?0:1;
