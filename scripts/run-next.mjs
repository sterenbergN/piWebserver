import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
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

if (command === 'build' && process.env.NEXT_DIST_DIR) {
  const targetDir = path.join(process.cwd(), process.env.NEXT_DIST_DIR);
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
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
