// Generates the installable-app icons in public/icons from an inline SVG.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const paw = (padding) => {
  const s = 512;
  const inner = s - padding * 2;
  const k = inner / 512;
  const t = (x, y) => `${padding + x * k},${padding + y * k}`;
  const toe = (cx, cy, rx, ry, rot) =>
    `<ellipse cx="${padding + cx * k}" cy="${padding + cy * k}" rx="${rx * k}" ry="${ry * k}" transform="rotate(${rot} ${t(cx, cy).replace(',', ' ')})" fill="#fff"/>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6b46c1"/>
      <stop offset="1" stop-color="#3182ce"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#g)"/>
  ${toe(150, 205, 42, 56, -20)}
  ${toe(222, 150, 44, 60, -5)}
  ${toe(300, 150, 44, 60, 5)}
  ${toe(372, 205, 42, 56, 20)}
  <path d="M${t(256, 250)} C${t(330, 250)} ${t(395, 330)} ${t(385, 375)} C${t(375, 425)} ${t(310, 410)} ${t(256, 410)} C${t(202, 410)} ${t(137, 425)} ${t(127, 375)} C${t(117, 330)} ${t(182, 250)} ${t(256, 250)} Z" fill="#fff"/>
</svg>`;
};

await mkdir('public/icons', { recursive: true });
// "any" icons use a small margin; maskable icons keep the paw inside the safe zone.
for (const size of [192, 512]) {
  await sharp(Buffer.from(paw(40))).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  await sharp(Buffer.from(paw(110))).resize(size, size).png().toFile(`public/icons/maskable-${size}.png`);
}
await sharp(Buffer.from(paw(40))).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons written to public/icons');
