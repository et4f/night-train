# 开发笔记

README 里放不下的东西都在这。这份文件是给想改代码、想复刻数据管线的人看的。

---

## 目录结构

```
night-train/
├─ docs/                   ← 编译好的整站，GitHub Pages 直接发布这个目录
│  ├─ index.html  app.js  live.js  weather.js  style.css
│  ├─ assets/china-standard-map.png
│  └─ data/app.json
├─ web/                    ← 源文件（改这里，再跑 07 生成 docs）
├─ worker/12306-proxy.js   ← Cloudflare Worker：转发 + KV 快照
├─ data/
│  ├─ app.json             ← 数据集（约 400 KB）
│  ├─ cities.json          ← 城市经纬度
│  └─ schedules/ ...       ← 抓取中间产物（.gitignore 掉了）
├─ scripts/
│  ├─ 01-fetch-index.mjs   ← 抓车次索引
│  ├─ 02-fetch-schedules.mjs ← 抓每趟车的经停时刻
│  ├─ 03-build.mjs         ← 合并成 app.json
│  ├─ 04-fetch-geo.mjs     ← 城市经纬度
│  ├─ 05-build-portable.mjs ← 打单文件版 + zip
│  ├─ 06-fetch-basemap.mjs ← 下载官方标准地图底图
│  ├─ 07-build-docs.mjs    ← 组装 docs/
├─ .github/workflows/refresh.yml ← 每天 06:17 自动更新并发布
└─ 夜宿火车-便携版.zip     ← 发给别人的单文件包
```

> 改了 `web/` 里的任何东西，都要跑一次 `node scripts/07-build-docs.mjs`，否则线上不会变。

---

## 「一晚上的火车」怎么判定

一趟车要同时满足：

| 条件 | 默认值 | 说明 |
| --- | --- | --- |
| 发车时间 | 18:00 – 23:59 | 傍晚以后上车 |
| 抵达时间 | 05:00 – 10:00 | 早上到，白天不浪费 |
| 跨零点 | 必须 | 在车上过夜，而不是白天补觉 |
| 车上时长 | 4.5 – 16 小时 | 太短不算一晚，太长不如坐飞机 |
| 同城不算 | 是 | 出发城市与目的地城市相同的不列 |

**夜宿指数（0–100）**：发车时间 34% + 抵达时间 40% + 车上时长 26%。

| 分数 | 标签 |
| --- | --- |
| ≥ 90 | 黄金夜宿 |
| ≥ 78 | 舒适 |
| ≥ 64 | 可行 |
| < 64 | 将就 |

---

## 12306 接口与跨域

抓数据的两个接口，跨域策略**不一样**（实测）：

| 接口 | 用途 | 浏览器能否直连 |
| --- | --- | --- |
| `search.12306.cn/search/v1/train/search` | 车次列表 | ✅ 返回 `Access-Control-Allow-Origin` |
| `kyfw.12306.cn/otn/czxx/queryByTrainNo` | 经停时刻表 | ❌ 没有任何 CORS 头 |

所以纯静态页面拿不到时刻表，必须有个东西转发。`worker/12306-proxy.js` 就是干这个的
（Cloudflare Workers，免费额度够用）：

| 路由 | 作用 |
| --- | --- |
| `GET /proxy?u=` | 转发 12306 请求，带白名单 |
| `GET /snapshot` | 读 KV 里的整份快照 |
| `POST /snapshot?key=` | 写快照，需要 `SYNC_KEY` |

页面上配 `window.NIGHT_API = 'https://你的worker.workers.dev'` 后会出现「⟳ 同步 12306」
按钮，浏览器直连拉数据、存 IndexedDB，24 小时内不重复拉。

### 为什么不用 Cloudflare 的 Cron

跑不动，不是配置问题：Workers 免费版每次调用最多 **50 个子请求**、**CPU 10ms**，
而完整抓一轮要 **约 1200 次请求**。

---

## 每日自动更新

`.github/workflows/refresh.yml` 每天北京时间 **06:17** 由 GitHub Actions 自动跑：

1. 探测 12306 可达性（只记录 HTTP 码，不阻断）
2. `01-fetch-index.mjs` 抓车次索引
3. `02-fetch-schedules.mjs` 抓经停时刻表
4. `03-build.mjs` → `data/app.json`，`07-build-docs.mjs` → `docs/`
5. 有变化就 commit & push，Pages 自动重新发布

**实测（2026-11-13）**：runner 访问 12306 正常，`search` 和 `kyfw` 都返回 200；
索引 1267 趟用时约 20 秒，时刻表 1186 份约 3 分钟，全程 4 分钟出头。

### 一段走弯路的记录

最初一次云端运行失败在「抓车次索引」，我据此判断「12306 拒绝境外 IP」，
于是把定时任务改到了本机 Windows 计划任务。**这个判断是错的**：

- 当时用来验证的两个境外中转服务返回 522，是那两个服务本身连不上 12306，
  不能代表 GitHub 的出口；
- 后来的实际运行证明 runner 完全能访问 12306，只是那次撞上了限流。

现在已恢复云端定时（06:17），本机计划任务和配套脚本都删掉了；
需要手动更新时，本地跑 `refresh.bat` 再 `git push` 即可。

### 失败时会发生什么

`01-fetch-index.mjs` 对每个车次前缀单独 try/catch，撞上限流只会少抓一段、不会整体失败；
真正抛错只在最终车次少于 500 趟时。这时工作流停在「抓车次索引」，
仓库和线上站点保持上一次的数据，不会写进坏数据。

---

## 地图投影标定

官方底图不是经纬度直投影，而是**双标准纬线等角圆锥投影**（Lambert Conformal Conic）。
`web/app.js` 里的常量是这样拟合出来的：

1. 从标准地图服务按全国范围渲染 1600×1200 的图幅
2. 用图上的经纬网 + 18 个城市符号作为控制点
3. 搜索标准纬线/中央经线组合，用最小二乘拟合比例与平移
4. 残差约 7px（图上 0.3°），在页面缩放下不可见

当前参数：`lat1=30, lat2=55, lon0=108, scale=1.7505e-4, tx=807.3, ty=1225.1`。

---

## 已知边界

- 时刻为运行图计划时刻，不是当日实际开行；改点、临客、停运不会体现。
- 不含票价、余票、卧铺席别；不含高铁动卧（D / G 字头）。
- 天气来自 [wttr.in](https://wttr.in)，免费无 key，偶尔慢；拿不到就整条隐藏。
- 便携版是离线快照，不联网也不自动更新，要更新只能重新打包。
