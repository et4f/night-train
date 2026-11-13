/**
 * 第六步：从「自然资源部 标准地图服务」（bzdt.ch.mnr.gov.cn）取官方标准地图底图
 *
 * 用的是标准地图服务自带的 SuperMap 地图服务，按全国范围渲染成一张 1600×1200 的图。
 * 地图审图号：GS(2016)1614   自然资源部 监制
 *
 * 输出：web/assets/china-standard-map.png
 *
 * 用法：node scripts/06-fetch-basemap.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'web', 'assets', 'china-standard-map.png');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36';

const MAP = '6000万中华人民共和国_基础要素地图';
const ROOT_URL = `http://bzdt.ch.mnr.gov.cn/iserver/services/map-6000_China_Map/rest/maps/${encodeURIComponent(MAP)}`;

// 图幅范围（服务自带的平面坐标，非经纬度；经纬度换算见 web/map.js 里的 LCC 参数）
const BOUNDS = {
  left: -3511674.1766,
  bottom: -408916.36978583655,
  right: 2912690.0824826597,
  top: 6499238.202835779,
};

async function main() {
  const url =
    `${ROOT_URL}/image.png?width=1600&height=1200&transparent=false&paintBackground=true` +
    `&viewBounds=${encodeURIComponent(JSON.stringify(BOUNDS))}`;
  console.log('下载官方标准地图…');
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.headers.get('content-type')?.includes('image')) throw new Error('返回的不是图片');

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, buf);
  console.log(`完成 → web/assets/china-standard-map.png（${(buf.length / 1024).toFixed(0)} KB）`);
  console.log('审图号：GS(2016)1614 —— 使用时请勿裁切或修改地图形状。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
