// A stand-in for ffmpeg in youtube.test.ts: copies the input to the output, and
// writes down what it was asked, so the test can check AAC is copied, not re-encoded.
import fs from 'node:fs';

const args = process.argv.slice(2);
const input = args[args.indexOf('-i') + 1];
const output = args[args.length - 1];
fs.copyFileSync(input, output);
fs.appendFileSync(`${output}.args`, `${args.join(' ')}\n`);
