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

/** 这趟车有没有可能构成「傍晚发、次日早上到」的区间（用于过滤白天的动车） */
function couldBeOvernight(stops) {
  for (let i = 0; i < stops.length; i++) {
    const dep = stops[i][2];
    if (dep == null || dep % 1440 < 16 * 60) continue; // 16:00 之前发车的不看
    for (let j = i + 1; j < stops.length; j++) {
      const arr = stops[j][1];
      if (arr == null) continue;
      const dur = arr - dep;
      if (dur < 240 || dur > 20 * 60) continue;
      if (Math.floor(arr / 1440) <= Math.floor(dep / 1440)) continue; // 必须跨天
      if (arr % 1440 > 12 * 60) continue; // 到站晚于 12:00
      return true;
    }
  }
  return false;
}

async function main() {
  const stations = JSON.parse(await fs.readFile(path.join(DATA, 'stations.json'), 'utf8'));
  const nameToCode = {};
  for (const [code, s] of Object.entries(stations)) if (!nameToCode[s.name]) nameToCode[s.name] = code;
  const files = (await fs.readdir(SCHED)).filter((f) => f.endsWith('.json'));
  // 每趟车在哪几天开行（0=今天 … 5=第5天）
  const daysMap = new Map();
  try {
    const idx = JSON.parse(await fs.readFile(path.join(DATA, 'index.json'), 'utf8'));
    for (const t of idx) if (Array.isArray(t.days)) daysMap.set(t.trainNo, t.days);
  } catch {
    /* 没有索引就当作每天都开 */
  }

  const trains = [];
  let daysCount = 3;
  let empty = 0;
  let dropped = 0;
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
    const type = (s.code || '').replace(/[^A-Za-z]/g, '').toUpperCase() || 'K';
    // 动车组和高铁绝大多数是白天短途，只有「动卧」和夜间高铁才可能夜宿。
    // 把不可能在夜间运行的 D 车直接丢掉，避免数据白白膨胀。
    if ((type === 'D' || type === 'G') && !couldBeOvernight(abs)) {
      dropped++;
      continue;
    }
    trains.push({ n: s.trainNo, c: s.code, t: type, d: daysMap.get(s.trainNo) || Array.from({ length: daysCount }, (_, i) => i), s: abs });
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

  let baseDate = null;
  let daysReliable = false;
  try {
    const b = JSON.parse(await fs.readFile(path.join(DATA, 'index-base.json'), 'utf8'));
    baseDate = b.baseDate;
    daysReliable = b.complete === true;
    daysCount = b.days || 3;
  } catch {}
  if (!daysReliable) daysMap.clear(); // 抓不全就当作每天都开，避免误杀车次

  const out = {
    meta: {
      generated: new Date().toISOString(),
      baseDate,
      daysReliable,
      days: daysCount,
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
    `列车 ${trains.length} 趟（空表 ${empty}，跳过白天动车 ${dropped}），车站 ${out.meta.stationCount}，城市 ${out.meta.cityCount}，缺经纬度 ${geoMiss}`
  );
  const size = (await fs.stat(path.join(DATA, 'app.json'))).size;
  console.log('app.json', (size / 1024).toFixed(0), 'KB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
