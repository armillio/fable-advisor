import { homedir, tmpdir } from 'node:os';

// Redact known credential forms and local paths at every depth, including keys.
export function sanitize(value, root) {
  const clean = text => text.replaceAll(root, '<PLUGIN>').replaceAll(homedir(), '<HOME>')
    .replaceAll(tmpdir(), '<TMP>')
    .replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer <REDACTED>')
    .replace(/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|gl(?:pat|oas|dt|rt|rtr|cbt|ptt|ft|imt|agent|wt|soat|ffct)-[A-Za-z0-9_-]{8,}|(?:xox[bps]|xapp)-[A-Za-z0-9-]{8,})/g, '<REDACTED>');
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key), sanitize(item, root)]));
  return value;
}
