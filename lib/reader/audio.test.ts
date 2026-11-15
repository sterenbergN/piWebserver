import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  ANY_AUDIO, chapterAt, chooseFormat, cleanChapters, cleanEditedChapters, clock, encodeKbps, joinChapters, playlistEntries, readClock, readFfmpegProgress, readProgressLine, readSoundInfo, readYouTubeLink,
  sharedTitle, spoken, videoDetails,
} from './audio';
import { progressText } from './items';

test('YouTube links are tidied, and nothing else gets through', () => {
  const v = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.deepEqual(readYouTubeLink('https://youtu.be/dQw4w9WgXcQ?t=42'), { kind: 'video', id: 'dQw4w9WgXcQ', url: v });
  assert.deepEqual(readYouTubeLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890&index=3'), { kind: 'video', id: 'dQw4w9WgXcQ', url: v }, 'a video in a playlist is the video');
  assert.equal(readYouTubeLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.url, v);
  assert.equal(readYouTubeLink('  https://music.youtube.com/watch?v=dQw4w9WgXcQ ')?.url, v);
  assert.deepEqual(readYouTubeLink('https://www.youtube.com/playlist?list=PLabcdefghij'), { kind: 'playlist', id: 'PLabcdefghij', url: 'https://www.youtube.com/playlist?list=PLabcdefghij' });
  for (const bad of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'file:///etc/passwd', 'https://www.youtube.com/watch?v=--exec', 'https://www.youtube.com/@channel', 'not a url', 42, 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ']) {
    assert.equal(readYouTubeLink(bad), null, String(bad));
  }
});

test('a video’s details: chapters, cover, and the ones that are refused', () => {
  const info = {
    id: 'dQw4w9WgXcQ', title: '  Rocket  propulsion,   lecture 1 ', channel: 'MIT OCW', duration: 3600,
    chapters: [{ start_time: 0, title: 'Intro' }, { start_time: 600, title: 'Thrust' }, { start_time: 600, title: 'Duplicate' }, { start_time: 4000, title: 'Past the end' }],
    thumbnails: [{ url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120 }, { url: 'https://i.ytimg.com/vi/x/maxres.jpg', width: 1280 }, { url: 'https://evil.example/x.jpg', width: 9999 }],
  };
  const d = videoDetails(info);
  assert.equal(d.title, 'Rocket propulsion, lecture 1');
  assert.equal(d.author, 'MIT OCW');
  assert.deepEqual(d.chapters, [{ start: 0, title: 'Intro' }, { start: 600, title: 'Thrust' }]);
  assert.equal(d.thumbnail, 'https://i.ytimg.com/vi/x/maxres.jpg');
  assert.equal(d.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(cleanChapters([{ start_time: 0, title: 'Only one' }], 100), [], 'one chapter isn’t worth listing');
  assert.throws(() => videoDetails({ ...info, is_live: true }), /Live/);
  assert.throws(() => videoDetails({ ...info, duration: 31 * 3600 }), /hours long/);
  assert.throws(() => videoDetails({ ...info, duration: undefined }), /no length/);
  assert.throws(() => videoDetails({ _type: 'playlist' }), /single video/);
});

test('playlists, progress lines and times', () => {
  assert.deepEqual(playlistEntries({ title: 'Lectures', entries: [{ id: 'dQw4w9WgXcQ', title: 'One' }, { id: 'bad' }, { id: 'aaaaaaaaaaa' }] }), { title: 'Lectures', videos: [{ id: 'dQw4w9WgXcQ', title: 'One' }, { id: 'aaaaaaaaaaa', title: '' }] });
  assert.equal(readProgressLine('dl 50 200 NA'), 0.25);
  assert.equal(readProgressLine('dl 50 NA 100'), 0.5, 'an estimate when the size isn’t known');
  assert.equal(readProgressLine('dl 50 NA NA'), null);
  assert.equal(readProgressLine('[download] Destination: x'), null);
  assert.equal(clock(3723), '1:02:03');
  assert.equal(clock(65), '1:05');
  assert.equal(spoken(4320), '1 h 12 min');
  assert.equal(spoken(2280), '38 min');
  assert.equal(chapterAt([{ start: 0, title: 'a' }, { start: 60, title: 'b' }], 59.9), 1, 'just before a chapter counts as it (seeks land a hair early)');
  assert.equal(chapterAt([{ start: 0, title: 'a' }, { start: 60, title: 'b' }], 30), 0);
  assert.equal(progressText({ anchor: { page: 1800 }, pct: 0.5, at: 1, total: 3600, startedAt: 1 }, 'audio'), '50% · 30 min left');
  assert.equal(progressText(undefined, 'audio'), 'Not started listening');
  assert.equal(progressText({ anchor: { page: 12 }, pct: 0.5, at: 1, total: 24, startedAt: 1 }), '50% · p. 12 of 24', 'books are unchanged');
});

test('which sound to fetch: the best AAC that fits, or the smallest that’s good enough', () => {
  const GB = 1024 ** 3;
  const formats = [
    { format_id: '249', vcodec: 'none', acodec: 'opus', abr: 50 },
    { format_id: '251', vcodec: 'none', acodec: 'opus', abr: 130 },
    { format_id: '139', vcodec: 'none', acodec: 'mp4a.40.5', abr: 48 },
    { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129 },
    { format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', tbr: 600 },
    { format_id: 'sb0', vcodec: 'none', acodec: 'none' },
  ];
  assert.equal(chooseFormat({ formats }, 3600, GB), `140/${ANY_AUDIO}`, 'an hour: the best AAC, kept as it is');
  // Twenty hours of 129 kbit/s is 1.16 GB: the small AAC fits and needs no re-encoding.
  assert.equal(chooseFormat({ formats }, 72_000, GB), `139/${ANY_AUDIO}`);
  // Without it, something has to be re-encoded: fetch one near the rate it'll end up at.
  const noSmallAac = formats.filter((f) => f.format_id !== '139');
  assert.equal(chooseFormat({ formats: noSmallAac }, 72_000, GB), `140/${ANY_AUDIO}`, 'at 96k the 129k AAC is the nearest above');
  assert.equal(chooseFormat({ formats: [...noSmallAac, { format_id: '250', vcodec: 'none', acodec: 'opus', abr: 70 }] }, 100_000, GB), `250/${ANY_AUDIO}`, 'too long for 96k: 64k, from the 70k one');
  assert.equal(chooseFormat({}, 3600, GB), ANY_AUDIO);
  assert.equal(chooseFormat({ formats: [{ format_id: '-o /etc/x', vcodec: 'none', acodec: 'opus', abr: 50 }] }, 3600, GB), ANY_AUDIO, 'nothing odd reaches yt-dlp');
  // A dubbed track is passed over for the original.
  const dubbed = [{ format_id: '140-0', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, language_preference: -1 }, { format_id: '140-1', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, language_preference: 10 }];
  assert.equal(chooseFormat({ formats: dubbed }, 3600, GB), `140-1/${ANY_AUDIO}`);
  assert.equal(encodeKbps(3600, GB), 96);
  assert.equal(encodeKbps(30 * 3600, GB), 64);
  assert.ok((30 * 3600 * 64_000) / 8 < GB, 'the longest book allowed fits at 64k');
});

test('ffmpeg’s progress and its description of a file are read', () => {
  assert.equal(readFfmpegProgress('out_time_us=90500000'), 90.5);
  assert.equal(readFfmpegProgress('out_time_ms=90500000'), 90.5, 'older ffmpeg calls microseconds ms');
  assert.equal(readFfmpegProgress('progress=continue'), null);
  const said = "Input #0, mov,mp4,m4a, from 'a.m4a':\n  Duration: 01:02:05.50, start: 0.000000, bitrate: 128 kb/s\n  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 127 kb/s (default)\n";
  assert.deepEqual(readSoundInfo(said), { codec: 'aac LC', rate: 44100, channels: 'stereo', duration: 3725.5 });
  assert.deepEqual(readSoundInfo('  Stream #0:0: Audio: opus, 48000 Hz, mono, fltp\n'), { codec: 'opus', rate: 48000, channels: 'mono', duration: null });
  assert.equal(readSoundInfo('a.m4a: No such file or directory'), null);
});

test('chapters edited by hand, and several books’ chapters end to end', () => {
  assert.deepEqual(
    cleanEditedChapters([{ start: 600, title: ' Two ' }, { start: 0, title: 'One' }, { start: 600, title: 'Same time' }, { start: 5000, title: 'Past the end' }, { start: 30, title: '' }, 'junk'], 3600),
    [{ start: 0, title: 'One' }, { start: 600, title: 'Two' }],
  );
  assert.deepEqual(cleanEditedChapters([{ start: 12, title: 'Just the one' }], 100), [{ start: 12, title: 'Just the one' }], 'one is allowed when you ask for it');
  assert.deepEqual(cleanEditedChapters('nope', 100), []);
  const joined = joinChapters([
    { title: 'Part 1', duration: 100.4, chapters: [] },
    { title: 'Part 2', duration: 200, chapters: [{ start: 0, title: 'Opening' }, { start: 50, title: 'Later' }] },
    { title: 'Part 3', duration: 60, chapters: [{ start: 20, title: 'After the intro' }, { start: 999, title: 'Not in it' }] },
  ]);
  assert.equal(joined.duration, 360.4);
  assert.deepEqual(joined.chapters, [
    { start: 0, title: 'Part 1' }, { start: 100.4, title: 'Opening' }, { start: 150.4, title: 'Later' }, { start: 300.4, title: 'Part 3' }, { start: 320.4, title: 'After the intro' },
  ]);
});

test('a name for books joined, and times typed in', () => {
  assert.equal(sharedTitle(['Dune, part 1', 'Dune, part 2', 'Dune, Part 3']), 'Dune');
  assert.equal(sharedTitle(['The Hobbit - Chapter 01', 'The Hobbit - Chapter 02']), 'The Hobbit');
  assert.equal(sharedTitle(['Alpha', 'Beta']), '');
  assert.equal(readClock('1:02:03'), 3723);
  assert.equal(readClock(' 4:05 '), 245);
  assert.equal(readClock('90'), 90);
  assert.equal(readClock('1:2:3:4'), null);
  assert.equal(readClock('soon'), null);
});
