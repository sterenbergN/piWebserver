// A stand-in for yt-dlp in youtube.test.ts: answers the two ways the worker calls
// it (-J to describe, and a download) without touching the network.
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = args[args.length - 1];
if (url.includes('BADBADBAD00')) {
  process.stderr.write('ERROR: [youtube] BADBADBAD00: Video unavailable\n');
  process.exit(1);
}
if (args.includes('-J')) {
  if (url.includes('playlist')) {
    process.stdout.write(JSON.stringify({ _type: 'playlist', title: 'Lecture series', entries: [{ id: 'aaaaaaaaaaa', title: 'Lecture 1' }, { id: 'bbbbbbbbbbb', title: 'Lecture 2' }] }));
  } else {
    const id = new URL(url).searchParams.get('v');
    process.stdout.write(JSON.stringify({ id, title: `Video ${id}`, channel: 'A channel', duration: 125, chapters: [{ start_time: 0, title: 'Start' }, { start_time: 60, title: 'Middle' }] }));
  }
  process.exit(0);
}
const out = args[args.indexOf('-o') + 1].replace('%(ext)s', 'm4a');
for (const done of [25, 50, 100]) process.stdout.write(`dl ${done} 100 NA\n`);
fs.writeFileSync(out, Buffer.alloc(1000, 7));
