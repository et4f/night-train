/**
 * 第七步：把 web/ + data/ 组装成 docs/，供 GitHub Pages「从分支 /docs 发布」直接使用
 * 这样不需要 Actions 也能上线；配合 refresh.yml 每天自动重建。
 *
 * 输出：docs/
 *   index.html  app.js  live.js  style.css  assets/  data/app.json  .nojekyll
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'web');
const DOCS = path.join(ROOT, 'docs');

async function copyDir(src, dest, skip = []) {
  await fs.mkdir(dest, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    if (skip.includes(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  await fs.rm(DOCS, { recursive: true, force: true });
  await copyDir(WEB, DOCS);
  await fs.mkdir(path.join(DOCS, 'data'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'data', 'app.json'), path.join(DOCS, 'data', 'app.json'));
  await fs.writeFile(path.join(DOCS, '.nojekyll'), '');
  await fs.writeFile(
    path.join(DOCS, 'robots.txt'),
    'User-agent: *\nAllow: /\n'
  );

  const files = [];
  async function walk(d) {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(DOCS);
  let total = 0;
  for (const f of files) total += (await fs.stat(f)).size;
  console.log(`docs/ 生成完成：${files.length} 个文件，共 ${(total / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
