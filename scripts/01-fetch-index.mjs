/**
 * 第一步：抓「车次索引」+「车站字典」——按未来 6 天各抓一遍
 *
 * 为什么抓 6 天：列车不是每天都开。周末线、隔日开行、高峰线都在变，
 * 只抓一天会把「明天不开」的车当成天天有。这里给每趟车记下它在哪几天开行。
 *
 * 数据来源（12306 公开接口）：
 *   1) https://search.12306.cn/search/v1/train/search  车次前缀搜索（date 参数决定哪天）
 *   2) https://kyfw.12306.cn/otn/resources/js/framework/station_name.js  车站字典
 *
 * 输出：
 *   data/stations.json
 *   data/index.json  [ {code, trainNo, from, to, stops, days:[0,1,3...]} ]
 *                    days 是相对今天的偏移，0 = 今天，5 = 第 5 天
 *
 * 用法：node scripts/01-fetch-index.mjs [起始日期YYYYMMDD] [前缀…]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const PREFIXES = process.argv.slice(3).length ? process.argv.slice(3) : ['Z', 'T', 'K', 'Y', 'D', 'G'];
const DAYS = 6; // 今天 + 后 5 天
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastHit = 0;
const MIN_GAP = 420;

function dateStr(offset) {
  const d = new Date(
    Date.UTC(
      Number(BASE.slice(0, 4)),
      Number(BASE.slice(4, 6)) - 1,
      Number(BASE.slice(6, 8)) + offset
    )
  );
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

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

async function searchPrefix(prefix, date) {
  const j = await getJSON(
    'https://search.12306.cn/search/v1/train/search?keyword=' +
      encodeURIComponent(prefix) +
      `&date=${date}&from_station=&to_station=`
  );
  return Array.isArray(j.data) ? j.data : [];
}

/** 某一天的车次集合：trainNo -> 基本信息 */
async function crawlDay(date, bucket) {
  const crawl = async (prefix, depth = 0) => {
    const rows = await searchPrefix(prefix, date);
    for (const r of rows) {
      if (!r.train_no) continue;
      bucket.set(r.train_no, {
        code: r.station_train_code,
        trainNo: r.train_no,
        from: r.from_station,
        to: r.to_station,
        stops: Number(r.total_num) || 0,
      });
    }
    if (rows.length >= 200 && depth < 5) {
      for (let d = 0; d <= 9; d++) await crawl(prefix + d, depth + 1);
    }
  };
  for (const t of PREFIXES) {
    if (t === '__skipstations') continue;
    try {
      await crawl(t);
    } catch (e) {
      console.warn(`    ! ${date} ${t} 中断（${e.message}），已抓到 ${bucket.size} 趟`);
      await sleep(15000);
    }
  }
  return bucket;
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });

  // 车站字典
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

  console.log(`[2/2] 车次索引（${DAYS} 天：${dateStr(0)} ~ ${dateStr(DAYS - 1)}）…`);
  const merged = new Map(); // trainNo -> {..., days:Set}
  const dayCounts = [];

  for (let off = 0; off < DAYS; off++) {
    const date = dateStr(off);
    const bucket = new Map();
    await crawlDay(date, bucket);

    let added = 0;
    for (const [no, info] of bucket) {
      const cur = merged.get(no);
      if (cur) cur.days.add(off);
      else {
        merged.set(no, { ...info, days: new Set([off]) });
        added++;
      }
    }
    console.log(`    ${date}：${bucket.size} 趟（新增 ${added}），累计 ${merged.size}`);
    await sleep(1000);
  }

  // 固定收录的车次（G 字头枚举容易被限流截断）：默认每天都算开行
  try {
    const pinned = JSON.parse(await fs.readFile(path.join(DATA, 'pinned.json'), 'utf8'));
    let added = 0;
    for (const p of pinned) {
      if (!merged.has(p.trainNo)) {
        merged.set(p.trainNo, {
          code: p.code,
          trainNo: p.trainNo,
          from: '',
          to: '',
          stops: 0,
          days: new Set(Array.from({ length: DAYS }, (_, i) => i)),
        });
        added++;
      }
    }
    if (added) console.log(`    并入固定车次 ${added} 趟`);
  } catch {
    /* 没有就跳过 */
  }

  const out = [...merged.values()].map((t) => ({
    code: t.code,
    trainNo: t.trainNo,
    from: t.from,
    to: t.to,
    stops: t.stops,
    days: [...t.days].sort((a, b) => a - b),
  }));
  await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify(out));
  const complete = dayCounts.length === DAYS && dayCounts.every((c) => c >= 500);
  await fs.writeFile(
    path.join(DATA, 'index-base.json'),
    JSON.stringify({ baseDate: BASE, days: DAYS, complete })
  );
  if (!complete) console.warn('    ! 有日期没抓全（被限流），本次不启用按日期筛选');

  const onlyOneDay = out.filter((t) => t.days.length === 1).length;
  const notEveryDay = out.filter((t) => t.days.length < DAYS).length;
  console.log(`完成：${out.length} 趟；不是每天开行的 ${notEveryDay} 趟（只在 1 天开行的 ${onlyOneDay} 趟）`);
  if (out.length < 500) throw new Error('车次索引过少，可能被限流，放弃本次更新');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
