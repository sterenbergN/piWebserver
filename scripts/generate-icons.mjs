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

// The recipe box's own app icon: a wooden box of index cards with a brass label.
const recipeBox = (padding) => {
  const s = 512;
  const k = (s - padding * 2) / 512;
  const x = (v) => padding + v * k;
  const card = (cardX, y, tilt, tab) => `
    <g transform="rotate(${tilt} ${x(256)} ${x(300)})">
      <rect x="${x(cardX)}" y="${x(y)}" width="${320 * k}" height="${220 * k}" rx="${8 * k}" fill="#f6ecd2"/>
      <rect x="${x(cardX)}" y="${x(y + 34)}" width="${320 * k}" height="${5 * k}" fill="#c2574f"/>
      <rect x="${x(cardX + 22)}" y="${x(y + 62)}" width="${276 * k}" height="${4 * k}" fill="#8fa6c4"/>
      <rect x="${x(cardX + 22)}" y="${x(y + 92)}" width="${276 * k}" height="${4 * k}" fill="#8fa6c4"/>
      ${tab ? `<rect x="${x(cardX + tab)}" y="${x(y - 26)}" width="${88 * k}" height="${34 * k}" rx="${8 * k}" fill="#e3c98f"/>` : ''}
    </g>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a6336"/>
      <stop offset="1" stop-color="#5f3a1e"/>
    </linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ecd28a"/>
      <stop offset="1" stop-color="#a98434"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="#2b1a0e"/>
  <rect x="${x(48)}" y="${x(150)}" width="${416 * k}" height="${250 * k}" rx="${16 * k}" fill="#3a2312"/>
  ${card(96, 92, -3, 40)}
  ${card(96, 122, 2, 190)}
  ${card(96, 156, -1, 0)}
  <rect x="${x(36)}" y="${x(270)}" width="${440 * k}" height="${178 * k}" rx="${18 * k}" fill="url(#wood)"/>
  <path d="M${x(36)} ${x(320)} H${x(476)} M${x(36)} ${x(372)} H${x(476)} M${x(36)} ${x(414)} H${x(476)}" stroke="#4d2e17" stroke-width="${3 * k}" opacity="0.45"/>
  <rect x="${x(166)}" y="${x(312)}" width="${180 * k}" height="${86 * k}" rx="${8 * k}" fill="url(#brass)"/>
  <rect x="${x(180)}" y="${x(326)}" width="${152 * k}" height="${58 * k}" rx="${3 * k}" fill="#f6ecd2"/>
  <path d="M${x(198)} ${x(344)} H${x(314)} M${x(198)} ${x(366)} H${x(282)}" stroke="#2a3b6b" stroke-width="${7 * k}" stroke-linecap="round"/>
</svg>`;
};
for (const size of [192, 512]) {
  await sharp(Buffer.from(recipeBox(16))).resize(size, size).png().toFile(`public/icons/recipes-${size}.png`);
  await sharp(Buffer.from(recipeBox(84))).resize(size, size).png().toFile(`public/icons/recipes-maskable-${size}.png`);
}
await sharp(Buffer.from(recipeBox(16))).resize(180, 180).png().toFile('public/icons/recipes-apple-touch-icon.png');
