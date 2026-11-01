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

// The Reader's own app icon: an open book on deep night blue, with a warm page.
const book = (padding) => {
  const s = 512;
  const k = (s - padding * 2) / 512;
  const t = (x, y) => `${padding + x * k} ${padding + y * k}`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#14161c"/>
  <path d="M${t(256, 150)} C${t(210, 112)} ${t(130, 106)} ${t(66, 118)} L${t(66, 382)} C${t(130, 370)} ${t(210, 376)} ${t(256, 414)} Z" fill="#f3e8d2"/>
  <path d="M${t(256, 150)} C${t(302, 112)} ${t(382, 106)} ${t(446, 118)} L${t(446, 382)} C${t(382, 370)} ${t(302, 376)} ${t(256, 414)} Z" fill="#e6b25a"/>
  <path d="M${t(112, 182)} C${t(150, 178)} ${t(186, 184)} ${t(216, 200)} M${t(112, 240)} C${t(150, 236)} ${t(186, 242)} ${t(216, 258)} M${t(112, 298)} C${t(150, 294)} ${t(186, 300)} ${t(216, 316)}" fill="none" stroke="#b9a988" stroke-width="${12 * k}" stroke-linecap="round"/>
</svg>`;
};
for (const size of [192, 512]) {
  await sharp(Buffer.from(book(24))).resize(size, size).png().toFile(`public/icons/reader-${size}.png`);
  await sharp(Buffer.from(book(90))).resize(size, size).png().toFile(`public/icons/reader-maskable-${size}.png`);
}
await sharp(Buffer.from(book(24))).resize(180, 180).png().toFile('public/icons/reader-apple-touch-icon.png');
