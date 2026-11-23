/* 夜宿火车 · 前端逻辑（无框架，本地全量数据，查询在浏览器内完成） */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const D = { data: null };
  const MIN_DUR = 4.5 * 60; // 少于 4.5 小时不算「睡一晚」

  // 2026 版《列车车次编排规定》：
  //   X/G/T/K 高速旅客列车 · D 动集 · C 城际 · S 市郊 · Z/N/V 普速 · Y 普速旅游
  // 11 月下旬起普速车次先从 T/K 迁到 Z/N/V，过渡期新旧并存。
  const TYPE_NAME = {
    X: '高速', G: '高速', T: '高速', K: '高速',
    D: '动集', C: '城际', S: '市郊',
    Z: '普速', N: '普速', V: '普速', Y: '旅游',
    L: '临时',
  };
  const HOT = ['北京', '上海', '广州', '成都', '西安', '乌鲁木齐', '哈尔滨', '昆明'];

  const state = {
    city: '',      // 用户选中的城市
    mode: 'from',  // 'from'=从这个城市出发能去哪；'to'=从各地来这个城市
    dep: [18 * 60, 23 * 60 + 59],
    arr: [5 * 60, 10 * 60],
    types: new Set(),
    maxDur: 16,
    day: 0, // 出行日期：相对数据基准日的偏移
    sort: 'score',
  };

  /* ---------------- 工具 ---------------- */
  const hhmm = (m) => {
    const t = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };
  const durText = (m) => {
    const h = Math.floor(m / 60), mm = m % 60;
    return h + 'h' + String(mm).padStart(2, '0');
  };
  const toMin = (v) => {
    if (!v || !/^\d{1,2}:\d{2}/.test(v)) return null;
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  };
  const inWin = (t, a, b) => (a <= b ? t >= a && t <= b : t >= a || t <= b);
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 1600);
  }

  /* ---------------- 夜宿指数 ---------------- */
  function scoreOf(depMod, arrMod, dur) {
    let s1;
    if (depMod >= 19 * 60 && depMod <= 23 * 60 + 59) s1 = 100;
    else if (depMod >= 18 * 60) s1 = 84;
    else if (depMod >= 17 * 60) s1 = 66;
    else if (depMod <= 60) s1 = 62;
    else s1 = 42;

    let s2;
    if (arrMod >= 6 * 60 && arrMod <= 8 * 60 + 30) s2 = 100;
    else if (arrMod > 8 * 60 + 30 && arrMod <= 10 * 60) s2 = 82;
    else if (arrMod >= 5 * 60 && arrMod < 6 * 60) s2 = 74;
    else if (arrMod > 10 * 60 && arrMod <= 11 * 60 + 30) s2 = 58;
    else s2 = 40;

    let s3;
    if (dur >= 7.5 * 60 && dur <= 12.5 * 60) s3 = 100;
    else if (dur >= 6.5 * 60 && dur < 7.5 * 60) s3 = 84;
    else if (dur > 12.5 * 60 && dur <= 15 * 60) s3 = 80;
    else if (dur > 15 * 60) s3 = 56;
    else s3 = 46;

    return Math.round(s1 * 0.34 + s2 * 0.4 + s3 * 0.26);
  }
  function labelOf(score) {
    if (score >= 90) return ['黄金夜宿', 'b-gold'];
    if (score >= 78) return ['舒适', 'b-good'];
    if (score >= 64) return ['可行', 'b-ok'];
    return ['将就', 'b-meh'];
  }

  /* ---------------- 查询 ---------------- */
  function search() {
    const city = state.city;
    const fromMode = state.mode === 'from';
    if (!city || !D.data || !D.data.cities[city]) {
      $('#sumN').textContent = '0';
      $('#sumT').textContent = '个城市 · 请先选择城市';
      $('#list').innerHTML = '';
      drawMap([]);
      return;
    }
    const hubCodes = new Set(D.data.cities[city]);
    const st = D.data.stations;
    const byCity = new Map();
    const T = D.data.trains;

    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti];
      if (!state.types.has(t.t)) continue;
      if (Array.isArray(t.d) && !t.d.includes(state.day)) continue; // 这天不开
      const stops = t.s;
      for (let i = 0; i < stops.length; i++) {
        const ci = stops[i][0];
        const inI = hubCodes.has(ci);
        for (let j = i + 1; j < stops.length; j++) {
          const cj = stops[j][0];
          const inJ = hubCodes.has(cj);
          if (inI === inJ) continue; // 两端都在同一城市 → 不算
          if (fromMode ? !inI : !inJ) continue;
          const di = stops[i][2], aj = stops[j][1];
          if (di == null || aj == null) continue;

          const dur = aj - di;
          if (dur < MIN_DUR || dur > state.maxDur * 60) continue;
          const depDay = Math.floor(di / 1440), arrDay = Math.floor(aj / 1440);
          if (depDay >= arrDay) continue; // 必须跨夜
          const depMod = di % 1440, arrMod = aj % 1440;
          if (!inWin(depMod, state.dep[0], state.dep[1])) continue;
          if (!inWin(arrMod, state.arr[0], state.arr[1])) continue;

          const otherCode = fromMode ? cj : ci;
          const otherCity = st[otherCode][1];
          if (!otherCity || otherCity === city) continue;

          const rec = {
            city: otherCity,
            fromSt: st[ci][0],
            toSt: st[cj][0],
            code: t.c,
            type: t.t,
            dep: depMod,
            arr: arrMod,
            dayPlus: arrDay - depDay,
            dur,
            score: scoreOf(depMod, arrMod, dur),
          };
          const cur = byCity.get(otherCity);
          if (!cur) byCity.set(otherCity, [rec]);
          else {
            const dup = cur.find((x) => x.code === rec.code);
            if (!dup) cur.push(rec);
            else if (rec.score > dup.score) Object.assign(dup, rec);
          }
        }
      }
    }

    const groups = [...byCity.entries()].map(([c, trains]) => {
      trains.sort((a, b) => b.score - a.score || a.dur - b.dur);
      return { city: c, trains, best: trains[0] };
    });

    const cmp = {
      score: (a, b) => b.best.score - a.best.score || a.best.dur - b.best.dur,
      dur: (a, b) => a.best.dur - b.best.dur || b.best.score - a.best.score,
      dep: (a, b) => a.best.dep - b.best.dep || b.best.score - a.best.score,
      city: (a, b) => a.city.localeCompare(b.city, 'zh-Hans-CN'),
    }[state.sort];
    groups.sort(cmp);
    render(groups, city, fromMode);
    drawMap(groups, city, fromMode);

    // 天气跟着「你这趟要去的地方」走：
    //   「到这儿来」→ 就是选中的这座城市；
    //   「从这儿出发」→ 默认看排名第一的到达城市（点列表里的城市可以切换）
    const target = fromMode ? (groups[0] && groups[0].city) : city;
    refreshWeather(target || city, fromMode ? '到达地' : '目的地');
  }

  /* ---------------- 渲染列表 ---------------- */
  function render(groups, city, fromMode) {
    const totalTrains = groups.reduce((n, g) => n + g.trains.length, 0);
    $('#sumN').textContent = groups.length;
    const dayText = dayLabel();
    $('#sumT').textContent = fromMode
      ? `个城市 · ${totalTrains} 趟车 · ${dayText}从 ${city} 出发，睡一晚能到`
      : `个城市 · ${totalTrains} 趟车 · ${dayText}可夜宿抵达 ${city}`;

    const list = $('#list');
    if (!groups.length) {
      list.innerHTML = `<div class="empty"><span class="moon">🌙</span>
        这一天没有符合条件的夜车。<br />试试换<b>出行日期</b>、放宽<b>发车/抵达时段</b>、延长<b>最长车上时间</b>，或换一个城市。</div>`;
      return;
    }

    let html = '';
    for (const g of groups) {
      const [lb, cls] = labelOf(g.best.score);
      html += `<div class="city" data-city="${escapeHtml(g.city)}">
        <div class="head">
          <span class="name">${escapeHtml(g.city)}</span>
          <span class="cnt">${g.trains.length} 趟</span>
          <span class="sp"></span>
          <span class="best">最佳 ${hhmm(g.best.dep)} 发车</span>
          <span class="badge ${cls}">${lb} ${g.best.score}</span>
        </div>
        <div class="rows">`;
      for (const r of g.trains) {
        html += `<div class="row">
          <div class="tc">${escapeHtml(r.code)}<small>${TYPE_NAME[r.type] || '普速'}</small></div>
          <div class="seg">${escapeHtml(r.fromSt)}<span class="ar">→</span>${escapeHtml(r.toSt)}</div>
          <div class="tm"><b>${hhmm(r.dep)}</b><i>→</i><b>${hhmm(r.arr)}</b>${
          r.dayPlus > 0 ? `<em>+${r.dayPlus}天</em>` : ''
        }</div>
          <div class="du"><b>${durText(r.dur)}</b></div>
        </div>`;
      }
      html += `</div></div>`;
    }
    list.innerHTML = html;

    list.querySelectorAll('.city').forEach((el) => {
      const city = el.dataset.city;
      el.addEventListener('mouseenter', () => highlight(city));
      el.addEventListener('mouseleave', () => highlight(null));
      el.addEventListener('click', () => {
        highlight(city);
        const n = el.querySelectorAll('.row').length;
        toast(fromMode ? `${state.city} → ${city}：${n} 趟夜车` : `${city} → ${state.city}：${n} 趟夜车`);
        // 看看这个城市的天气
        refreshWeather(city, fromMode ? '到达地' : '出发地');
      });
    });
  }

  /* ---------------- 地图 ---------------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* 标准地图（自然资源部 GS(2016)1614）用的是「双标准纬线等角圆锥投影」，
     下面这套参数是对着图上的经纬网拟合出来的，把经纬度换算成图上的像素坐标。 */
  const MAP_W = 1600;
  const MAP_H = 1200;
  const LCC = { lat1: 30, lat2: 55, lon0: 108, scale: 1.7505e-4, tx: 807.3, ty: 1225.1 };
  const EARTH_R = 6378137;
  const D2R = Math.PI / 180;

  const lccConst = (() => {
    const p1 = LCC.lat1 * D2R, p2 = LCC.lat2 * D2R;
    const n =
      Math.log(Math.cos(p1) / Math.cos(p2)) /
      Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
    return { n, F };
  })();

  function project(lon, lat) {
    const { n, F } = lccConst;
    const rho = F / Math.pow(Math.tan(Math.PI / 4 + (lat * D2R) / 2), n);
    const th = n * (lon - LCC.lon0) * D2R;
    const X = EARTH_R * rho * Math.sin(th);
    const Y = EARTH_R * (F - rho * Math.cos(th));
    return [LCC.scale * X + LCC.tx, -LCC.scale * Y + LCC.ty];
  }

  function cityPoint(name) {
    const g = D.data && D.data.geo && D.data.geo[name];
    return g ? project(g[0], g[1]) : null;
  }

  function ensureBase(svg) {
    if (svg.dataset.ready) return;
    // 底图：自然资源部标准地图（审图号 GS(2016)1614），不裁切、不改形状
    svg.appendChild(
      el('image', {
        href: 'assets/china-standard-map.png',
        x: 0,
        y: 0,
        width: MAP_W,
        height: MAP_H,
        preserveAspectRatio: 'none',
      })
    );
    svg.dataset.ready = '1';
  }

  function drawMap(groups, city, fromMode) {
    const svg = $('#map');
    if (!D.data) return;
    ensureBase(svg);
    const hub = city || state.city;
    const dp = cityPoint(hub);

    svg.querySelectorAll('.dyn').forEach((n) => n.remove());
    const g = el('g', { class: 'dyn' });
    if (!dp) {
      svg.appendChild(g);
      $('#mapHint').textContent = '该城市暂缺地图坐标';
      return;
    }

    const routes = el('g');
    const dots = el('g');
    const placed = [];
    let n = 0;
    for (const gr of groups) {
      const p = cityPoint(gr.city);
      if (!p) continue;
      const dx = dp[0] - p[0], dy = dp[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.min(110, len * 0.26);
      let nx = -dy / len, ny = dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; } // 弧线统一向上拱
      const cx = (p[0] + dp[0]) / 2 + nx * off;
      const cy = (p[1] + dp[1]) / 2 + ny * off;
      const path = el('path', {
        class: 'route',
        d: `M${p[0].toFixed(1)} ${p[1].toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${dp[0].toFixed(1)} ${dp[1].toFixed(1)}`,
        'stroke-width': Math.max(3, Math.min(9, 9 - len / 260)).toFixed(2),
        'data-city': gr.city,
      });
      path.appendChild(el('title', {})).textContent = fromMode
        ? `${hub} → ${gr.city}（${gr.trains.length} 趟）`
        : `${gr.city} → ${hub}（${gr.trains.length} 趟）`;
      routes.appendChild(path);

      dots.appendChild(el('circle', { class: 'dot', cx: p[0], cy: p[1], r: 9, 'data-city': gr.city }));
      placed.push({ city: gr.city, p, score: gr.best.score });
      n++;
    }
    g.appendChild(routes);
    g.appendChild(dots);

    // 中心城市
    g.appendChild(el('circle', { class: 'dest-halo', cx: dp[0], cy: dp[1], r: 30 }));
    g.appendChild(el('circle', { class: 'dest-core', cx: dp[0], cy: dp[1], r: 13 }));
    const tx = el('text', {
      class: 'dest-txt',
      x: dp[0] + (dp[0] > 1100 ? -20 : 20),
      y: dp[1] + 14,
      'text-anchor': dp[0] > 1100 ? 'end' : 'start',
    });
    tx.textContent = hub;
    g.appendChild(tx);

    // 城市标注：按分数取前几名，并做简单的避让
    const taken = [];
    placed
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .forEach(({ city: cname, p }) => {
        const cx = p[0] + (p[0] > dp[0] ? -12 : 12);
        const cy = p[1] - 12;
        if (taken.some(([x, y]) => Math.hypot(x - cx, y - cy) < 50)) return;
        taken.push([cx, cy]);
        const t = el('text', {
          class: 'lbltxt',
          x: cx,
          y: cy,
          'text-anchor': p[0] > dp[0] ? 'end' : 'start',
        });
        t.textContent = cname;
        g.appendChild(t);
      });

    svg.appendChild(g);
    $('#mapHint').textContent = fromMode
      ? `${n} 个城市 · 从 ${hub} 出发`
      : `${n} 个城市 · 连线指向 ${hub}`;
  }

  function highlight(city) {
    const svg = $('#map');
    svg.querySelectorAll('.route').forEach((p) => p.classList.toggle('hot', !!city && p.dataset.city === city));
    svg.querySelectorAll('.dot').forEach((p) => p.classList.toggle('hot', !!city && p.dataset.city === city));
  }

  /* ---------------- 目的地选择器 ---------------- */
  let cityList = [];
  const cityKeys = () => Object.keys(D.data.cities);

  /** 允许输入「北京市」「乌鲁木齐市」这类带后缀的写法 */
  function resolveCity(v) {
    const t = String(v || '').trim();
    if (!t) return null;
    if (D.data.cities[t]) return t;
    const bare = t.replace(/(市辖区|市|地区|盟|自治州|特别行政区|林区)$/u, '');
    if (D.data.cities[bare]) return bare;
    return cityKeys().find((c) => c.startsWith(bare) || bare.startsWith(c)) || null;
  }

  function renderChips() {
    const box = $('#chips');
    box.innerHTML = HOT.filter((c) => D.data.cities[c])
      .map((c) => `<button class="chip" data-c="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join('');
    box.querySelectorAll('.chip').forEach((b) =>
      b.addEventListener('click', () => {
        setCity(b.dataset.c);
        search();
      })
    );
    syncChip();
  }
  function syncChip() {
    document.querySelectorAll('#chips .chip').forEach((b) => b.classList.toggle('on', b.dataset.c === state.city));
  }

  function filterCities(q) {
    const s = q.trim();
    if (!s) return cityList.slice(0, 10);
    const starts = [], inc = [];
    for (const c of cityList) {
      if (c.name.startsWith(s)) starts.push(c);
      else if (c.name.includes(s)) inc.push(c);
    }
    return starts.concat(inc).slice(0, 12);
  }

  function showSuggest(q) {
    const ul = $('#suggest');
    const items = filterCities(q);
    if (!items.length) {
      ul.hidden = true;
      return;
    }
    ul.innerHTML = items
      .map(
        (c) =>
          `<li data-c="${escapeHtml(c.name)}"><span>${escapeHtml(c.name)}</span><span class="c">${
            c.stations.length
          } 站</span></li>`
      )
      .join('');
    ul.hidden = false;
    ul.querySelectorAll('li').forEach((li) =>
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setCity(li.dataset.c);
        search();
        ul.hidden = true;
      })
    );
  }

  function setCity(c) {
    state.city = c;
    $('#dest').value = c;
    syncChip();
    try {
      const u = new URL(location.href);
      u.searchParams.delete('to');
      u.searchParams.delete('from');
      u.searchParams.set(state.mode === 'from' ? 'from' : 'to', c);
      history.replaceState(null, '', u);
    } catch {}
  }

  /* ---------------- 天气 ---------------- */
  let wxToken = 0;

  async function refreshWeather(city, role) {
    const bar = $('#wxbar');
    if (!bar) return;
    if (!city || !window.NightWeather || !D.data || !D.data.geo || !D.data.geo[city]) {
      bar.hidden = true;
      return;
    }
    const [lon, lat] = D.data.geo[city];
    const token = ++wxToken;
    bar.hidden = false;
    bar.classList.add('loading');
    bar.innerHTML = `<div class="wx-main">
        <span class="wx-ico">🛰️</span>
        <div class="wx-tico">
          <div class="wx-temp">--°</div>
          <div class="wx-city">正在读取 ${escapeHtml(city)} 的天气…</div>
        </div>
      </div>`;

    const wx = await window.NightWeather.get(lon, lat, city);
    if (token !== wxToken) return; // 用户已经换了城市
    bar.classList.remove('loading');
    if (!wx) {
      bar.hidden = true; // 拿不到就安静地隐藏，不打扰主流程
      return;
    }
    renderWeather(wx, role);
  }

  function renderWeather(wx, role) {
    const bar = $('#wxbar');
    const night = wx.isNight ? '夜间' : '白天';
    const tonight = wx.tonight ? `${wx.tonight.temp}°` : '--';
    const morning = wx.morning ? `${wx.morning.temp}°` : '--';
    const rain = wx.morning && wx.morning.rain > 0 ? `<em>降水 ${wx.morning.rain}%</em>` : '';
    bar.innerHTML = `
      <div class="wx-main">
        <span class="wx-ico" title="${escapeHtml(wx.desc)}">${wx.icon}</span>
        <div class="wx-tico">
          <div class="wx-temp">${wx.temp}°<small>${escapeHtml(wx.desc)} · 体感 ${wx.feels}°</small></div>
          <div class="wx-city">${escapeHtml(wx.city)}${role ? ' · ' + role : ''} · ${night} · 今天 ${wx.min}°~${wx.max}°</div>
        </div>
      </div>
      <div class="wx-stats">
        <div class="wx-stat"><i>今晚 21:00</i><b>${tonight}</b></div>
        <div class="wx-stat"><i>明早 06:00</i><b>${morning}</b>${rain}</div>
        <div class="wx-stat"><i>日落</i><b>${wx.sunset || '--'}</b></div>
      </div>
      <span class="wx-src">数据 wttr.in</span>`;
  }

  /** 切换「从这儿出发 / 到这儿去」 */
  function setMode(m) {
    state.mode = m;
    document.querySelectorAll('#modes .mode').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#dest').placeholder =
      m === 'from' ? '输入出发城市，如 上海 / 北京' : '输入目的地，如 西安 / 成都';
    if (state.city) setCity(state.city);
  }

  /* ---------------- 初始化 ---------------- */
  function bindFilters() {
    const sync = () => {
      state.dep = [toMin($('#depFrom').value) ?? 18 * 60, toMin($('#depTo').value) ?? 23 * 60 + 59];
      state.arr = [toMin($('#arrFrom').value) ?? 5 * 60, toMin($('#arrTo').value) ?? 10 * 60];
      state.maxDur = Number($('#maxDur').value) || 16;
      state.day = Number($('#daySel').value);
      if (!Number.isFinite(state.day)) state.day = 0;
      state.sort = $('#sort').value;
      search();
    };
    ['#depFrom', '#depTo', '#arrFrom', '#arrTo', '#maxDur', '#sort', '#daySel'].forEach((s) =>
      $(s).addEventListener('change', sync)
    );
  }

  function renderTypes() {
    const counts = {};
    for (const t of D.data.trains) counts[t.t] = (counts[t.t] || 0) + 1;
    const ORDER = ['X', 'G', 'T', 'K', 'D', 'C', 'S', 'Z', 'N', 'V', 'Y'];
    const idx = (t) => {
      const i = ORDER.indexOf(t);
      return i < 0 ? 99 : i;
    };
    const types = Object.keys(counts).sort((a, b) => idx(a) - idx(b));
    state.types = new Set(types.filter((t) => t !== 'L'));
    $('#types').innerHTML = types
      .map(
        (t) =>
          `<button class="type on" data-t="${t}" title="${TYPE_NAME[t] || '普速'} ${counts[t]} 趟">${t}</button>`
      )
      .join('');
    $('#types')
      .querySelectorAll('.type')
      .forEach((b) =>
        b.addEventListener('click', () => {
          const t = b.dataset.t;
          if (state.types.has(t)) {
            if (state.types.size === 1) return;
            state.types.delete(t);
            b.classList.remove('on');
          } else {
            state.types.add(t);
            b.classList.add('on');
          }
          search();
        })
      );
  }

  async function boot() {
    // 单文件版会把数据内联成 window.__NIGHT_DATA__，此时无需任何服务器
    const inline = window.__NIGHT_DATA__;
    let data = inline ? inline.app : await fetch('data/app.json').then((r) => r.json());

    // 配了 12306 中转时，优先用 Worker 上的当日快照，其次用浏览器本地缓存
    if (window.NightLive && window.NightLive.available()) {
      try {
        const snap = await window.NightLive.loadSnapshot();
        if (snap) data = snap;
        else {
          const cached = await window.NightLive.loadCached();
          if (cached) data = cached;
        }
      } catch {}
    }

    bindEvents();
    applyData(data);

    const qs = new URL(location.href).searchParams;
    const asked = qs.get('from') || qs.get('to');
    const mode = qs.get('from') ? 'from' : qs.get('to') ? 'to' : 'from';
    setMode(mode);
    const def = asked && D.data.cities[asked] ? asked : D.data.cities['上海'] ? '上海' : cityList[0].name;
    setCity(def);
    search();
  }

  /** 换一份数据（快照或 12306 实时），重建城市列表并刷新界面 */
  function applyData(data) {
    D.data = data;
    cityList = Object.keys(data.cities)
      .map((name) => ({ name, stations: data.cities[name] }))
      .sort((a, b) => b.stations.length - a.stations.length || a.name.localeCompare(b.name, 'zh-Hans-CN'));

    const src = data.meta.source || '车次快照';
    $('#metaTop').innerHTML = `${src} <b>${new Date(data.meta.generated).toLocaleDateString('zh-CN')}</b><br />
      收录 <b>${data.meta.trainCount}</b> 趟夜行列车 · <b>${data.meta.cityCount}</b> 座城市`;
    $('#sumN').textContent = '–';
    $('#sumT').textContent = '个城市';

    renderDays();
    renderTypes();
    renderChips();
    if (state.city) setCity(state.city);
  }

  /* ---------------- 出行日期 ---------------- */
  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /** 数据里记的是「相对基准日的第几天」，这里换算成真实日期，数据放旧了也能对上 */
  function renderDays() {
    const sel = $('#daySel');
    if (!sel || !D.data) return;
    // 数据没覆盖多天（抓取被限流）时，直接隐藏日期选择器，避免误导
    if (D.data.meta && D.data.meta.daysReliable === false) {
      sel.closest('div').hidden = true;
      state.day = 0;
      return;
    }
    sel.closest('div').hidden = false;
    const base = D.data.meta && D.data.meta.baseDate;
    const today = startOfDay(new Date());
    let diff = 0;
    if (base && /^\d{8}$/.test(String(base))) {
      const b = new Date(`${base.slice(0, 4)}-${base.slice(4, 6)}-${base.slice(6, 8)}T00:00:00`);
      diff = Math.round((today - startOfDay(b)) / 86400000);
    }
    let html = '';
    let firstOk = null;
    const total = Number(D.data.meta && D.data.meta.days) || 6;
    for (let i = 0; i < total; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const off = i + diff;
      const ok = off >= 0 && off < total;
      const label = i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${i} 天后`;
      const md = `${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}`;
      html += `<option value="${off}"${ok ? '' : ' disabled'}>${label} · ${md}${ok ? '' : '（无数据）'}</option>`;
      if (ok && firstOk === null) firstOk = off;
    }
    sel.innerHTML = html;
    state.day = firstOk === null ? 0 : firstOk;
    sel.value = String(state.day);
  }

  function dayLabel() {
    const sel = $('#daySel');
    const o = sel && sel.selectedOptions && sel.selectedOptions[0];
    return o ? o.textContent.replace('（无数据）', '').trim() + ' · ' : '';
  }

  function bindEvents() {
    bindFilters();

    // 白天 / 夜间 切换（选择记在 localStorage）
    const tbtn = $('#themeBtn');
    const applyTheme = (t) => {
      document.body.dataset.theme = t;
      tbtn.textContent = t === 'light' ? '☀️ 白天' : '🌙 夜间';
      tbtn.title = t === 'light' ? '切换到夜间模式' : '切换到白天模式';
    };
    applyTheme(document.body.dataset.theme === 'light' ? 'light' : 'dark');
    tbtn.addEventListener('click', () => {
      const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try {
        localStorage.setItem('night-theme', next);
      } catch {}
    });

    const input = $('#dest');
    input.addEventListener('input', () => showSuggest(input.value));
    input.addEventListener('focus', () => showSuggest(input.value));
    input.addEventListener('blur', () => setTimeout(() => ($('#suggest').hidden = true), 120));
    input.addEventListener('keydown', (e) => {
      const ul = $('#suggest');
      const items = [...ul.querySelectorAll('li')];
      const cur = items.findIndex((li) => li.getAttribute('aria-selected') === 'true');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        const next = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
        items.forEach((li) => li.setAttribute('aria-selected', 'false'));
        items[next].setAttribute('aria-selected', 'true');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = cur >= 0 ? items[cur].dataset.c : resolveCity(input.value);
        if (pick) {
          setCity(pick);
          ul.hidden = true;
          search();
        } else toast('没有收录这个城市');
      } else if (e.key === 'Escape') ul.hidden = true;
    });
    $('#go').addEventListener('click', () => {
      const pick = resolveCity(input.value);
      if (pick) {
        setCity(pick);
        $('#suggest').hidden = true;
        search();
      } else showSuggest(input.value);
    });

    document.querySelectorAll('#modes .mode').forEach((b) =>
      b.addEventListener('click', () => {
        setMode(b.dataset.m);
        search();
      })
    );

    // 从 12306 实时同步
    const btn = $('#syncBtn');
    if (btn) {
      if (window.NightLive && window.NightLive.available()) {
        btn.hidden = false;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const label = btn.textContent;
          try {
            const data = await window.NightLive.sync(D.data.geo, (msg) => (btn.textContent = msg));
            btn.textContent = '已同步 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
            toast('已从 12306 拉取最新车次');
            applyData(data);
            search();
          } catch (e) {
            btn.textContent = label;
            toast('同步失败：' + e.message);
          } finally {
            btn.disabled = false;
          }
        });
      } else {
        btn.hidden = true;
      }
    }
  }

  boot().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div style="position:fixed;inset:auto 0 0 0;padding:14px;background:#41101c;color:#ffd9e2;font-size:13px;text-align:center">
        数据加载失败：${escapeHtml(e.message)}。请通过 start.bat 启动本地服务后访问。</div>`
    );
  });
})();
