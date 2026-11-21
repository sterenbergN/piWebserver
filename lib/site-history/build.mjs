// Turning `git log` output into the compact commit list the history page reads.
// Pure (text in, objects out) so it can be tested without a repository.
import { areasForCommit } from './areas.mjs';
import { countsAsCode, renamedTo } from './files.mjs';

export const RS = '\x1e'; // between commits
export const US = '\x1f'; // between fields
/** Pass to `git log` as --format so parseLog can read it. No author names or emails are asked for. */
export const LOG_FORMAT = `${RS}%H${US}%ad${US}%s${US}%b${US}`;

const BODY_LIMIT = 500;
const SUBJECT_LIMIT = 140;

/** Removes emails and trailer lines (Co-Authored-By etc.), collapses blank runs, caps the length. */
export function cleanBody(body) {
  const kept = body
    .split('\n')
    .filter((l) => !/^\s*(co-authored-by|signed-off-by|reviewed-by|acked-by)\s*:/i.test(l))
    .map((l) => l.replace(/<[^<>\s]+@[^<>\s]+>/g, '').replace(/\S+@\S+\.\S+/g, '').trimEnd());
  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > BODY_LIMIT) text = text.slice(0, BODY_LIMIT).replace(/\s+\S*$/, '') + '…';
  return text;
}

/** Parses the text from `git log --reverse --no-merges -M --numstat --date=iso-strict --format=LOG_FORMAT`. */
export function parseLog(text) {
  const out = [];
  for (const record of text.split(RS)) {
    if (!record.trim()) continue;
    const [hash, date, subject, body, rest = ''] = record.split(US);
    if (!hash || !date) continue;
    const files = [];
    for (const line of rest.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      files.push({ path: renamedTo(m[3]), add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
    }
    out.push({ hash: hash.trim(), date: date.trim(), subject: subject.trim(), body: body ?? '', files });
  }
  return out;
}

/**
 * One compact commit:
 *   h short hash, d author-local "YYYY-MM-DDTHH:MM", s subject, b cleaned body (omitted if empty),
 *   a areas (strongest first), f code files changed, ad/de lines added/removed (code only),
 *   tf up to three biggest changed code files.
 */
export function shapeCommit(c) {
  const code = c.files.filter((f) => !f.binary && countsAsCode(f.path, f.add + f.del));
  const ad = code.reduce((n, f) => n + f.add, 0);
  const de = code.reduce((n, f) => n + f.del, 0);
  const weighted = (code.length ? code : c.files).map((f) => ({ path: f.path, weight: code.length ? f.add + f.del : 1 }));
  const body = cleanBody(c.body);
  const shape = {
    h: c.hash.slice(0, 8),
    d: c.date.slice(0, 16),
    s: c.subject.slice(0, SUBJECT_LIMIT),
    a: areasForCommit(c.subject, weighted),
    f: code.length,
    ad,
    de,
    tf: [...code].sort((x, y) => y.add + y.del - (x.add + x.del)).slice(0, 3).map((f) => f.path),
  };
  if (body) shape.b = body;
  return shape;
}

/** Index of the first commit to touch each area (oldest-first list of shaped commits). */
export function areaBirths(commits) {
  const births = {};
  commits.forEach((c, i) => {
    for (const a of c.a) if (!(a in births) && a !== 'Other') births[a] = i;
  });
  return births;
}
