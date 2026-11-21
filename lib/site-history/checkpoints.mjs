// Choosing the "checkpoints": moments worth looking back at.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `Start of ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * `commits` oldest first: [{d}] where d is "YYYY-MM-DDTHH:MM".
 * `births` maps an area name to the index of the commit that first touched it.
 * Returns [{index, label, kind}] oldest first: the first commit, the first commit of each
 * month, the commit where each area appeared, and the latest commit. One commit never
 * repeats; its labels merge.
 */
export function pickCheckpoints(commits, births) {
  if (!commits.length) return [];
  const byIndex = new Map();
  const add = (index, label, kind) => {
    const hit = byIndex.get(index);
    if (!hit) { byIndex.set(index, { index, labels: [label], kind }); return; }
    hit.labels.push(label);
    if (kind === 'area') hit.kind = 'area';
  };
  add(0, 'First commit', 'start');
  let month = commits[0].d.slice(0, 7);
  commits.forEach((c, i) => {
    const m = c.d.slice(0, 7);
    if (m !== month) { month = m; add(i, monthLabel(m), 'month'); }
  });
  for (const [area, index] of Object.entries(births)) add(index, `${area} is born`, 'area');
  add(commits.length - 1, 'Latest', 'now');
  return [...byIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((c) => ({ index: c.index, label: c.labels.join(' · '), kind: c.kind }));
}

/** "git@github.com:o/r.git" or "https://github.com/o/r.git" -> {owner, repo}, or null. */
export function parseGithubRemote(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec((url || '').trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}
