/* 夜宿火车 · 目的地天气
 *
 * 数据源：wttr.in（WorldWeatherOnline 数据，免注册、无 key、允许跨域）
 * 只做一件事：给经纬度，返回一个规整好的天气对象；失败返回 null，界面静默隐藏。
 */
(() => {
  'use strict';

  const TTL = 30 * 60 * 1000; // 30 分钟缓存
  const TIMEOUT = 12000;

  const memory = new Map();

  function to24h(s) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(s || '').trim());
    if (!m) return s || '';
    let h = Number(m[1]) % 12;
    if (/PM/i.test(m[3])) h += 12;
    return String(h).padStart(2, '0') + ':' + m[2];
  }

  /** 用英文天气描述挑一个 emoji；夜间用月亮系 */
  function iconOf(desc, isNight) {
    const d = String(desc || '').toLowerCase();
    if (/thunder|storm/.test(d)) return '⛈️';
    if (/snow|sleet|blizzard|ice|freezing/.test(d)) return '🌨️';
    if (/rain|drizzle|shower/.test(d)) return '🌧️';
    if (/fog|mist|haze|smoke/.test(d)) return '🌁';
    if (/overcast/.test(d)) return '☁️';
    if (/cloud/.test(d)) return isNight ? '☁️' : '⛅';
    if (/clear|sunny/.test(d)) return isNight ? '🌙' : '☀️';
    return isNight ? '🌙' : '🌤️';
  }

  function pickHour(day, time) {
    if (!day || !Array.isArray(day.hourly)) return null;
    return day.hourly.find((h) => h.time === time) || null;
  }

  /** wttr 的中文翻译时有时无，兜一层英文关键词 */
  function zhOf(desc, zh) {
    if (zh && !/[A-Za-z]{3,}/.test(zh)) return zh;
    const d = String(desc || '').toLowerCase();
    if (/thunder/.test(d)) return '雷阵雨';
    if (/freezing|ice/.test(d)) return '冻雨';
    if (/blizzard|heavy snow/.test(d)) return '大雪';
    if (/snow/.test(d)) return '小雪';
    if (/heavy rain/.test(d)) return '大雨';
    if (/moderate rain/.test(d)) return '中雨';
    if (/light rain|patchy rain/.test(d)) return '小雨';
    if (/drizzle/.test(d)) return '毛毛雨';
    if (/shower/.test(d)) return '阵雨';
    if (/fog|mist/.test(d)) return '雾';
    if (/haze|smoke/.test(d)) return '霾';
    if (/overcast/.test(d)) return '阴';
    if (/partly cloudy/.test(d)) return '多云';
    if (/cloud/.test(d)) return '多云';
    if (/clear|sunny/.test(d)) return '晴';
    return zh || desc || '';
  }

  function normalize(json, fallbackName) {
    const cur = json.current_condition && json.current_condition[0];
    const days = json.weather || [];
    if (!cur || !days.length) return null;

    const w0 = days[0];
    const w1 = days[1] || days[0];
    const astro = (w0.astronomy && w0.astronomy[0]) || {};

    const sunset = to24h(astro.sunset);
    const sunrise = to24h(astro.sunrise);
    // 目的地的“现在几点”：统一按北京时间算（wttr 的 observation_time 是 UTC，不能直接用）
    const nowMin = (() => {
      try {
        const s = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date());
        return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      } catch {
        return new Date().getHours() * 60;
      }
    })();
    const toMin = (t) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
    const sr = toMin(sunrise), ss = toMin(sunset);
    const isNight = sr != null && ss != null ? nowMin < sr || nowMin >= ss : nowMin >= 19 * 60 || nowMin < 6 * 60;

    const tonightH = pickHour(w0, '2100');
    const morningH = pickHour(w1, '600');
    const desc = cur.weatherDesc && cur.weatherDesc[0] ? cur.weatherDesc[0].value : '';
    const descZhRaw =
      (cur['lang_zh-cn'] && cur['lang_zh-cn'][0] && cur['lang_zh-cn'][0].value) || '';
    const descZh = zhOf(desc, descZhRaw);

    const name =
      (json.nearest_area && json.nearest_area[0] && json.nearest_area[0].areaName[0].value) ||
      fallbackName ||
      '';

    return {
      city: fallbackName || name,
      temp: Number(cur.temp_C),
      feels: Number(cur.FeelsLikeC),
      desc: descZh,
      descEn: desc,
      icon: iconOf(desc, isNight),
      isNight,
      min: Number(w0.mintempC),
      max: Number(w0.maxtempC),
      tonight: tonightH
        ? { at: '21:00', temp: Number(tonightH.tempC), desc: tonightH.weatherDesc[0].value, rain: Number(tonightH.chanceofrain) }
        : null,
      morning: morningH
        ? { at: '06:00', temp: Number(morningH.tempC), desc: morningH.weatherDesc[0].value, rain: Number(morningH.chanceofrain) }
        : null,
      sunrise,
      sunset,
      source: 'wttr.in',
    };
  }

  async function get(lon, lat, cityName) {
    const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    const hit = memory.get(key);
    if (hit && Date.now() - hit.t < TTL) return hit.v;

    try {
      const cached = sessionStorage.getItem('night-wx:' + key);
      if (cached) {
        const o = JSON.parse(cached);
        if (o && Date.now() - o.t < TTL) {
          memory.set(key, o);
          return o.v;
        }
      }
    } catch {}

    let out = null;
    try {
      const url = `https://wttr.in/${lat.toFixed(3)},${lon.toFixed(3)}?format=j1&lang=zh-cn`;
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      if (r.ok) out = normalize(await r.json(), cityName);
      else window.__wxErr = 'HTTP ' + r.status;
    } catch (e) {
      window.__wxErr = (e && e.name) + ': ' + (e && e.message);
      out = null;
    }

    if (out) {
      const rec = { t: Date.now(), v: out };
      memory.set(key, rec);
      try {
        sessionStorage.setItem('night-wx:' + key, JSON.stringify(rec));
      } catch {}
    }
    return out;
  }

  window.NightWeather = { get, iconOf };
})();
