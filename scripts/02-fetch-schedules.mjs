/**
 * 第二步：抓取每趟列车的完整经停时刻表（可断点续传）
 *
 * 接口：https://kyfw.12306.cn/otn/czxx/queryByTrainNo?train_no=&from_station_telecode=&to_station_telecode=&depart_date=
 * 输出：data/schedules/<train_no>.json   { code, trainNo, stops:[{station,arr,dep,no}] }
 *
 * 用法：node scripts/02-fetch-schedules.mjs [日期YYYY-MM-DD] [类型过滤，如 ZTK]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const SCHED = path.join(DATA, 'schedules');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DATE = process.argv[2] || new Date(Date.now() + 864e5 * 5).toISOString().slice(0, 10);
const TYPE_FILTER = (process.argv[3] || '').toUpperCase();
const CONCURRENCY = Number(process.env.CONC || 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
let hits = 0;
const t0 = Date.now();

async function initSession() {
  try {
    const r = await fetch('https://kyfw.12306.cn/otn/leftTicket/init', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    const list = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    cookie = list.map((c) => c.split(';')[0]).join('; ');
  } catch {}
}

async function getTimetable(train) {
  const url =
    'https://kyfw.12306.cn/otn/czxx/queryByTrainNo?train_no=' +
    encodeURIComponent(train.trainNo) +
    '&from_station_telecode=' +
    (train.fromCode || '') +
    '&to_station_telecode=' +
    (train.toCode || '') +
    '&depart_date=' +
    DATE;
  let backoff = 2000;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
          Cookie: cookie,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 403 || r.status === 429) throw new Error('RATE ' + r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const rows = j?.data?.data;
      if (!Array.isArray(rows)) return null;
      const stops = rows.map((s) => ({
        station: s.station_name,
        arr: s.arrive_time === '----' ? null : s.arrive_time,
        dep: s.start_time === '----' ? null : s.start_time,
      }));
      return stops.length ? { code: train.code, trainNo: train.trainNo, stops } : null;
    } catch (e) {
      if (i === 5) throw e;
      const wait = /RATE/.test(e.message) ? backoff * (i + 1) : 800;
      if (/RATE/.test(e.message)) console.warn(`    ! ${e.message}，退避 ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function main() {
  await fs.mkdir(SCHED, { recursive: true });
  const stations = JSON.parse(await fs.readFile(path.join(DATA, 'stations.json'), 'utf8'));
  const nameToCode = {};
  for (const [code, s] of Object.entries(stations)) if (!nameToCode[s.name]) nameToCode[s.name] = code;

  let index = JSON.parse(await fs.readFile(path.join(DATA, 'index.json'), 'utf8'));
  if (TYPE_FILTER) index = index.filter((t) => TYPE_FILTER.includes(t.code[0].toUpperCase()));

  // 断点续传
  const done = new Set(
    (await fs.readdir(SCHED).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  );
  const todo = index.filter((t) => !done.has(t.trainNo));
  console.log(`共 ${index.length} 趟，已完成 ${done.size}，待抓 ${todo.length}`);

  await initSession();
  let cursor = 0;
  let ok = 0;
  let empty = 0;
  let fail = 0;

  async function worker(id) {
    while (cursor < todo.length) {
      const t = todo[cursor++];
      const task = { ...t, fromCode: nameToCode[t.from] || '', toCode: nameToCode[t.to] || '' };
      try {
        const data = await getTimetable(task);
        if (data) {
          await fs.writeFile(path.join(SCHED, t.trainNo + '.json'), JSON.stringify(data));
          ok++;
        } else {
          await fs.writeFile(path.join(SCHED, t.trainNo + '.json'), JSON.stringify({ empty: true, ...t }));
          empty++;
        }
      } catch (e) {
        fail++;
        console.warn(`    x ${t.code} ${e.message}`);
      }
      hits++;
      if (hits % 50 === 0) {
        const sec = (Date.now() - t0) / 1000;
        console.log(
          `    ${hits}/${todo.length}  ok=${ok} empty=${empty} fail=${fail}  ${(hits / sec).toFixed(1)}/s`
        );
      }
      await sleep(90 + Math.random() * 160);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  console.log(`完成：ok=${ok} empty=${empty} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
