/**
 * Rebuilds src/app/favicon.ico from src/app/icon.svg so the .ico tab icon and
 * the SVG icon are the same mark. Run with `node scripts/build-favicon.mjs`
 * after editing icon.svg.
 *
 * The .ico holds 16/32/48px BMP entries (what browsers reach for in a tab or a
 * bookmarks bar) plus a 64px PNG entry for the places that render it larger.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "src/app/icon.svg");
const OUTPUT = join(root, "src/app/favicon.ico");

const BMP_SIZES = [16, 32, 48];
const PNG_SIZES = [64];

/** A DIB (BMP without its file header): bottom-up BGRA, then a 1-bit AND mask. */
function encodeDib(rgba, size) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // header size
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // image + mask, per the ICO spec
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceRow = (size - 1 - y) * size * 4;
    const targetRow = y * size * 4;
    for (let x = 0; x < size; x += 1) {
      const s = sourceRow + x * 4;
      const t = targetRow + x * 4;
      pixels[t] = rgba[s + 2]; // B
      pixels[t + 1] = rgba[s + 1]; // G
      pixels[t + 2] = rgba[s]; // R
      pixels[t + 3] = rgba[s + 3]; // A
    }
  }

  // Every pixel is opaque-or-alpha-blended, so the legacy mask is all zeros.
  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * size)]);
}

async function buildEntries() {
  const svg = await readFile(SOURCE);
  const entries = [];

  for (const size of BMP_SIZES) {
    const rgba = await sharp(svg, { density: 384 })
      .resize(size, size)
      .ensureAlpha()
      .raw()
      .toBuffer();
    entries.push({ size, data: encodeDib(rgba, size) });
  }

  for (const size of PNG_SIZES) {
    const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    entries.push({ size, data: png });
  }

  return entries;
}

function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    // 256px is written as 0 in the directory; nothing here is that big, but
    // keep the rule so the encoder stays correct if a size is added.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

const entries = await buildEntries();
await writeFile(OUTPUT, packIco(entries));
console.log(
  `Wrote ${OUTPUT} (${entries.map((entry) => `${entry.size}px`).join(", ")})`,
);
