# 🌙 夜宿火车

> 选一座城市，看看一晚上的火车能把你带到哪儿——上车睡觉，醒来换座城。

一个纯前端的小工具：**选城市 → 列出所有「傍晚上车、清晨抵达」的卧铺车能到的城市**，配一张自然资源部标准地图做底图。

- 🌙 **从这儿出发**：我在上海，一夜能睡到哪些城市？
- 🎯 **到这儿来**：我想去西安，哪些城市能一夜睡到西安？
- 🌦 **顺带看天气**：到达城市今晚几度、明早下车时什么天、要不要带伞
- ☀️ **白天 / 夜间**两种配色，一键切换并记住

![界面](screenshot.png)

数据来自中国铁路 12306 公开时刻表，覆盖全部 Z / T / K / Y 字头普速卧铺列车：
**1154 趟车、1234 座车站、327 座城市**。查询全部在浏览器本地完成，毫秒出结果。

---

## 目录

- [三种用法](#三种用法)
- [发布到 GitHub](#发布到-github)
- [自动更新（每天一次）](#自动更新每天一次)
- [让网页直连 12306（可选）](#让网页直连-12306可选)
- [「一晚上的火车」怎么判定](#一晚上的火车怎么判定)
- [天气与白天/夜间模式](#天气与白天夜间模式)
- [地图来源与合规](#地图来源与合规)
- [目录结构](#目录结构)
- [本地更新数据](#本地更新数据)
- [免责声明](#免责声明)

---

## 三种用法

### 1. 单文件版（发给别人 / 自己随手用）

解压 `夜宿火车-便携版.zip`，双击里面的 **`夜宿火车.html`**。约 1 MB，
不用装 Node、不用服务器、不用联网，Windows / Mac / 手机浏览器都能开。

### 2. 本地开发版

```bash
node server/server.mjs      # 或双击 start.bat
# → http://127.0.0.1:8787
```

需要 Node.js 18+，零依赖。

### 3. 线上（GitHub Pages）

推到 GitHub 后，`docs/` 目录直接发布，见下一节。

---

## 发布到 GitHub

### 第 1 步：建仓库

1. 登录 GitHub，右上角 **+ → New repository**
2. 仓库名填 `night-train`，选 **Public**（免费版 Pages 要求公开仓库）
3. **不要**勾 "Add a README file"，直接 Create

### 第 2 步：把代码推上去

在项目根目录（有 `README.md` 这一层）打开终端：

```bash
git init
git add .
git commit -m "feat: 夜宿火车 v1"
git branch -M main
git remote add origin https://github.com/你的用户名/night-train.git
git push -u origin main
```

> 没装 git？也可以在仓库页点 **Add file → Upload files** 把整个文件夹拖进去。
> 首次 push 要认证：GitHub 早就不支持密码了，用 **Personal Access Token** 或 GitHub Desktop。

### 第 3 步：开启 Pages（30 秒）

1. 仓库 → **Settings** → 左侧 **Pages**
2. **Source** 选 **Deploy from a branch**
3. **Branch** 选 `main`，目录选 **`/docs`**，点 **Save**

### 第 4 步：访问

```
https://你的用户名.github.io/night-train/
```

`docs/` 就是编译好的整站（`scripts/07-build-docs.mjs` 生成），
刻意不依赖 Actions 部署，这样对新手最省事：**只要 push，Pages 自己会重建**。

> 想用自己的域名？Settings → Pages → Custom domain 填进去即可。

---

## 自动更新（每天一次）

`.github/workflows/refresh.yml` 每天北京时间 **06:17** 跑一次：

1. 抓 12306 车次索引 + 全部经停时刻表（约 3 分钟）
2. `node scripts/03-build.mjs` 生成新的 `data/app.json`
3. `node scripts/07-build-docs.mjs` 重建 `docs/`
4. 有变化就自动 commit & push → Pages 重新发布
5. 若配置了 `NIGHT_API`，顺手把快照推进 Cloudflare KV

**所以打开网页看到的就是当天的数据**，不用点任何按钮。

仓库设置（可选，用于第 5 步）：

| 位置 | 名称 | 值 |
| --- | --- | --- |
| Settings → Secrets and variables → **Variables** | `NIGHT_API` | `https://你的worker.workers.dev` |
| Settings → Secrets and variables → **Secrets** | `SYNC_KEY` | 跟 Worker 里设的同一个随机串 |

想立刻更新一次？Actions → **每日更新时刻表** → **Run workflow**。

> ⚠️ GitHub 的定时任务有两个坑：① 仓库连续 60 天没有提交，schedule 会自动停；
> ② 高峰期可能延迟几十分钟。手动 Run workflow 永远可用。

---

## 让网页直连 12306（可选）

默认网页读的是 `docs/data/app.json`（每天自动更新）。
如果你还想让用户在页面上**当场从 12306 拉实时数据**，需要部署一个中转服务。

### 为什么必须中转

12306 两个接口的跨域策略不一样，我实测过：

| 接口 | 用途 | 浏览器能否直连 |
| --- | --- | --- |
| `search.12306.cn/search/v1/train/search` | 车次列表 | ✅ 返回 `Access-Control-Allow-Origin`，可直接请求 |
| `kyfw.12306.cn/otn/czxx/queryByTrainNo` | 经停时刻表 | ❌ 没有任何 CORS 头，浏览器会被拦 |

**纯静态页面拿不到时刻表**，这是 12306 服务端的限制，换任何写法都绕不过去。

### 部署 Worker（5 分钟）

1. 登录 <https://dash.cloudflare.com> → **Workers & Pages → Create → Worker**
2. 起名（比如 `night-train`）→ **Edit code**，粘贴 `worker/12306-proxy.js` 全文 → **Deploy**
3. （可选）**Settings → Variables** 加一个 `SYNC_KEY`，值随便一串随机字符，用来允许写入 KV
4. （可选）**Settings → Bindings → KV Namespace** 新建命名空间，变量名填 **`SNAPSHOT`**
5. 拿到地址，形如 `https://night-train.你的子域.workers.dev`

然后打开 `web/index.html`，把地址填进去（改完记得跑一次 `node scripts/07-build-docs.mjs`）：

```html
<script>
  window.NIGHT_API = 'https://night-train.你的子域.workers.dev';
</script>
```

页面右上角会出现 **⟳ 同步 12306** 按钮，点一下：枚举车次 → 经 Worker 逐趟拉时刻表 →
存进浏览器 IndexedDB，24 小时内不重复拉。

### 为什么不用 Cloudflare 的 Cron 定时抓

试过，**跑不动**，不是配置问题：

- Workers 免费版每次调用最多 **50 个子请求**、**CPU 10ms**
- 完整抓一轮需要 **约 1200 次请求**（1150 趟车 × 1 次时刻表 + 车次枚举）

所以「每天自动更新」交给 GitHub Actions（不受这些限制），
Worker 只干两件事：**转发单个请求** 和 **存取 KV 里的整份快照**。

| 路由 | 作用 |
| --- | --- |
| `GET /snapshot` | 读 KV 里的当日快照，页面打开时优先用 |
| `POST /snapshot?key=` | 写入快照，需要 `SYNC_KEY`，由 GitHub Actions 调用 |
| `GET /proxy?u=` | 转发 12306 请求，带白名单，不会被当开放代理 |

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

**夜宿指数（0–100）** 由三项加权：发车时间 34% + 抵达时间 40% + 车上时长 26%。
90 分以上是「黄金夜宿」——睡前不用赶、醒来正好是早上七八点。

---

## 天气与白天/夜间模式

页面顶部有一条天气栏，显示**你要去的那个城市**的天气：

- 「到这儿来」模式：显示你选中的目的地
- 「从这儿出发」模式：默认显示排名第一的到达城市，点列表里任何城市可以切过去看

栏里给的是夜里赶车真正关心的四件事：**当前温度/体感**、**今晚 21:00 的温度**、
**明早 06:00 下车时的温度和降水概率**、**日落时间**（决定你上车时天还亮不亮）。

数据来自 [wttr.in](https://wttr.in)（WorldWeatherOnline 数据），**免注册、无需 Key、允许跨域**，
浏览器直连即可。抓不到就整条隐藏，不会干扰列车查询。

> 为什么不用国内天气 API？基本都要注册申请 Key，静态站点没法藏密钥。
> Open-Meteo 也考虑过，但在国内网络下经常连不上。

右上角的 **🌙 夜间 / ☀️ 白天** 按钮切换整套配色，选择会存进 `localStorage`；
也可以用 `?theme=light` 直接以白天模式打开。夜间模式下天气图标会跟着到达地的
昼夜状态变（晴天显示月亮而不是太阳）。

---

## 地图来源与合规

底图用的是**自然资源部「标准地图服务」**发布的《中国地图》1:6000 万：

- 来源：<http://bzdt.ch.mnr.gov.cn/>（通过其 SuperMap 地图服务取 1600×1200 的全国图幅）
- **审图号：GS(2016)1614**，自然资源部监制
- 完整包含南海诸岛、台湾岛、钓鱼岛、赤尾屿等，未作任何裁切或修改

程序把经纬度贴到这张图上，用的是「双标准纬线等角圆锥投影」（Lambert Conformal Conic），
参数是拿图上自带的经纬网和城市符号反推拟合的，见 `web/app.js` 的 `LCC` 常量。

⚠️ **使用这张底图请遵守标准地图服务的规定**：不得修改地图内容、不得裁掉南海诸岛、
使用时必须标注审图号。本项目在页面底部和 `LICENSE` 里都注明了审图号。

---

## 目录结构

```
night-train/
├─ docs/                   ← 编译好的整站，GitHub Pages 直接发布这个目录
│  ├─ index.html  app.js  live.js  weather.js  style.css
│  ├─ assets/china-standard-map.png
│  └─ data/app.json
├─ web/                    ← 源文件（app.js / weather.js / style.css，改完跑 07 生成 docs）
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
│  └─ 07-build-docs.mjs    ← 组装 docs/
├─ .github/workflows/refresh.yml  ← 每天自动更新
└─ 夜宿火车-便携版.zip     ← 发给别人的单文件包
```

> 改了 `web/` 里的东西，记得跑一次 `node scripts/07-build-docs.mjs`，否则线上不会变。

---

## 本地更新数据

```bash
node scripts/01-fetch-index.mjs      # 车次索引（12306 会限流，慢一点）
node scripts/02-fetch-schedules.mjs  # 经停时刻表（可断点续传）
node scripts/03-build.mjs            # 生成 data/app.json
node scripts/07-build-docs.mjs       # 重建 docs/
```

或者双击 `refresh.bat`，再双击 `package.bat` 重打便携包。

---

## 免责声明

- 时刻是 **运行图计划时刻**，不是当日实际开行；改点、临客、停运不会体现在这里。
- 不含票价、余票、卧铺席别；不含高铁动卧（D / G 字头）。
- 数据来自 12306 公开接口，本项目仅做整理展示，**出行前请以 12306 官方为准**。
- 与 12306、中国国家铁路集团无任何关联。

## License

代码 MIT；地图版权归自然资源部，使用须标注审图号 GS(2016)1614，详见 [LICENSE](LICENSE)。
