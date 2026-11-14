/**
 * 第一步：抓取"车次索引"与"车站字典"（可断点续传）
 *
 * 数据来源（12306 公开接口）：
 *   1) https://search.12306.cn/search/v1/train/search  车次前缀搜索，返回 车次号/始发/终到/train_no
 *   2) https://kyfw.12306.cn/otn/resources/js/framework/station_name.js  车站电报码 + 所属城市
 *
 * 输出：
 *   data/stations.json  { telecode: {name, city, pinyin, province} }
 *   data/index.json     [ {code, trainNo, from, to, stops} ]
 *
 * 用法：node scripts/01-fetch-index.mjs [日期YYYYMMDD] [字母前缀…]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DATE = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
// Z/T/K/Y 是普速卧铺主力；D 字头有「动卧」，G 字头有少量「夜间高铁」（如 G900 香港西九龙→上海虹桥），都要收。
// V 字头是专运列车（不对外售票），N 字头（管内快速）2009 年后已并入 K，
// 这两个前缀在 12306 上查不到任何可售车次。
const PREFIXES = process.argv.slice(3).length ? process.argv.slice(3) : ['Z', 'T', 'K', 'Y', 'D', 'G'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastHit = 0;
const MIN_GAP = 420; // 单线程最小间隔，避免触发风控

async function getJSON(url) {
  let backoff = 1500;
  for (let i = 0; i < 6; i++) {
    const wait = MIN_GAP - (Date.now() - lastHit);
    if (wait > 0) await sleep(wait);
    lastHit = Date.now();
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.12306.cn/' },
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 403 || r.status === 429) throw new Error('RATE ' + r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 5) throw e;
      const wait = /RATE/.test(e.message) ? backoff * (i + 1) : 500;
      console.warn(`    ! ${e.message}，${wait}ms 后重试`);
      await sleep(wait);
    }
  }
}

async function searchPrefix(prefix) {
  const url =
    'https://search.12306.cn/search/v1/train/search?keyword=' +
    encodeURIComponent(prefix) +
    '&date=' +
    DATE +
    '&from_station=&to_station=';
  const j = await getJSON(url);
  return Array.isArray(j.data) ? j.data : [];
}

const found = new Map();

async function crawl(prefix, depth = 0) {
  const rows = await searchPrefix(prefix);
  for (const r of rows) {
    if (!r.train_no) continue;
    found.set(r.train_no, {
      code: r.station_train_code,
      trainNo: r.train_no,
      from: r.from_station,
      to: r.to_station,
      stops: Number(r.total_num) || 0,
    });
  }
  // 接口单次上限 200 条，说明还有更多，按数字位递归细分
  if (rows.length >= 200 && depth < 5) {
    for (let d = 0; d <= 9; d++) await crawl(prefix + d, depth + 1);
  }
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });

  // 断点续传：先读入已有索引
  try {
    const old = JSON.parse(await fs.readFile(path.join(DATA, 'index.json'), 'utf8'));
    for (const t of old) found.set(t.trainNo, t);
    console.log('续传：已有', found.size, '趟');
  } catch {}

  if (!PREFIXES.includes('__skipstations')) {
    try {
      await fs.access(path.join(DATA, 'stations.json'));
    } catch {
      console.log('[1/2] 车站字典…');
      const r = await fetch('https://kyfw.12306.cn/otn/resources/js/framework/station_name.js', {
        headers: { 'User-Agent': UA },
      });
      const js = await r.text();
      const inner = js.slice(js.indexOf("'") + 1, js.lastIndexOf("'"));
      const stations = {};
      for (const item of inner.split('@')) {
        if (!item) continue;
        const f = item.split('|');
        if (!f[2]) continue;
        stations[f[2]] = { name: f[1], city: f[7] || f[1], pinyin: f[3], province: f[8] || '' };
      }
      await fs.writeFile(path.join(DATA, 'stations.json'), JSON.stringify(stations));
      console.log('    车站数：', Object.keys(stations).length);
    }
  }

  console.log('[2/2] 车次索引（前缀递归）…');
  for (const t of PREFIXES) {
    if (t === '__skipstations') continue;
    const before = found.size;
    try {
      await crawl(t);
    } catch (e) {
      // 被 12306 限流时不要整体失败：已抓到的先留着，下一个前缀继续
      console.warn(`    ! ${t} 抓取中断（${e.message}），保留已抓到的 ${found.size} 趟`);
      await sleep(20000);
    }
    await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify([...found.values()]));
    console.log(`    ${t || '(无字母)'}：+${found.size - before}，累计 ${found.size}`);
  }
  console.log('完成，共', found.size, '趟列车');

  // 并入「固定收录」的车次（G 字头枚举容易被限流截断，夜间高铁数量又极少）
  try {
    const pinned = JSON.parse(await fs.readFile(path.join(DATA, 'pinned.json'), 'utf8'));
    let added = 0;
    for (const p of pinned) {
      if (!found.has(p.trainNo)) {
        found.set(p.trainNo, { code: p.code, trainNo: p.trainNo, from: '', to: '', stops: 0 });
        added++;
      }
    }
    if (added) console.log(`    并入固定车次 ${added} 趟`);
    await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify([...found.values()]));
  } catch {
    /* 没有 pinned.json 就跳过 */
  }

  // 抓到足够多就算成功（限流导致少几个前缀也不影响出站）
  if (found.size < 500) throw new Error('车次索引过少，可能被限流，放弃本次更新');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
