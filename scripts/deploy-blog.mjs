import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BLOG_PUBLIC = 'E:/project/vuepress-theme-vdoing/docs/public/interface-mode-demo';

console.log('Building InterfaceMode demo for GitHub Pages...');
execSync('npm run build:pages', { cwd: ROOT, stdio: 'inherit' });

if (existsSync(BLOG_PUBLIC)) {
  rmSync(BLOG_PUBLIC, { recursive: true, force: true });
}

cpSync(resolve(ROOT, 'dist'), BLOG_PUBLIC, { recursive: true });
console.log(`\nDeployed demo to: ${BLOG_PUBLIC}`);
console.log('Next: cd to blog project and run npm run deploy');
