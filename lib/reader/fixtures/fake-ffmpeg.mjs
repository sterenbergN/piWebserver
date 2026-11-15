// A stand-in for ffmpeg in youtube.test.ts. Asked about a file (no output named), it
// describes two minutes of AAC. Asked to join a list, it writes the files end to end.
// Otherwise it copies the input to the output. What it was asked goes in FAKE_TOOLS_LOG,
// so the test can check AAC is copied and anything else is re-encoded.
import fs from 'node:fs';

const args = process.argv.slice(2);
const input = args[args.indexOf('-i') + 1];
const output = args[args.length - 1];
if (output === input) {
  process.stderr.write(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '${input}':\n  Duration: 00:02:05.50, start: 0.000000, bitrate: 128 kb/s\n  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 127 kb/s (default)\nAt least one output file must be specified\n`);
  process.exit(1);
}
if (process.env.FAKE_TOOLS_LOG) fs.appendFileSync(process.env.FAKE_TOOLS_LOG, `ffmpeg ${args.join(' ')}\n`);
process.stdout.write('out_time_us=60000000\nprogress=continue\n');
if (args[args.indexOf('-f') + 1] === 'concat' && args.includes('-f')) {
  const files = fs.readFileSync(input, 'utf8').split('\n').map((line) => /^file '(.*)'$/.exec(line.trim())?.[1]).filter(Boolean);
  fs.writeFileSync(output, Buffer.concat(files.map((file) => fs.readFileSync(file))));
} else {
  fs.copyFileSync(input, output);
}
process.stdout.write('out_time_us=125000000\nprogress=end\n');
