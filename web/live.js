/* 夜宿火车 · 直连 12306
 *
 * 说明：
 *   - 车次索引 search.12306.cn 允许跨域，浏览器直接请求；
 *   - 时刻表 kyfw.12306.cn 没有 CORS，需要走一个中转（worker/12306-proxy.js）；
 *   - 同步结果存进 IndexedDB，24 小时内不再重复拉。
 *
 * 用法：在 index.html 里设置 window.NIGHT_API = 'https://你的worker.workers.dev'
 */
(() => {
  'use strict';

  const API = (window.NIGHT_API || '').replace(/\/+$/, '');
  const UA_HEADERS = { Accept: 'application/json, text/javascript, */*; q=0.01' };
  const PREFIXES = ['Z', 'T', 'K', 'Y'];
  const DB_NAME = 'night-train';
  const STORE = 'data';
  const TTL = 24 * 3600 * 1000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 缓存 ---------- */
  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function cacheGet(key) {
    try {
      const db = await openDB();
      return await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        tx.onsuccess = () => res(tx.result || null);
        tx.onerror = () => rej(tx.error);
      });
    } catch {
      return null;
    }
  }
  async function cacheSet(key, val) {
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
        tx.onsuccess = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch {
      /* 隐私模式下可能失败，忽略 */
    }
  }

  /* ---------- 请求 ---------- */
  async function getJSON(url) {
    const r = await fetch(url, { headers: UA_HEADERS });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function fetchStations() {
    const u = `${API}/proxy?u=${encodeURIComponent(
      'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js'
    )}`;
    const r = await fetch(u);
    const js = await r.text();
    const inner = js.slice(js.indexOf("'") + 1, js.lastIndexOf("'"));
    const out = {};
    for (const item of inner.split('@')) {
      if (!item) continue;
      const f = item.split('|');
      if (!f[2]) continue;
      out[f[2]] = [f[1], f[7] || f[1]];
    }
    return out;
  }

  async function searchPrefix(prefix, date) {
    const url =
      'https://search.12306.cn/search/v1/train/search?keyword=' +
      encodeURIComponent(prefix) +
      `&date=${date}&from_station=&to_station=`;
    for (let i = 0; i < 4; i++) {
      try {
        const j = await getJSON(url);
        return Array.isArray(j.data) ? j.data : [];
      } catch (e) {
        if (i === 3) throw e;
        await sleep(700 * (i + 1));
      }
    }
  }

  async function fetchIndex(date, onProgress) {
    const found = new Map();
    const crawl = async (prefix, depth = 0) => {
      const rows = await searchPrefix(prefix, date);
      for (const r of rows) {
        if (!r.train_no) continue;
        found.set(r.train_no, { code: r.station_train_code, trainNo: r.train_no });
      }
      if (rows.length >= 200 && depth < 5) {
        for (let d = 0; d <= 9; d++) await crawl(prefix + d, depth + 1);
      }
      await sleep(150);
    };
    for (const p of PREFIXES) {
      await crawl(p);
      onProgress && onProgress(`车次索引 ${p}… 已找到 ${found.size} 趟`);
    }
    return [...found.values()];
  }

  async function fetchTimetable(train, date) {
    const url =
      'https://kyfw.12306.cn/otn/czxx/queryByTrainNo?train_no=' +
      encodeURIComponent(train.trainNo) +
      `&from_station_telecode=&to_station_telecode=&depart_date=${date}`;
    const proxied = `${API}/proxy?u=${encodeURIComponent(url)}`;
    for (let i = 0; i < 4; i++) {
      try {
        const j = await getJSON(proxied);
        const rows = j && j.data && j.data.data;
        if (!Array.isArray(rows) || !rows.length) return null;
        return rows.map((s) => ({
          station: s.station_name,
          arr: s.arrive_time === '----' ? null : s.arrive_time,
          dep: s.start_time === '----' ? null : s.start_time,
        }));
      } catch (e) {
        if (i === 3) return null;
        await sleep(500 * (i + 1));
      }
    }
  }

  /* ---------- 组装 ---------- */
  const toMin = (t) => {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

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
      out.push([s.code, arr, dep]);
    }
    return out;
  }

  function assemble(index, timetables, stations, geo) {
    const nameToCode = {};
    for (const [code, v] of Object.entries(stations)) if (!nameToCode[v[0]]) nameToCode[v[0]] = code;

    const trains = [];
    for (const [trainNo, stops] of timetables) {
      const meta = index.find((t) => t.trainNo === trainNo);
      if (!meta || stops.length < 2) continue;
      const coded = [];
      let ok = true;
      for (const s of stops) {
        const code = nameToCode[s.station];
        if (!code) { ok = false; break; }
        coded.push({ code, arr: s.arr, dep: s.dep });
      }
      if (!ok) continue;
      trains.push({
        n: trainNo,
        c: meta.code,
        t: (meta.code || '').replace(/[^A-Za-z]/g, '').toUpperCase() || 'K',
        s: absolutize(coded),
      });
    }

    const used = new Set();
    for (const t of trains) for (const s of t.s) used.add(s[0]);

    const st = {};
    const cities = {};
    for (const code of used) {
      const info = stations[code];
      if (!info) continue;
      st[code] = info;
      (cities[info[1]] ||= []).push(code);
    }
    for (const k of Object.keys(cities)) cities[k].sort((a, b) => st[a][0].length - st[b][0].length);
    const mergedGeo = {};
    for (const c of Object.keys(cities)) if (geo[c]) mergedGeo[c] = geo[c];

    trains.sort((a, b) => a.n.localeCompare(b.n));
    return {
      meta: {
        generated: new Date().toISOString(),
        source: '12306 实时',
        trainCount: trains.length,
        stationCount: Object.keys(st).length,
        cityCount: Object.keys(cities).length,
      },
      stations: st,
      cities,
      geo: mergedGeo,
      trains,
    };
  }

  /* ---------- 对外接口 ---------- */
  async function sync(geo, onProgress) {
    if (!API) throw new Error('未配置 NIGHT_API');
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const compact = date.replace(/-/g, '');

    onProgress && onProgress('读取车站字典…');
    const stations = await fetchStations();

    onProgress && onProgress('枚举车次…');
    const index = await fetchIndex(compact, onProgress);

    const timetables = new Map();
    let done = 0;
    let cursor = 0;
    const CONC = 5;
    const worker = async () => {
      while (cursor < index.length) {
        const train = index[cursor++];
        const stops = await fetchTimetable(train, date);
        if (stops) timetables.set(train.trainNo, stops);
        done++;
        if (done % 25 === 0) {
          onProgress && onProgress(`抓取时刻表 ${done}/${index.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));

    const data = assemble(index, timetables, stations, geo);
    await cacheSet('app', { savedAt: Date.now(), data });
    return data;
  }

  async function loadCached() {
    const hit = await cacheGet('app');
    if (hit && Date.now() - hit.savedAt < TTL) return hit.data;
    return null;
  }

  /** 读 Worker 的 KV 快照（由 GitHub Actions 每天写入一次），拿不到返回 null */
  async function loadSnapshot() {
    if (!API) return null;
    try {
      const r = await fetch(`${API}/snapshot`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (d && Array.isArray(d.trains) && d.trains.length > 300 && d.meta) {
        d.meta.source = '12306 每日快照';
        return d;
      }
    } catch {
      /* 超时 / 离线，忽略 */
    }
    return null;
  }

  window.NightLive = {
    available: () => !!API,
    sync,
    loadCached,
    loadSnapshot,
    clear: () => cacheSet('app', null),
  };
})();
