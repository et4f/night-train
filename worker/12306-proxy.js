/**
 * 夜宿火车 · 12306 中转 + 快照缓存（Cloudflare Worker）
 *
 * 三个路由：
 *   GET  /proxy?u=<12306接口>   转发 kyfw 的请求（12306 没给 kyfw 发 CORS 头，浏览器直连会被拦）
 *   GET  /snapshot              读取 KV 里的整份数据集（秒开，所有人共用）
 *   POST /snapshot?key=xxx      写入数据集（需要 SYNC_KEY，由 GitHub Actions 调用）
 *
 * 为什么不用 Cron 定时抓：
 *   Workers 免费版每次调用最多 50 个子请求、CPU 10ms，而完整抓一轮要 ~1200 次请求，
 *   在 Worker 里跑不完。所以「每天自动更新」交给 GitHub Actions（refresh.yml），
 *   抓完再 POST 到这里存进 KV，页面打开时直接读 KV。
 *
 * 部署：见 README「让网页直连 12306」一节
 *   - 绑定 KV：变量与绑定 → KV 命名空间，变量名填 SNAPSHOT
 *   - 可选：变量 SYNC_KEY = 一串随机字符（不设则 POST 关闭，只读）
 */

const ALLOW = [
  // 只放行这两类接口，避免变成开放代理
  /^https:\/\/kyfw\.12306\.cn\/otn\/czxx\/queryByTrainNo\?/,
  /^https:\/\/kyfw\.12306\.cn\/otn\/resources\/js\/framework\/station_name\.js$/,
  /^https:\/\/kyfw\.12306\.cn\/otn\/leftTicket\/init$/,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const KEY = 'snapshot:latest';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** 粗略校验，防止有人往 KV 里塞垃圾 */
function validSnapshot(d) {
  if (!d || typeof d !== 'object') return false;
  if (!Array.isArray(d.trains) || d.trains.length < 300) return false;
  if (!d.meta || typeof d.meta.trainCount !== 'number') return false;
  if (!d.stations || !d.cities) return false;
  const t = d.trains[0];
  return Array.isArray(t.s) && t.s.length >= 2 && Array.isArray(t.s[0]);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';

    /* ---------- 快照 ---------- */
    if (p === '/snapshot' || p === '/') {
      if (request.method === 'POST') {
        if (!env.SYNC_KEY) return json({ error: '未配置 SYNC_KEY，写入已关闭' }, 403);
        if (url.searchParams.get('key') !== env.SYNC_KEY) return json({ error: 'key 不正确' }, 401);
        let data;
        try {
          data = await request.json();
        } catch {
          return json({ error: '不是合法 JSON' }, 400);
        }
        if (!validSnapshot(data)) return json({ error: '数据结构不对，拒绝写入' }, 400);
        data.savedAt = Date.now();
        await env.SNAPSHOT.put(KEY, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 14 });
        return json({ ok: true, trainCount: data.meta.trainCount, savedAt: data.savedAt });
      }
      if (!env.SNAPSHOT) return json({ error: '未绑定 KV 命名空间 SNAPSHOT' }, 500);
      const hit = await env.SNAPSHOT.get(KEY, { type: 'json' });
      if (!hit) return json({ empty: true }, 404);
      return new Response(JSON.stringify(hit), {
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    /* ---------- 12306 转发 ---------- */
    if (p === '/proxy') {
      const target = url.searchParams.get('u');
      if (!target) return json({ hint: '用法：/proxy?u=<12306 接口地址>' });
      if (!ALLOW.some((re) => re.test(target))) return json({ error: 'target not allowed' }, 403);

      const upstream = await fetch(target, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        cf: { cacheTtl: 0 },
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS,
          'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return json({ error: 'not found', routes: ['/snapshot', '/proxy'] }, 404);
  },
};
