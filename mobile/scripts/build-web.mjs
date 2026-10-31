/**
 * 把仓库根目录的 PWA 资源同步到 mobile/www，供 Capacitor 打包。
 * 保持单一事实来源：网页仍然在根目录维护，壳工程只做复制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.resolve(here, '../www');

const FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'calc.js',
  'sw.js',
  'manifest.webmanifest',
  'icon.svg',
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

const size = FILES.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0);
console.log(`同步 ${FILES.length} 个文件 → ${out}（${(size / 1024).toFixed(1)} KB）`);
