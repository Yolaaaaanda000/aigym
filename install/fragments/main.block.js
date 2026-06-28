// ===== BreakCard 微健身抽卡 =====
// 注：path 已在文件顶部 require（~line 70），BrowserWindow / ipcMain 已在顶部从 electron 解构（line 1），此处不再重复 require。
const { powerMonitor } = require("electron"); // 系统空闲时长：判断你是不是真停下来了
let breakWin = null;
let lastBreakShown = 0;
let busyStart = 0;      // 本轮“忙”的起点
let busyPoll = null;    // 忙碌期间的轮询句柄
const BUSY_STATES = new Set(["thinking", "working"]); // Claude 的忙碌态是 thinking/working
let userGoal = "strength";              // lose | strength | stretch，之后接 settings

// ===== 弹卡时机：读 design/triggers.json（Claire 拥有的配置），失败则用默认值 =====
let _bc = { minBusySec: 75, idleSec: 15, cooldownMin: 40, activeHours: { start: 8, end: 22 }, skipDuringStates: ["notification", "error", "sleeping"], enabled: true };
try {
  const _t = JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "design", "triggers.json"), "utf8"));
  _bc = { ..._bc, ...((_t.interventions && _t.interventions.breakcard) || {}) };
} catch (e) { console.warn("[breakcard] triggers.json 读取失败，用默认值:", e.message); }
const MIN_BUSY_MS       = (_bc.minBusySec ?? 75) * 1000;        // agent 连续忙这么久才算“真长任务”
const IDLE_SEC          = _bc.idleSec ?? 15;                    // 你输入静止这么久才算“真停下来在干等”
const BREAK_COOLDOWN_MS = (_bc.cooldownMin ?? 40) * 60 * 1000;  // 两次弹出至少间隔
const ACTIVE_START      = (_bc.activeHours && _bc.activeHours.start) ?? 8;  // 只在活跃时段弹
const ACTIVE_END        = (_bc.activeHours && _bc.activeHours.end) ?? 22;
const SKIP_STATES       = new Set(_bc.skipDuringStates || []);  // 这些状态下不弹（该你处理，不是运动时机）
const BC_ENABLED        = _bc.enabled !== false;

function withinActiveHours() {
  const h = new Date().getHours();
  return ACTIVE_START <= ACTIVE_END ? (h >= ACTIVE_START && h < ACTIVE_END)
                                    : (h >= ACTIVE_START || h < ACTIVE_END); // 跨午夜
}

// 真等待 = agent 持续忙够 && 你输入静止够（真停下来）&& 活跃时段 && 过冷却。任一不满足就继续等。
function tryPopBreakCard() {
  if (breakWin && !breakWin.isDestroyed()) return;             // 卡已开着
  const now = Date.now();
  if (now - busyStart < MIN_BUSY_MS) return;                   // 还没忙够
  if (now - lastBreakShown < BREAK_COOLDOWN_MS) return;        // 冷却中
  if (!withinActiveHours()) return;                            // 非活跃时段
  if (powerMonitor.getSystemIdleTime() < IDLE_SEC) return;     // 你还在动，没真停下来（可能在盯着读）
  console.log("[breakcard] 触发：真等待命中，弹卡");            // ⚠️ DEBUG
  showBreakCard();
  lastBreakShown = now;
  stopBusyWatch();                                            // 弹了就停轮询
}

function startBusyWatch() {
  if (busyPoll) return;                                       // 已在盯
  busyStart = Date.now();
  busyPoll = setInterval(tryPopBreakCard, 3000);             // 忙碌期间每 3s 检查一次条件
}
function stopBusyWatch() {
  if (busyPoll) { clearInterval(busyPoll); busyPoll = null; }
}

function maybeShowBreakCard(prevState, nextState) {
  if (!BC_ENABLED) return;
  if (SKIP_STATES.has(nextState)) { stopBusyWatch(); return; }  // 权限/报错/离开：这不是等待，停
  if (BUSY_STATES.has(nextState)) { startBusyWatch(); return; } // 进入忙碌：开始盯条件
  if (nextState === "idle") { stopBusyWatch(); }                // 真闲下来：这轮等待结束
  // attention 等其它中间态：不动，继续盯
}

function showBreakCard() {
  if (breakWin && !breakWin.isDestroyed()) { breakWin.show(); return; }
  const winW = 470, winH = 720, margin = 24;
  const { workArea } = screen.getPrimaryDisplay(); // 贴右侧、垂直居中，不挡屏幕中央
  breakWin = new BrowserWindow({
    width: winW, height: winH,
    x: workArea.x + workArea.width - winW - margin,
    y: workArea.y + Math.round((workArea.height - winH) / 2),
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, "..", "breakcard", "breakcard-preload.js") }
  });
  breakWin.loadFile(path.join(__dirname, "..", "breakcard", "breakcard.html"));
  breakWin.webContents.on("did-finish-load", () => {
    breakWin.webContents.executeJavaScript(
      `window.breakcardSetGoal && breakcardSetGoal("${userGoal}");`
    );
  });
  breakWin.on("closed", () => { breakWin = null; }); // 任何方式关闭都复位引用
}

ipcMain.on("breakcard-event", (_e, event) => {
  // 关窗交给浮窗自己 window.close()（这样完成屏能停留庆祝）；这里只做副作用
  if (event === "workout_done") {
    setState("love");   // 专属比心动画（themes/clawd 的 clawd-love.svg）
  }
});
// ===== /BreakCard =====
