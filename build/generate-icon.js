const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const outDir = path.join(__dirname, 'icon.iconset');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function drawRoundedRectIcon(size) {
  const png = new PNG({ width: size, height: size });

  const bg = { r: 10, g: 10, b: 10, a: 255 };
  const c1 = { r: 194, g: 194, b: 194, a: 255 };
  const c2 = { r: 105, g: 105, b: 105, a: 255 };

  const margin = Math.round(size * 0.11);
  const x0 = margin;
  const y0 = margin;
  const x1 = size - margin - 1;
  const y1 = size - margin - 1;
  const radius = Math.round(size * 0.2);

  function insideRoundedRect(x, y) {
    if (x >= x0 + radius && x <= x1 - radius) return y >= y0 && y <= y1;
    if (y >= y0 + radius && y <= y1 - radius) return x >= x0 && x <= x1;

    const corners = [
      { cx: x0 + radius, cy: y0 + radius },
      { cx: x1 - radius, cy: y0 + radius },
      { cx: x0 + radius, cy: y1 - radius },
      { cx: x1 - radius, cy: y1 - radius },
    ];

    for (const corner of corners) {
      const dx = x - corner.cx;
      const dy = y - corner.cy;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      png.data[idx] = bg.r;
      png.data[idx + 1] = bg.g;
      png.data[idx + 2] = bg.b;
      png.data[idx + 3] = bg.a;

      if (insideRoundedRect(x, y)) {
        const t = y / (size - 1);
        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);

        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;

        const borderDist = Math.min(
          Math.abs(x - x0),
          Math.abs(x - x1),
          Math.abs(y - y0),
          Math.abs(y - y1)
        );

        if (borderDist < Math.max(1, Math.round(size * 0.012))) {
          const boost = 24;
          png.data[idx] = clamp(r + boost, 0, 255);
          png.data[idx + 1] = clamp(g + boost, 0, 255);
          png.data[idx + 2] = clamp(b + boost, 0, 255);
        }
      }
    }
  }

  return png;
}

function writePng(filePath, png) {
  return new Promise((resolve, reject) => {
    png
      .pack()
      .pipe(fs.createWriteStream(filePath))
      .on('finish', resolve)
      .on('error', reject);
  });
}

async function main() {
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  for (const [name, size] of entries) {
    const filePath = path.join(outDir, name);
    const png = drawRoundedRectIcon(size);
    await writePng(filePath, png);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
