// Run this script to generate extension icons:  node chrome-extension/generate-icons.js
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generateIcon(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="#7c3aed"/>
    <text x="50%" y="54%" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.55)}" font-weight="bold"
      fill="white" text-anchor="middle" dominant-baseline="middle">M</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(join(__dirname, 'icons', `icon${size}.png`));

  console.log(`Generated icon${size}.png`);
}

await generateIcon(16);
await generateIcon(48);
await generateIcon(128);
console.log('All icons generated!');
