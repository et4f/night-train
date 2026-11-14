/**
 * 第四步：抓取城市经纬度（真经纬度，供前端按标准地图投影换算）
 * 数据来源：阿里云 DataV 行政区划边界（公开）
 * 输出：data/cities.json  { 城市名: [经度, 纬度] }
 *
 * 用法：node scripts/04-fetch-geo.mjs [--deep]
 *   --deep 继续下钻县区级，补齐凯里/大理/格尔木等县级市驻地
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const DEEP = process.argv.includes('--deep');

const fetchJSON = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
  return r.json();
};

const normalize = (n) =>
  String(n).replace(/(市辖区|市|地区|盟|特别行政区|自治州|自治县|林区|区|县)$/u, '');

async function main() {
  console.log('省级…');
  const country = await fetchJSON('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
  const provinceCodes = [];
  const prefectures = [];
  const cities = {};
  // 直辖市与特别行政区：下级不是「市」，直接用省级中心点
  const MUNICIPAL = new Set(['110000', '120000', '310000', '500000', '810000', '820000']);

  for (const f of country.features) {
    const code = String(f.properties.adcode);
    if (!/^\d{6}$/.test(code) || code === '100000') continue;
    provinceCodes.push(code);
    if (MUNICIPAL.has(code)) {
      const c = f.properties.center || f.properties.centroid;
      if (c) cities[normalize(f.properties.name)] ??= c.map((v) => Math.round(v * 1e4) / 1e4);
    }
  }

  console.log('地级市…');
  for (const code of provinceCodes) {
    try {
      const j = await fetchJSON(`https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`);
      for (const f of j.features || []) {
        const p = f.properties || {};
        const c = p.center || p.centroid;
        if (!c || !p.name) continue;
        cities[normalize(p.name)] ??= c.map((v) => Math.round(v * 1e4) / 1e4);
        if (p.level === 'city') prefectures.push(String(p.adcode));
      }
    } catch (e) {
      if (!/710000/.test(code)) console.warn('  !', code, e.message);
    }
  }
  console.log('  城市', Object.keys(cities).length, '地级单位', prefectures.length);

  if (DEEP) {
    console.log('县区级…');
    let added = 0;
    let i = 0;
    const worker = async () => {
      while (i < prefectures.length) {
        const code = prefectures[i++];
        try {
          const j = await fetchJSON(`https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`);
          for (const f of j.features || []) {
            const p = f.properties || {};
            const c = p.center || p.centroid;
            if (!c || !p.name) continue;
            const key = normalize(p.name);
            if (!(key in cities)) {
              cities[key] = c.map((v) => Math.round(v * 1e4) / 1e4);
              added++;
            }
          }
        } catch {
          /* 少数单位没有下级数据 */
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    console.log('  新增', added);
  }

  await fs.writeFile(path.join(DATA, 'cities.json'), JSON.stringify(cities));
  console.log('完成 → data/cities.json，共', Object.keys(cities).length, '个点位');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
