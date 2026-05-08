import fs from 'fs/promises';
import path from 'path';

async function removeThumbnailsSequential(publicPathLike) {
  try {
    const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
    const normalized = publicPathLike.startsWith('/') ? publicPathLike.slice(1) : publicPathLike;
    const thumbPrefix = normalized.replace(/[/\\:]/g, '_');
    const files = await fs.readdir(thumbDir);

    for (const file of files) {
      if (file.startsWith(thumbPrefix)) {
        await fs.unlink(path.join(thumbDir, file));
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function removeThumbnailsParallel(publicPathLike) {
  try {
    const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
    const normalized = publicPathLike.startsWith('/') ? publicPathLike.slice(1) : publicPathLike;
    const thumbPrefix = normalized.replace(/[/\\:]/g, '_');
    const files = await fs.readdir(thumbDir);

    await Promise.all(
      files
        .filter((file) => file.startsWith(thumbPrefix))
        .map((file) => fs.unlink(path.join(thumbDir, file)))
    );
  } catch (e) {
    console.error(e);
  }
}

async function runBenchmark() {
  const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
  await fs.mkdir(thumbDir, { recursive: true });

  const numFiles = 10000;

  // Setup 1: Sequential
  for (let i = 0; i < numFiles; i++) {
    await fs.writeFile(path.join(thumbDir, `test_file_${i}.txt`), 'data');
  }
  let start = performance.now();
  await removeThumbnailsSequential('test');
  let end = performance.now();
  console.log(`Sequential: ${end - start} ms`);

  // Setup 2: Parallel
  for (let i = 0; i < numFiles; i++) {
    await fs.writeFile(path.join(thumbDir, `test_file_${i}.txt`), 'data');
  }
  start = performance.now();
  await removeThumbnailsParallel('test');
  end = performance.now();
  console.log(`Parallel: ${end - start} ms`);
}

runBenchmark();
