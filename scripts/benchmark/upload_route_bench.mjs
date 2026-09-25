import { performance } from 'perf_hooks';

// Mock disk I/O latency
const MOCK_LATENCY_MS = 50;
const PHOTO_COUNT = 10;

async function removePhysicalFile(src) {
  return new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
}

const mockPhotos = Array.from({ length: PHOTO_COUNT }, (_, i) => ({ src: `photo-${i}.jpg` }));

function toMediaSrc(src) {
  return `/api/media/${src}`;
}

async function runSequential() {
  const start = performance.now();
  if (Array.isArray(mockPhotos)) {
    for (const photo of mockPhotos) {
      await removePhysicalFile(toMediaSrc(photo.src));
    }
  }
  const end = performance.now();
  return end - start;
}

async function runParallel() {
  const start = performance.now();
  if (Array.isArray(mockPhotos)) {
    await Promise.all(mockPhotos.map((photo) => removePhysicalFile(toMediaSrc(photo.src))));
  }
  const end = performance.now();
  return end - start;
}

async function main() {
  console.log(`Running benchmark with ${PHOTO_COUNT} photos, simulating ${MOCK_LATENCY_MS}ms I/O latency per file...`);

  // Warmup
  await runSequential();
  await runParallel();

  const seqTime = await runSequential();
  console.log(`Sequential execution time: ${seqTime.toFixed(2)}ms`);

  const parTime = await runParallel();
  console.log(`Parallel execution time: ${parTime.toFixed(2)}ms`);

  const improvement = ((seqTime - parTime) / seqTime) * 100;
  console.log(`Improvement: ${improvement.toFixed(2)}% (${(seqTime / parTime).toFixed(2)}x faster)`);
}

main().catch(console.error);
