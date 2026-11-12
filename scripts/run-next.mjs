import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!command || !['dev', 'build', 'start'].includes(command)) {
  console.error('Usage: node scripts/run-next.mjs <dev|build|start> [args...]');
  process.exit(1);
}

if (command === 'dev') {
  process.env.NEXT_DIST_DIR = '.next-dev';
}

if (command === 'build') {
  process.env.NEXT_DIST_DIR = '.next-build';
  process.env.NEXT_DISABLE_SWC_WORKER = '1';
}

if (command === 'start') {
  process.env.NEXT_DIST_DIR = '.next-build';
}

// The dev server writes its route types afresh at each start, and on this drive a file written
// over a longer one kept the old end: typecheck then failed in .next-dev/dev/types. Starting
// without them means each is a new file.
if (command === 'dev') {
  await rm(path.join(process.cwd(), '.next-dev', 'dev', 'types'), { recursive: true, force: true }).catch(() => {});
}

if (command === 'build' && process.env.NEXT_DIST_DIR) {
  const targetDir = path.join(process.cwd(), process.env.NEXT_DIST_DIR);
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
}

// pdf.js loads its worker, fonts and character maps by address, so they're served from
// public/ in a folder named for the version, always matching the installed package.
if (command !== 'start') {
  const pkg = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
  const { version } = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf-8'));
  const assets = path.join(process.cwd(), 'public', 'reader-assets');
  await rm(assets, { recursive: true, force: true });
  const target = path.join(assets, `pdfjs-${version}`);
  await mkdir(target, { recursive: true });
  await copyFile(path.join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs'), path.join(target, 'pdf.worker.min.mjs'));
  const offline = ['pdf.worker.min.mjs'];
  for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    await cp(path.join(pkg, folder), path.join(target, folder), { recursive: true });
    for (const name of await readdir(path.join(pkg, folder))) offline.push(`${folder}/${name}`);
  }
  // Everything a device should keep to read any PDF with no connection.
  await writeFile(path.join(target, 'offline.json'), JSON.stringify(offline));
}

const isWindows = process.platform === 'win32';
const nextBin = isWindows
  ? 'next'
  : path.join(process.cwd(), 'node_modules', '.bin', 'next');

const child = spawn(nextBin, [command, ...extraArgs], {
  stdio: 'inherit',
  env: process.env,
  shell: isWindows,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
