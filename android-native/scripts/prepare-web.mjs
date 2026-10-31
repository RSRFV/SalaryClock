/**
 * 生成 Android 壳用的 www 资源：
 * - 把 calc.js + app.js 合并成普通脚本（WebView file:// 下 ES Module 会被 CORS 拦）
 * - 替换 index.html 的 script 标签
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const www = path.resolve(here, '../assets/www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const calc = fs.readFileSync(path.join(root, 'calc.js'), 'utf8').replace(/^export\s+/gm, '');
const app = fs
  .readFileSync(path.join(root, 'app.js'), 'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/calc\.js';\s*/, '')
  // 壳内不做 Service Worker：资源由 WebViewClient 直接拦截提供
  .replace(/if \('serviceWorker' in navigator[\s\S]*?\n  \}/, '');

fs.writeFileSync(
  path.join(www, 'app.bundle.js'),
  `/* SalaryClock classic bundle (Android WebView) */\n${calc}\n${app}`,
);
fs.copyFileSync(path.join(root, 'styles.css'), path.join(www, 'styles.css'));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(
  /<script type="module" src="\.\/app\.js"><\/script>/,
  '<script src="./app.bundle.js"></script>',
);
fs.writeFileSync(path.join(www, 'index.html'), html);

const size = fs.statSync(path.join(www, 'app.bundle.js')).size;
console.log(`assets ready: www/ (bundle ${(size / 1024).toFixed(1)} KB)`);
