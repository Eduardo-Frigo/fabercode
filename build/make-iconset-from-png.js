const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const src = path.resolve(__dirname, '../../temp_logo_faber.png');
const out = path.resolve(__dirname, './icon.iconset');

const targets = [
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

(async () => {
  if (!fs.existsSync(src)) {
    throw new Error(`Arquivo não encontrado: ${src}`);
  }

  for (const [name, size] of targets) {
    const outPath = path.join(out, name);
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
      .toFile(outPath);
  }
})();
