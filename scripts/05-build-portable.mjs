/**
 * 第五步：打包「单文件版」——CSS、JS、数据、底图全部内联进一个 HTML
 * 双击即可离线使用，不需要 Node、不需要服务器、不需要联网。
 * 输出：dist/夜宿火车.html  以及可直接发人的 夜宿火车-便携版.zip
 */
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

/* ---------- 极简 ZIP 写入（store/deflate，文件名 UTF-8） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

async function main() {
  const [html, css, js, wx, appJSON, img] = await Promise.all([
    fs.readFile(path.join(ROOT, 'web/index.html'), 'utf8'),
    fs.readFile(path.join(ROOT, 'web/style.css'), 'utf8'),
    fs.readFile(path.join(ROOT, 'web/app.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'web/weather.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'data/app.json'), 'utf8'),
    fs.readFile(path.join(ROOT, 'web/assets/china-standard-map.png')),
  ]);

  const bundle = JSON.stringify({ app: JSON.parse(appJSON) });
  const imgURI = 'data:image/png;base64,' + img.toString('base64');

  let out = html
    .replace('<link rel="stylesheet" href="style.css" />', `<style>\n${css}\n</style>`)
    .replace('<script src="live.js"></script>\n', '') // 单文件版不联网，不需要实时同步
    .replace('<script src="weather.js"></script>', `<script>\n${wx}\n</script>`)
    .replace(
      '<script src="app.js"></script>',
      `<script>window.__NIGHT_DATA__=${bundle};</script>\n<script>\n${js}\n</script>`
    )
    .replace(/'assets\/china-standard-map\.png'/g, `'${imgURI}'`)
    .replace('「夜宿指数」由', '单文件离线版，双击即可用，无需安装、无需联网。<br />「夜宿指数」由');

  await fs.mkdir(DIST, { recursive: true });
  const file = path.join(DIST, '夜宿火车.html');
  await fs.writeFile(file, out);
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`单文件版 → dist/夜宿火车.html（${kb} KB）`);

  let readme;
  try {
    readme = await fs.readFile(path.join(DIST, '使用说明.txt'));
  } catch {
    readme = Buffer.from('双击「夜宿火车.html」即可使用，无需安装、无需联网。\n', 'utf8');
  }
  const zip = makeZip([
    { name: '夜宿火车.html', data: Buffer.from(out, 'utf8') },
    { name: '使用说明.txt', data: readme },
  ]);
  const zipFile = path.join(ROOT, '夜宿火车-便携版.zip');
  await fs.writeFile(zipFile, zip);
  console.log(`便携包   → 夜宿火车-便携版.zip（${(zip.length / 1024).toFixed(0)} KB）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
