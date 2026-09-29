#!/usr/bin/env node
// Fingerprint reviewable paths without dereferencing symlinks or special files.
import { spawn } from 'node:child_process';
import { lstatSync, readlinkSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
function displayPath(path) {
  const decoded=path.toString('utf8');
  if (Buffer.from(decoded).equals(path)) return JSON.stringify(decoded).slice(1,-1);
  // Invalid UTF-8 must remain byte-distinct from a real replacement character.
  return [...path].map(byte=>`\\x${byte.toString(16).padStart(2,'0')}`).join('');
}
function fingerprint(path) {
  const parts=[];
  for (let start=0;start<=path.length;) {
    const slash=path.indexOf(47,start);
    if (slash<0) { parts.push(path.subarray(start)); break; }
    parts.push(path.subarray(start,slash)); start=slash+1;
  }
  if (path[0]===47 || parts.some(part=>!part.length || part.equals(Buffer.from('.')) || part.equals(Buffer.from('..')))) throw new Error('Invalid Git path');
  // Tracked descendants can remain in the index after a directory becomes a link.
  let prefixLength=0;
  for (let i=1;i<parts.length;i++) {
    prefixLength+=parts[i-1].length;
    let parent;
    try { parent=lstatSync(path.subarray(0,prefixLength)); }
    catch(error) { if(error.code==='ENOENT') return 'MISSING'; throw error; }
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Unsupported parent path');
    prefixLength++;
  }
  let stat;
  try { stat=lstatSync(path); }
  catch(error) { if(error.code==='ENOENT') return 'MISSING'; throw error; }
  if(stat.isSymbolicLink()) return `LINK:${hash(readlinkSync(path,{encoding:'buffer'}))}`;
  if(!stat.isFile()) throw new Error('Unsupported non-regular file');
  if(constants.O_NOFOLLOW===undefined || constants.O_NONBLOCK===undefined) throw new Error('Safe file-open flags unavailable');
  // O_NOFOLLOW prevents a leaf swap to a link; O_NONBLOCK prevents a FIFO swap
  // from hanging before fstat can reject it. Only regular descriptors are read.
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const opened=fstatSync(fd);
    if(!opened.isFile() || opened.dev!==stat.dev || opened.ino!==stat.ino) throw new Error('File changed during scan');
    const digest=createHash('sha256'), buffer=Buffer.alloc(65536);
    let offset=0;
    while(offset<opened.size) {
      const count=readSync(fd,buffer,0,Math.min(buffer.length,opened.size-offset),offset);
      if(!count) throw new Error('File changed during scan');
      digest.update(buffer.subarray(0,count)); offset+=count;
    }
    const after=fstatSync(fd);
    if(after.size!==opened.size || after.mtimeMs!==opened.mtimeMs || after.ctimeMs!==opened.ctimeMs) throw new Error('File changed during scan');
    return `FILE:${opened.mode & 0o777}:${digest.digest('hex')}`;
  } finally { closeSync(fd); }
}

async function worktreePaths() {
  // Stream NUL-delimited paths rather than imposing execFileSync's output cap.
  const git=spawn('git',['ls-files','-z','--cached','--others','--exclude-standard'],{stdio:['ignore','pipe','ignore']});
  const finished=new Promise(resolve=>{
    git.once('error',()=>resolve(false));
    git.once('close',code=>resolve(code===0));
  });
  const paths=new Map();
  let pending=Buffer.alloc(0);
  for await (const chunk of git.stdout) {
    let start=0, end;
    while ((end=chunk.indexOf(0,start))!==-1) {
      const path=Buffer.concat([pending,chunk.subarray(start,end)]);
      if(path.length) paths.set(path.toString('hex'),path);
      pending=Buffer.alloc(0); start=end+1;
    }
    if(start<chunk.length) pending=Buffer.concat([pending,chunk.subarray(start)]);
  }
  if(!await finished || pending.length) throw new Error('Incomplete Git path list');
  return [...paths.values()].sort(Buffer.compare);
}

try {
  const paths=await worktreePaths();
  const rows=paths.map(path=>`${displayPath(path)}\t${fingerprint(path)}`);
  process.stdout.write(rows.join('\n')+'\n');
} catch {
  // Do not expose arbitrary path/error data, or treat an incomplete scan as evidence.
  console.error('Cannot safely fingerprint worktree; inspect unsupported, unreadable, or concurrently changed paths.');
  process.exitCode=1;
}
