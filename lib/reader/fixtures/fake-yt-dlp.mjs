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
    const entries = url.includes('PLwithbadone')
      ? [{ id: 'eeeeeeeeeee', title: 'Chapter 1' }, { id: 'BADBADBAD00', title: 'Chapter 2' }]
      : [{ id: 'aaaaaaaaaaa', title: 'Lecture 1' }, { id: 'bbbbbbbbbbb', title: 'Lecture 2' }];
    process.stdout.write(JSON.stringify({ _type: 'playlist', title: 'Lecture series', entries }));
  } else {
    const id = new URL(url).searchParams.get('v');
    // A book of nearly 28 hours: its best sound is well over 1 GB.
    const long = id === 'LONGLONGLON';
    const duration = long ? 100_000 : 125;
    const formats = long ? [
      { format_id: '249', vcodec: 'none', acodec: 'opus', abr: 50 },
      { format_id: '250', vcodec: 'none', acodec: 'opus', abr: 70 },
      { format_id: '251', vcodec: 'none', acodec: 'opus', abr: 130 },
      { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 1_612_000_000 },
      { format_id: '18', vcodec: 'avc1', acodec: 'mp4a.40.2', tbr: 500 },
    ] : undefined;
    process.stdout.write(JSON.stringify({ id, title: `Video ${id}`, channel: 'A channel', duration, chapters: [{ start_time: 0, title: 'Start' }, { start_time: 60, title: 'Middle' }], ...(formats ? { formats } : {}) }));
  }
  process.exit(0);
}
if (url.includes('TOOBIGTOOBI')) {
  // What yt-dlp really does with a file over --max-filesize: says so, saves nothing, and calls it a success.
  process.stdout.write('[download] File is larger than max-filesize (4000000000 bytes > 3221225472 bytes). Aborting.\n');
  process.exit(0);
}
const format = args[args.indexOf('-f') + 1].split('/')[0];
const out = args[args.indexOf('-o') + 1].replace('%(ext)s', /^(249|250|251)$/.test(format) ? 'webm' : 'm4a');
for (const done of [25, 50, 100]) process.stdout.write(`dl ${done} 100 NA\n`);
fs.writeFileSync(out, Buffer.alloc(1000, 7));
if (process.env.FAKE_TOOLS_LOG) fs.appendFileSync(process.env.FAKE_TOOLS_LOG, `yt-dlp ${args.join(' ')}\n`);
