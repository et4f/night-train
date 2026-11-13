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
│  ├─ daily-refresh.bat    ← 每日更新（计划任务调用）
│  └─ push.ps1             ← 定时任务里的推送（无交互环境）
├─ .github/workflows/refresh.yml ← 云端手动更新（一般用不上，见下）
├─ 安装每日更新任务.bat    ← 双击一次，注册每天 06:30 的本机更新
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

**必须在本机跑**：12306 拒绝境外机房 IP。实测用两个独立中转服务（美国、欧洲）
去拉 12306 接口，全部返回 **522**，GitHub Actions 的 runner 属于同一类网段。

所以：

1. 双击 `安装每日更新任务.bat` 注册计划任务「夜宿火车每日更新」，每天 **06:30** 触发
2. `scripts/daily-refresh.bat` 依次跑 01 → 02 → 03 → 07，然后 commit + push
3. `scripts/push.ps1` 用 `.token.txt` 里的令牌推送

### 令牌

`.token.txt` 不在仓库里（`.gitignore` 已排除）。生成方式：
<https://github.com/settings/tokens/new> → 勾 `repo` 和 `workflow` → 存成该文件。
有效期 90 天，过期后换一个。

### 踩过的坑（都已在脚本里解决）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `could not read Username` | 计划任务没有终端 | `GIT_TERMINAL_PROMPT=0` + 认证头 |
| `Invalid username or token` | 仓库配了 GCM，非交互下返回空凭据覆盖认证头 | `-c credential.helper=` |
| 脚本解析报错「缺少 }」 | PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI | `push.ps1` 改成纯 ASCII |
| git 卡住不动 | 代理偶发 TLS 断连 | `http.lowSpeedTime=30` + 重试 3 次 |
| 每天 06:17 一个红叉 | Actions 抓不到 12306 | 取消 schedule，改为手动触发 |

日志在 `data/last-refresh.log`。删除任务：

```bat
schtasks /Delete /TN "夜宿火车每日更新" /F
```

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
