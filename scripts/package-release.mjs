// Assemble a Raspberry Pi release from a standalone build:
//   NEXT_OUTPUT=standalone npm run build && node scripts/package-release.mjs
// Produces release/ (and, with --tar, dist/noahstuf-<id>.tar.gz + .sha256).
//
// The release holds only code. Site data (.data, public/uploads,
// public/content, backups) lives outside releases on the Pi; the tracked
// defaults for new installs are shipped in seed/ and never overwrite data.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, process.env.NEXT_DIST_DIR || '.next-build');
const standalone = path.join(dist, 'standalone');
const out = path.join(root, 'release');
const DATA_PUBLIC = new Set(['uploads', 'content', 'stats-history.json']);

const git = (...args) => { try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const sha = process.env.GITHUB_SHA || git('rev-parse', 'HEAD') || 'unknown';
const id = process.env.RELEASE_ID || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sha.slice(0, 7)}`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Server bundle: server.js, its package.json, traced node_modules and the server build.
await cp(path.join(standalone, 'server.js'), path.join(out, 'server.js'));
await cp(path.join(standalone, 'package.json'), path.join(out, 'package.json'));
await cp(path.join(standalone, 'node_modules'), path.join(out, 'node_modules'), { recursive: true, verbatimSymlinks: true });
await cp(path.join(standalone, path.basename(dist)), path.join(out, path.basename(dist)), { recursive: true });
// Hashed static assets (not copied into standalone by Next).
await cp(path.join(dist, 'static'), path.join(out, path.basename(dist), 'static'), { recursive: true });

// Public assets minus site data.
await mkdir(path.join(out, 'public'), { recursive: true });
for (const entry of await readdir(path.join(root, 'public'))) {
  if (DATA_PUBLIC.has(entry)) continue;
  await cp(path.join(root, 'public', entry), path.join(out, 'public', entry), { recursive: true });
}

// Defaults for a brand-new install (the tracked JSON files only).
for (const file of git('ls-files', 'public/uploads', 'public/content').split('\n').filter(Boolean)) {
  const dest = path.join(out, 'seed', path.relative(path.join(root, 'public'), file));
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(root, file), dest);
}

// The deploy script travels with each release so updates can update it too.
await cp(path.join(root, 'scripts', 'deploy.sh'), path.join(out, 'deploy.sh'));

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(out, 'build-info.json'), JSON.stringify({
  id, sha, version: pkg.version, builtAt: new Date().toISOString(), arch: process.arch, node: process.version,
}, null, 2));
console.log(`Release ${id} assembled in release/`);

if (process.argv.includes('--tar')) {
  await mkdir(path.join(root, 'dist'), { recursive: true });
  const tarName = `noahstuf-${id}.tar.gz`;
  const tarPath = path.join(root, 'dist', tarName);
  execFileSync('tar', ['-czf', tarPath, '-C', out, '.'], { stdio: 'inherit' });
  const hash = createHash('sha256').update(await readFile(tarPath)).digest('hex');
  await writeFile(`${tarPath}.sha256`, `${hash}  ${tarName}\n`);
  await writeFile(path.join(root, 'dist', 'release-id'), id);
  console.log(`dist/${tarName} (sha256 ${hash})`);
}
