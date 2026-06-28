# BreakCard 🦀

> 在你等 coding agent 跑完的间隙，桌宠递给你一张运动卡——抽一张，动 5 分钟。
> 别的桌宠在你等的时候卖萌，这个把等待变成微健身。

基于开源桌宠 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 扩展：
它负责桌宠 + 监听 Claude Code / Codex 的 hook + 透明窗口；
我们负责把「任务完成的那一刻」变成一次抽卡微健身。

---

## 目录分工（重要：避免互相撞车）

```
breakcard/        ← 浮窗（视图归 Claire / 逻辑归 Yolanda）
  breakcard.html        卡片 markup + CSS      ← Claire（视图）
  breakcard.js          浮窗逻辑 + 接口契约      ← Yolanda（逻辑）
  breakcard-preload.js  浮窗与主进程通信         ← Yolanda
  INJECTION.md          如何接进 clawd-on-desk   ← Yolanda
design/           ← 设计与内容（全归 Claire）
  moves.json            动作库 / 文案 / 目标分类
  triggers.json         弹卡时机（什么时候弹）
  README.md             给 Claire 的字段说明 ← 先看这个
  interaction-spec.md   交互方案（Claire 新建）
clawd-on-desk/    ← 官方桌宠引擎（AGPL，gitignore，只在 Yolanda 本机）
```

**规则：Claire 改 `breakcard.html`（视图）+ `design/`（内容）；Yolanda 改 `breakcard.js`（逻辑）+ `clawd-on-desk/`（引擎）。两人改不同文件，不会 git 冲突。**
改 json/CSS 内容不用对齐；改卡片「结构」（加元素 ID、改事件名）要先对一下接口契约——见 `breakcard/breakcard.js` 顶部。

---

## 怎么跑

这个仓库本身**不是一个能独立运行的 app**，它是叠加在 clawd-on-desk 上的扩展。下面三种用法按「你是谁」分。

### 想直接用（一键装，推荐）

本机有 `git` / `node` / `npm` 就行：
```bash
git clone https://github.com/Yolaaaaanda000/aigym.git
cd aigym
./install.sh      # clone clawd-on-desk → 注入 BreakCard → 软链 → 放比心素材 → npm install（幂等，可重复跑）
./start.sh        # 启动健身桌宠
```
`install.sh` 把 AGPL 引擎 clone 到**你自己机器**上（`clawd-on-desk/`，已 gitignore，不随本仓库分发 → IP 干净）。想装到别处：`./install.sh /你要的/路径`，启动同理 `./start.sh /你要的/路径`。

> 启动后：等你的 coding agent 跑长任务、你手停下来干等时，桌宠会自己递一张抽卡微健身浮窗 → 抽卡 → 按组训练 → 做完螃蟹比心。
> 想快点看到弹卡：`design/triggers.json` 把 `minBusySec` 临时改 `8`，再 `./start.sh`。

### 手动版（懂终端、想自己控制每一步）

`install.sh` 自动做的就是这四步，想手动也行：
1. clone 官方桌宠：`git clone https://github.com/rullerzhou-afk/clawd-on-desk.git`
2. 把本仓库的 `breakcard/`、`design/` **软链接**进 `clawd-on-desk/`（不复制，免漂移）
3. 按 `breakcard/INJECTION.md` 做三处注入（main.js / state.js / theme.json + 比心素材）
4. `cd clawd-on-desk && npm install && CLAWD_SKIP_SIDECAR_FETCH=1 npm start`

> 注入逻辑已脚本化在 `install/inject.cjs`（读 `install/fragments/` 里的代码片段，锚点插入、幂等）；`INJECTION.md` 讲的是它背后的 why。

### Claire 的开发方式（不用碰桌宠 / clawd-on-desk）

Claire 只需 clone 本仓库，改 `breakcard/breakcard.html`（视图）和 `design/`（内容），用浏览器预览——抽卡 / 翻牌 / 倒计时都能在浏览器里跑：
```bash
git clone https://github.com/Yolaaaaanda000/aigym.git && cd aigym
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/breakcard/breakcard.html
```
改完刷新即见。（关闭浮窗 / 螃蟹比心要真 app 才生效，由 Yolanda 那边验。）改完 commit + push，Yolanda `git pull` 后重启 app 就接上了。

---

## ⚠️ 许可 + 怎么分发给别人（影响商用）

clawd-on-desk 的源码是 **AGPL** 协议（传染性很强）。所以我们**不 fork、不把它的源码搬进本仓库**，只把它当运行依赖；本仓库只放我们自己写的 `breakcard/` + `design/`，许可自己定 —— 这样想商用、想脱离它独立，IP 是干净的。

**但「怎么给别人用」直接撞上 AGPL，分两条路：**

- **① 叠加包 + 安装说明（IP 干净，门槛高）**：别人自己 `git clone` clawd-on-desk，再套用本仓库的 `breakcard/`、`design/` + 按 [`breakcard/INJECTION.md`](breakcard/INJECTION.md) 注入（含比心素材）。你**没有分发 clawd 的代码** → IP 不被传染。代价：用户得会用终端、手动注入。← 现状就是这条（见上面「怎么跑」）。
- **② 打包成一个 app 直接发（门槛低，IP 被传染）**：把 clawd-on-desk + BreakCard 打成 `.dmg`/`.exe` 直接发。双击即用，但**你一旦分发「打包了 clawd 的成品」，AGPL 就要求你把整个分发的源码也按 AGPL 公开** —— 跟闭源/商用冲突。

**推荐（既能给别人用、又不踩 AGPL）= 现在的 `install.sh`**：用户跑一条命令，脚本在**他自己机器上**自动 clone clawd-on-desk、软链 `breakcard/`+`design/`、打补丁注入（`install/inject.cjs`）、放比心素材、`npm install`。clawd 是**他装的、不是你分发的** → IP 仍干净。这是门槛与合规的最佳平衡 —— 用法见上面「怎么跑 · 一键装」。（✅ 已落地，不再是手动版。）

---

## 现在做到哪了

- ✅ working→idle 时弹卡 → 选场景 → 翻翻乐抽卡 → **按组训练**（reps 点按 / hold·timed 读秒 / 组间休息）→ 做完所有组才螃蟹比心
- ✅ 本地记录（完成 / 拒绝 / 小睡，localStorage，不上云）+ 设置页（免打扰 / 弹卡频率 / 静默时段）
- ❌ 设置还没接通引擎：改了只存本地，暂不改弹卡时机 —— 下一步见 `breakcard/INJECTION.md`「B 待办」
- ❌ 不接屏幕使用时间统计；记录不上云、不做账号

验证了核心假设再往上加。
