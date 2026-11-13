/**
 * 第三步：把 1000+ 份列车时刻表压成前端可直接查询的数据集
 * 输出：data/app.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const SCHED = path.join(DATA, 'schedules');

const toMin = (t) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** 把 "HH:MM" 序列换算成"自始发站当天 0 点起的绝对分钟数"，自动补跨天 */
function absolutize(stops) {
  let day = 0;
  let prev = -1;
  const out = [];
  for (const s of stops) {
    let arr = toMin(s.arr);
    let dep = toMin(s.dep);
    if (arr != null) {
      while (arr + day * 1440 < prev) day++;
      arr = arr + day * 1440;
      prev = arr;
    }
    if (dep != null) {
      while (dep + day * 1440 < prev) day++;
      dep = dep + day * 1440;
      prev = dep;
    }
    out.push([s.station, arr, dep]);
  }
  return out;
}

async function main() {
  const stations = JSON.parse(await fs.readFile(path.join(DATA, 'stations.json'), 'utf8'));
  const nameToCode = {};
  for (const [code, s] of Object.entries(stations)) if (!nameToCode[s.name]) nameToCode[s.name] = code;
  const files = (await fs.readdir(SCHED)).filter((f) => f.endsWith('.json'));

  const trains = [];
  let empty = 0;
  for (const f of files) {
    let s;
    try {
      s = JSON.parse(await fs.readFile(path.join(SCHED, f), 'utf8'));
    } catch {
      continue;
    }
    if (s.empty || !Array.isArray(s.stops) || s.stops.length < 2) {
      empty++;
      continue;
    }
    // 车站名 -> 电报码
    const stops = [];
    let ok = true;
    for (const st of s.stops) {
      const code = st.station && nameToCode[st.station];
      if (!code) {
        ok = false;
        break;
      }
      stops.push({ station: st.station, code, arr: st.arr, dep: st.dep });
    }
    if (!ok) continue;
    const abs = absolutize(stops.map((x) => ({ station: x.code, arr: x.arr, dep: x.dep })));
    trains.push({
      n: s.trainNo,
      c: s.code,
      t: (s.code || '').replace(/[^A-Za-z]/g, '').toUpperCase() || 'K',
      s: abs,
    });
  }

  // 车站与城市字典（只保留真正出现在时刻表里的车站）
  const used = new Set();
  for (const t of trains) for (const st of t.s) used.add(st[0]);
  const st = {};
  const cities = {};
  for (const code of used) {
    const info = stations[code];
    if (!info) continue;
    st[code] = [info.name, info.city];
    (cities[info.city] ||= []).push(code);
  }
  // 同城车站按重要性排序（站名短的优先）
  for (const k of Object.keys(cities)) cities[k].sort((a, b) => st[a][0].length - st[b][0].length);

  // 城市经纬度（前端按标准地图的投影换算成像素）
  const geoRaw = JSON.parse(await fs.readFile(path.join(DATA, 'cities.json'), 'utf8'));
  const norm = (n) => String(n).replace(/(市辖区|市|地区|盟|特别行政区|自治州|自治县|林区|区|县)$/u, '');
  const geo = {};
  let geoMiss = 0;
  for (const city of Object.keys(cities)) {
    let hit = geoRaw[city] || geoRaw[norm(city)];
    if (!hit) {
      for (const suf of ['市', '区', '县', '地区', '盟', '自治州']) {
        if (geoRaw[norm(city) + suf]) { hit = geoRaw[norm(city) + suf]; break; }
        if (geoRaw[city + suf]) { hit = geoRaw[city + suf]; break; }
      }
    }
    if (!hit) {
      for (const k of Object.keys(geoRaw)) {
        if (k.length > city.length && k.startsWith(city) && k.length - city.length <= 8) { hit = geoRaw[k]; break; }
      }
    }
    if (hit) geo[city] = hit;
    else geoMiss++;
  }

  trains.sort((a, b) => a.n.localeCompare(b.n));

  const out = {
    meta: {
      generated: new Date().toISOString(),
      trainCount: trains.length,
      stationCount: Object.keys(st).length,
      cityCount: Object.keys(cities).length,
    },
    stations: st,
    cities,
    geo,
    trains,
  };
  await fs.writeFile(path.join(DATA, 'app.json'), JSON.stringify(out));
  console.log(
    `列车 ${trains.length} 趟（空表 ${empty}），车站 ${out.meta.stationCount}，城市 ${out.meta.cityCount}，缺经纬度 ${geoMiss}`
  );
  const size = (await fs.stat(path.join(DATA, 'app.json'))).size;
  console.log('app.json', (size / 1024).toFixed(0), 'KB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
