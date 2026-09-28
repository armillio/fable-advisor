#!/usr/bin/env node
// Fingerprint reviewable paths without dereferencing symlinks or special files.
import { execFileSync } from 'node:child_process';
import { lstatSync, readlinkSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
function fingerprint(path) {
  const parts=path.split('/');
  if (isAbsolute(path) || parts.some(part=>!part || part==='.' || part==='..')) throw new Error('Invalid Git path');
  // Tracked descendants can remain in the index after a directory becomes a link.
  for (let i=1;i<parts.length;i++) {
    let parent;
    try { parent=lstatSync(join(...parts.slice(0,i))); }
    catch(error) { if(error.code==='ENOENT') return 'MISSING'; throw error; }
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Unsupported parent path');
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

try {
  const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const rows=[...new Set(paths)].sort().map(path=>`${JSON.stringify(path).slice(1,-1)}\t${fingerprint(path)}`);
  process.stdout.write(rows.join('\n')+'\n');
} catch {
  // Do not expose arbitrary path/error data, or treat an incomplete scan as evidence.
  console.error('Cannot safely fingerprint worktree; inspect unsupported, unreadable, or concurrently changed paths.');
  process.exitCode=1;
}
