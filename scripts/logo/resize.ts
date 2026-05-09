import sharp from 'sharp';
import { mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FINAL_DIR = join(__dirname, '..', '..', 'assets', 'logo', 'final');

const LOGOMARK_SIZES = [1024, 512, 128, 32];

export async function resizeLogomark(sourcePath: string): Promise<void> {
  mkdirSync(FINAL_DIR, { recursive: true });

  for (const size of LOGOMARK_SIZES) {
    const suffix = size === 32 ? 'favicon' : 'logomark';
    const outPath = join(FINAL_DIR, `${suffix}-${size}.png`);
    await sharp(sourcePath)
      .resize(size, size, { fit: 'contain', background: { r: 10, g: 14, b: 18, alpha: 1 } })
      .png()
      .toFile(outPath);
    console.log(`  Saved ${outPath} (${size}x${size})`);
  }
}

export async function resizeLockup(
  sourcePath: string,
  variant: 'vertical' | 'horizontal',
): Promise<void> {
  mkdirSync(FINAL_DIR, { recursive: true });
  const outPath = join(FINAL_DIR, `lockup-${variant}.png`);
  copyFileSync(sourcePath, outPath);
  console.log(`  Saved ${outPath}`);
}

export async function generateLightMode(sourcePath: string, outputName: string): Promise<void> {
  mkdirSync(FINAL_DIR, { recursive: true });
  const outPath = join(FINAL_DIR, `${outputName}-light.png`);
  await sharp(sourcePath)
    .flatten({ background: { r: 245, g: 247, b: 250 } })
    .modulate({ brightness: 1.1, saturation: 0.6 })
    .png()
    .toFile(outPath);
  console.log(`  Saved ${outPath} (light mode)`);
}

if (process.argv[1] && process.argv[1].includes('resize.ts')) {
  const [, , sourcePath, variant] = process.argv;
  if (!sourcePath) {
    console.error('Usage: tsx scripts/logo/resize.ts <source.png> [vertical|horizontal|logomark]');
    process.exit(1);
  }

  (async () => {
    if (variant === 'vertical' || variant === 'horizontal') {
      await resizeLockup(sourcePath, variant);
    } else {
      await resizeLogomark(sourcePath);
    }
    await generateLightMode(sourcePath, variant ?? 'logomark');
    console.log('\nDone! Check assets/logo/final/');
  })().catch(err => {
    console.error('Resize failed:', err);
    process.exit(1);
  });
}
