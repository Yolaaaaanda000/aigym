/* =======================================================
   breakcard.js —— 场景盲盒抽卡 + 分组训练逻辑（Yolanda / 后端）
   视图在 breakcard.html（Claire 的 neobrutalism 设计）。两人改不同文件，不冲突。

   ── 接口契约（A 已跑通，B 增量保持兼容）──
   - 读取：fetch("../design/moves.json")（contexts / moves[].tags / moves[].protocol / config / doneMessages / refuseReasons）
   - 抛事件：notifyHost("workout_done" | "workout_skipped" | "workout_snoozed" | "dismissed")
       · workout_snoozed 是 B 新增（小睡，不算拒绝）。主进程未处理时安全忽略（见 INJECTION.md「B 待办」）。
   - 宿主调用：window.breakcardSetGoal(goal)
   - 记录：localStorage（仅本地，不联网）key=breakcard.records.v1
   - 设置：localStorage key=breakcard.settings.v1（仅本地持久化；真正改弹卡时机要接引擎，见 INJECTION.md「B 待办」）

   ── B 变更点 ──
   - 5 分钟计时 → 按组完成：读 move.protocol(reps/hold/timed) 展开成步骤，做完所有组才弹 Done
   - 新增「待会儿再说」小睡入口 + snooze 第四态
   - 新增设置页（免打扰 / 弹卡频率 / 静默时段），持久化到 localStorage
   ======================================================= */

let MOVES = [], GOALS = {}, CONTEXTS = {}, CTX_LIST = [], CONFIG = {}, TRIGGER = {}, DONE_MSGS = [], REASONS = [];
let CURRENT_GOAL = "strength", curCtx = "office", DURATION = 300;
let dealtMoves = [], chosen = null, chosenReason = null;
const $ = (id) => document.getElementById(id);
const DIMS = ["space", "noise", "social", "posture"];

const FALLBACK = {
  goals: { strength: "力量" },
  contexts: { office: { label: "🏢 办公室", max: { space: 1, noise: 0, social: 0, posture: 1 } } },
  config: { defaultContext: "office", drawCount: 6, durationSec: 300 },
  doneMessages: ["完成 ✓ 螃蟹给你比个心"],
  refuseReasons: ["待会儿再说"],
  moves: [{ zh: "站起来动一动", en: "Stand & Move", emoji: "🚶", goal: "strength", part: "全身", tags: { space: 0, noise: 0, social: 0, posture: 1 }, protocol: { mode: "timed", workSec: 60 }, desc: "moves.json 未加载，这是占位动作。" }]
};

async function loadData() {
  let d;
  try {
    const r = await fetch("../design/moves.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    d = await r.json();
  } catch (e) {
    console.warn("[breakcard] moves.json 加载失败，用占位数据:", e);
    d = FALLBACK;
  }
  MOVES = d.moves || [];
  GOALS = d.goals || {};
  CONTEXTS = d.contexts || {};
  CONFIG = d.config || {};
  TRIGGER = d.trigger || {};
  DONE_MSGS = (d.doneMessages && d.doneMessages.length) ? d.doneMessages : ["完成 ✓ 螃蟹给你比个心"];
  REASONS = d.refuseReasons || [];
  CTX_LIST = Object.keys(CONTEXTS).map(k => ({ key: k, label: CONTEXTS[k].label, max: CONTEXTS[k].max }));
  CURRENT_GOAL = CONFIG.defaultGoal || "strength";
  curCtx = CONFIG.defaultContext || (CTX_LIST[0] && CTX_LIST[0].key) || "office";
  DURATION = CONFIG.durationSec || 300;
}

/* ---- 场景过滤 + 加权抽样 ---- */
// 动作的每个 tag 都 ≤ 当前场景的 max，才进牌池
function eligible(ctxKey) {
  const max = (CONTEXTS[ctxKey] || {}).max || {};
  return MOVES.filter(m => DIMS.every(d => ((m.tags && m.tags[d]) || 0) <= (max[d] != null ? max[d] : 2)));
}
// 不放回加权抽样：命中当前目标的动作权重 ×3
function weightedSample(pool, n) {
  const ranked = pool.map(m => ({ m, k: Math.random() * ((CURRENT_GOAL && m.goal === CURRENT_GOAL) ? 3 : 1) }));
  ranked.sort((a, b) => b.k - a.k);
  return ranked.slice(0, Math.min(n, pool.length)).map(x => x.m);
}
function ctxLabelOf(key) {
  const c = CTX_LIST.find(x => x.key === key);
  return c ? c.label.replace(/^\S+\s*/, "") : key;
}

/* ---- protocol → 约估时长 / 结构文案 ---- */
function estSec(m) {
  const p = m.protocol; if (!p) return DURATION;
  const sets = p.sets || 1; let work;
  if (p.mode === "reps") work = sets * (p.reps || 0) * 2.5;
  else if (p.mode === "hold") work = sets * (p.holdSec || 0) * (p.perSide ? 2 : 1);
  else return Math.round(p.workSec || DURATION);          // timed
  return Math.round(work + (sets - 1) * (p.restSec || 0));
}
function estStr(m) { return "约 " + Math.max(1, Math.round(estSec(m) / 60)) + " 分钟"; }
function structStr(m) {
  const p = m.protocol; if (!p) return "";
  if (p.mode === "reps") return `${p.sets} 组 × ${p.reps} 次`;
  if (p.mode === "hold") return `${p.sets} 组 × ${p.holdSec} 秒${p.perSide ? "（左右）" : ""}`;
  return `持续 ${Math.round((p.workSec || 0) / 60)} 分钟`;
}

/* ---- 屏幕切换 ---- */
function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  if (id === "s-timer") startWorkout();
  if (id === "s-done") celebrate();
}

/* ① 抽卡 */
function renderCtx() {
  const row = $("ctxRow"); row.innerHTML = "";
  CTX_LIST.forEach(c => {
    const el = document.createElement("div");
    el.className = "ctx" + (c.key === curCtx ? " active" : "");
    el.textContent = c.label;
    el.onclick = () => { curCtx = c.key; renderCtx(); deal(); };
    row.appendChild(el);
  });
  const cur = CTX_LIST.find(c => c.key === curCtx);
  if (cur) $("aiCtx").textContent = cur.label.replace(/^\S+\s*/, "");
}
function deal() {
  const pool = eligible(curCtx);
  dealtMoves = weightedSample(pool, CONFIG.drawCount || 6);
  $("poolInfo").textContent = `${dealtMoves.length} 张适合这里`;
  const grid = $("grid"); grid.innerHTML = "";
  dealtMoves.forEach((mv, i) => {
    const slot = document.createElement("div");
    slot.className = "slot dealing"; slot.style.animationDelay = (i * 55) + "ms";
    slot.innerHTML = `<div class="mini">
        <div class="mf mback"><div class="ring">🦀</div><div class="q">?</div></div>
        <div class="mf mfront"><div class="e">${mv.emoji}</div><div class="n">${mv.zh}</div></div>
      </div>`;
    slot.onclick = () => pick(slot, i);
    grid.appendChild(slot);
  });
}
function pick(slot, i) {
  if (slot.querySelector(".mini").classList.contains("flipped")) return;
  document.querySelectorAll("#grid .slot").forEach(s => { if (s !== slot) s.classList.add("dim"); });
  slot.querySelector(".mini").classList.add("flipped");
  chosen = dealtMoves[i];
  setTimeout(() => { fillReveal(chosen); show("s-reveal"); resetGridDim(); }, 700);
}
function resetGridDim() {
  document.querySelectorAll("#grid .slot").forEach(s => {
    s.classList.remove("dim");
    s.querySelector(".mini").classList.remove("flipped");
  });
}

/* ② 翻开详情 */
function fitLabels(tags) {
  const t = tags || {}, out = [];
  if ((t.posture || 0) === 0 && (t.space || 0) === 0) out.push("坐着也能做");
  if ((t.noise || 0) === 0) out.push("静音");
  if ((t.social || 0) === 0) out.push("不易察觉");
  if ((t.space || 0) <= 1) out.push("小范围");
  return out;
}
function fillReveal(m) {
  $("rGoal").textContent = GOALS[m.goal] || m.goal;
  $("rZh").textContent = m.zh; $("rEn").textContent = m.en;
  $("rEmoji").textContent = m.emoji; $("rDesc").textContent = m.desc;
  if ($("rStruct")) $("rStruct").textContent = structStr(m);
  $("rTagGoal").textContent = GOALS[m.goal] || m.goal; $("rTagPart").textContent = m.part;
  if ($("rTagEst")) $("rTagEst").textContent = estStr(m);
  if ($("rStart")) $("rStart").textContent = "开始 · " + estStr(m);
  const fit = $("rFit"); fit.innerHTML = "";
  fitLabels(m.tags).forEach(lbl => {
    const s = document.createElement("span"); s.className = "fit"; s.textContent = "✓ " + lbl; fit.appendChild(s);
  });
  const bc = $("bigCard"); bc.style.animation = "none"; void bc.offsetWidth; bc.style.animation = "";
}

/* ③ 分组训练 —— 计划(plan) = 一串步骤(step)；做完最后一步才完成 */
let plan = [], stepIdx = 0, segTimer = null, paused = false;
function buildPlan(m) {
  const p = m.protocol || { mode: "timed", workSec: DURATION };
  const sets = p.sets || 1, steps = [];
  for (let s = 1; s <= sets; s++) {
    if (p.mode === "reps") steps.push({ kind: "reps", reps: p.reps, setNo: s, sets });
    else if (p.mode === "timed") steps.push({ kind: "timed", sec: p.workSec, setNo: s, sets });
    else { // hold
      if (p.perSide) {
        steps.push({ kind: "hold", sec: p.holdSec, setNo: s, sets, side: "左侧" });
        steps.push({ kind: "hold", sec: p.holdSec, setNo: s, sets, side: "右侧" });
      } else steps.push({ kind: "hold", sec: p.holdSec, setNo: s, sets });
    }
    if (s < sets && p.restSec) steps.push({ kind: "rest", sec: p.restSec, setNo: s, sets, next: s + 1 });
  }
  return steps;
}
function startWorkout() {
  if (!chosen) chosen = dealtMoves[0] || MOVES[0];
  plan = buildPlan(chosen); stepIdx = 0; paused = false;
  $("twName").textContent = chosen.zh; $("twPause").textContent = "⏸ 暂停";
  renderStep();
}
function dots(done, cur, total) {
  let h = ""; for (let i = 1; i <= total; i++) { const c = i <= done ? "done" : (i === cur ? "cur" : ""); h += `<span class="d ${c}"></span>`; }
  $("setDots").innerHTML = h;
}
function ring(colorClass) {
  return `<div class="wo-ring"><svg viewBox="0 0 200 200">
      <circle class="trk" cx="100" cy="100" r="90"></circle>
      <circle class="prg ${colorClass}" id="woProg" cx="100" cy="100" r="90" stroke-dasharray="565.48" stroke-dashoffset="0"></circle>
    </svg><div class="cnt" id="woCnt">0:00</div></div>`;
}
function runCountdown(sec, onDone) {
  let left = sec; const C = 565.48;
  const r = () => {
    const mm = Math.floor(left / 60), ss = left % 60;
    $("woCnt").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    $("woProg").style.strokeDashoffset = C * (1 - left / sec);
  };
  r(); clearInterval(segTimer);
  segTimer = setInterval(() => { if (paused) return; left--; if (left < 0) { clearInterval(segTimer); onDone(); return; } r(); }, 1000);
}
function renderStep() {
  const st = plan[stepIdx];
  if (!st) { clearInterval(segTimer); onWorkoutDone(); return; }   // 走完所有组 → 完成
  const area = $("workArea");
  if (st.kind === "rest") {
    dots(st.setNo, st.next, st.sets);
    $("twPhase").textContent = "休息一下";
    area.innerHTML = ring("cyan") + `<div class="rest-next">下一组：第 ${st.next} / ${st.sets} 组</div>
      <button class="btn-ghost btn-sm" id="skipRest">跳过休息 →</button>`;
    $("skipRest").onclick = () => { clearInterval(segTimer); next(); };
    runCountdown(st.sec, next);
  } else if (st.kind === "reps") {
    dots(st.setNo - 1, st.setNo, st.sets);
    $("twPhase").textContent = `第 ${st.setNo} / ${st.sets} 组`;
    area.innerHTML = `<div class="big-reps">×${st.reps}</div>
      <div class="reps-label">${chosen.zh}${st.side ? (" · " + st.side) : ""}</div>
      <div class="how-to">${chosen.desc || ""}</div>
      <button class="btn-go big-done" id="setDone">✓ 这组做完</button>`;
    $("setDone").onclick = next;
  } else { // hold / timed
    const isTimed = st.kind === "timed";
    dots(st.setNo - 1, st.setNo, st.sets);
    $("twPhase").textContent = isTimed ? "持续训练" : `第 ${st.setNo} / ${st.sets} 组`;
    area.innerHTML = ring("pink") + `<div class="wo-label">${isTimed ? "持续" : "保持"}${st.side ? (" · " + st.side) : ""}</div>
      <div class="how-to">${chosen.desc || ""}</div>`;
    runCountdown(st.sec, next);
  }
}
function next() { clearInterval(segTimer); stepIdx++; renderStep(); }
function skipSet() {
  clearInterval(segTimer);
  const cur = plan[stepIdx] ? plan[stepIdx].setNo : 0;
  while (stepIdx < plan.length && plan[stepIdx].setNo === cur) stepIdx++;
  renderStep();
}

/* ④ 完成（做完所有组才到这） */
function onWorkoutDone() {
  clearInterval(segTimer);
  addRecord({ type: "done", zh: chosen.zh, emoji: chosen.emoji, ctxLabel: ctxLabelOf(curCtx), why: null, ts: Date.now() });
  notifyHost("workout_done");   // 让桌面螃蟹比心（主进程不关窗，庆祝屏停留）
  show("s-done");
}
// 完成激励语跟着这次动作走：颈肩/眼睛→颈椎；减脂→心率；其余→比心（不给腿日发「颈椎感谢」）
function pickCheer(m) {
  if (m && (m.part === "颈肩" || m.part === "眼睛")) return '你的颈椎刚发来<br>一条<span class="hl">感谢</span>';
  if (m && m.goal === "lose") return '5 分钟偷回来了<br>这把<span class="hl">心率</span>你赢了';
  return '动完这一下<br>螃蟹给你<span class="hl">比个心</span>';
}
function celebrate() {
  $("cheer").innerHTML = pickCheer(chosen);
  const st = stats();
  $("streakN").textContent = st.streak; $("weekN").textContent = st.weekDone;
  const wrap = $("doneWrap");
  wrap.querySelectorAll(".confetti").forEach(c => c.remove());
  const colors = ["#ff5470", "#39c7ff", "#b6f23e", "#b18cff", "#ff8c3b"];
  for (let i = 0; i < 26; i++) {
    const c = document.createElement("div"); c.className = "confetti";
    c.style.left = (Math.random() * 100) + "%"; c.style.background = colors[i % colors.length];
    c.style.animationDuration = (1.1 + Math.random() * 1.1) + "s"; c.style.animationDelay = (Math.random() * .4) + "s";
    c.style.transform = `translateY(-20px) rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(c);
  }
}

/* ⑤ 拒绝 */
function renderReasons() {
  const box = $("reasons"); box.innerHTML = ""; chosenReason = null;
  if ($("refuseNote")) $("refuseNote").textContent = "选一个就好，也可以直接跳过";
  REASONS.forEach(r => {
    const el = document.createElement("div"); el.className = "reason"; el.textContent = r;
    el.onclick = () => {
      box.querySelectorAll(".reason").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel"); chosenReason = r;
      $("refuseNote").textContent = "🦀 记下了，会照着调整下次的推荐";
    };
    box.appendChild(el);
  });
}
function onRefuse() {
  addRecord({ type: "skip", zh: (chosen || {}).zh || "—", emoji: (chosen || {}).emoji || "🦀", ctxLabel: ctxLabelOf(curCtx), why: chosenReason, ts: Date.now() });
  notifyHost("workout_skipped");
}

/* ⑤b 小睡（「待会儿再说」，不算拒绝）—— B 新增第四态 */
function onSnooze() {
  const mins = (TRIGGER.snoozeOptions && TRIGGER.snoozeOptions[TRIGGER.snoozeOptions.length - 1]) || 30;
  addRecord({ type: "snooze", zh: (chosen || {}).zh || "—", emoji: (chosen || {}).emoji || "⏰", ctxLabel: ctxLabelOf(curCtx), why: `小睡 ${mins} 分钟`, ts: Date.now() });
  notifyHost("workout_snoozed");   // 主进程未处理时安全忽略；真正定时重弹是 B 引擎待办（INJECTION.md）
}

/* ⑥ 记录（localStorage，仅本地） */
const REC_KEY = "breakcard.records.v1";
const REC_LABEL = { done: "完成", skip: "拒绝", snooze: "小睡" };
function loadRecords() { try { return JSON.parse(localStorage.getItem(REC_KEY)) || []; } catch (e) { return []; } }
function saveRecords(a) { try { localStorage.setItem(REC_KEY, JSON.stringify(a.slice(0, 300))); } catch (e) {} }
function addRecord(rec) { const a = loadRecords(); a.unshift(rec); saveRecords(a); }
function stats() {
  const recs = loadRecords();
  const done = recs.filter(r => r.type === "done"), skip = recs.filter(r => r.type === "skip");
  const weekAgo = Date.now() - 7 * 864e5;
  const weekDone = done.filter(r => r.ts >= weekAgo).length;
  const daySet = new Set(done.map(r => new Date(r.ts).toDateString()));
  let streak = 0, d = new Date();
  while (daySet.has(d.toDateString())) { streak++; d = new Date(d.getTime() - 864e5); }
  const total = done.length + skip.length;   // 小睡不计入完成率（不算拒绝）
  return { weekDone, streak, rate: total ? Math.round(done.length / total * 100) : 0 };
}
function fmtWhen(ts) {
  const d = new Date(ts), now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return "今天 " + hm;
  if (d.toDateString() === new Date(now.getTime() - 864e5).toDateString()) return "昨天 " + hm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
}
let recFilter = "all";
function renderRecords() {
  const st = stats();
  const nums = document.querySelectorAll("#s-records .stats .num");
  if (nums[0]) nums[0].textContent = st.weekDone;
  if (nums[1]) nums[1].textContent = st.streak;
  if (nums[2]) nums[2].textContent = st.rate + "%";
  const list = $("recList"); list.innerHTML = "";
  const recs = loadRecords().filter(r => recFilter === "all" || r.type === recFilter);
  if (!recs.length) {
    list.innerHTML = `<div style="text-align:center;font-weight:700;opacity:.55;padding:26px 0">还没有记录，做完第一张就有了 🦀</div>`;
    return;
  }
  recs.forEach(r => {
    const el = document.createElement("div"); el.className = "rec";
    el.innerHTML = `<div class="ic">${r.emoji}</div>
      <div class="body">
        <div class="top"><span class="mv">${r.zh}</span>
          <span class="pill ${r.type}">${REC_LABEL[r.type] || r.type}</span>
          <span class="when">${fmtWhen(r.ts)}</span></div>
        <div class="meta">📍${r.ctxLabel}${r.why ? ` · <span class="why">原因：${r.why}</span>` : ""}</div>
      </div>`;
    list.appendChild(el);
  });
}
// 首次运行塞几条示例记录，让记录页 demo 时不空（清掉 localStorage 即重置）
function seedIfEmpty() {
  if (loadRecords().length) return;
  const t = Date.now();
  saveRecords([
    { type: "done", zh: "靠墙静蹲", emoji: "🧱", ctxLabel: "办公室", why: null, ts: t - 30 * 6e4 },
    { type: "done", zh: "颈部放松", emoji: "🧘", ctxLabel: "办公室", why: null, ts: t - 3 * 36e5 },
    { type: "snooze", zh: "开合跳", emoji: "🤸", ctxLabel: "办公室", why: "小睡 30 分钟", ts: t - 5 * 36e5 },
    { type: "skip", zh: "平板支撑", emoji: "💪", ctxLabel: "办公室", why: "环境不合适", ts: t - 26 * 36e5 },
    { type: "done", zh: "箱式呼吸", emoji: "🌬️", ctxLabel: "咖啡厅", why: null, ts: t - 27 * 36e5 },
    { type: "done", zh: "站姿提踵", emoji: "🦵", ctxLabel: "走廊", why: null, ts: t - 50 * 36e5 }
  ]);
}

/* ⑦ 设置（触发与免打扰）—— 仅本地持久化；真正改弹卡时机要接引擎，见 INJECTION.md「B 待办」 */
const SET_KEY = "breakcard.settings.v1";
// 频率档 → 引擎可消费的实际参数（B 接引擎时主进程读这套覆盖 triggers.json）
const FREQ_MAP = {
  low: { cooldownMin: 60, dailyCap: 4 },
  mid: { cooldownMin: 30, dailyCap: 8 },
  high: { cooldownMin: 15, dailyCap: 12 }
};
const FREQ_NOTE = {
  low: "少点：约每 60 分钟最多一次，每天 ≤ 4 次。",
  mid: "适中：约每 30 分钟最多一次，每天 ≤ 8 次。",
  high: "多点：约每 15 分钟最多一次，每天 ≤ 12 次。"
};
let SETTINGS = { dnd: false, freq: "mid", quiet: true };
function loadSettings() {
  try { SETTINGS = Object.assign(SETTINGS, JSON.parse(localStorage.getItem(SET_KEY)) || {}); } catch (e) {}
  if (typeof TRIGGER.dnd === "boolean" && localStorage.getItem(SET_KEY) == null) SETTINGS.dnd = TRIGGER.dnd;
}
function saveSettings() {
  const eff = FREQ_MAP[SETTINGS.freq] || FREQ_MAP.mid;
  const payload = {
    dnd: SETTINGS.dnd, freq: SETTINGS.freq, quiet: SETTINGS.quiet,
    // _effective：B 接引擎时主进程直接读这份覆盖 triggers.json 默认
    _effective: { dnd: SETTINGS.dnd, cooldownMin: eff.cooldownMin, dailyCap: eff.dailyCap, quietHours: SETTINGS.quiet ? (TRIGGER.quietHours || ["22:00", "08:00"]) : null }
  };
  try { localStorage.setItem(SET_KEY, JSON.stringify(payload)); } catch (e) {}
  // B 待办：window.breakcardAPI.saveSettings?.(payload) —— 经 IPC 把设置送到主进程落 user-settings.json
}
function renderSettings() {
  $("dndToggle").classList.toggle("on", SETTINGS.dnd);
  $("dndNote").textContent = SETTINGS.dnd ? "开：螃蟹暂时不递卡，专注/会议时用。" : "关：正常弹卡。开：专注/会议时，螃蟹不递卡。";
  $("freqSeg").querySelectorAll("span").forEach(s => s.classList.toggle("on", s.dataset.f === SETTINGS.freq));
  $("freqNote").textContent = FREQ_NOTE[SETTINGS.freq];
  $("quietToggle").classList.toggle("on", SETTINGS.quiet);
  if ($("quietVal")) {
    const q = TRIGGER.quietHours;
    if (q && q.length === 2) $("quietVal").textContent = q[0] + " – " + q[1];
    $("quietVal").style.opacity = SETTINGS.quiet ? "1" : ".4";
  }
}

/* ---- 与宿主通信 ---- */
function notifyHost(event) {
  if (window.breakcardAPI && window.breakcardAPI.notify) window.breakcardAPI.notify(event);
  else console.log("[breakcard] notifyHost:", event);
}
window.breakcardSetGoal = (g) => { CURRENT_GOAL = g; };

/* ---- 事件绑定 ---- */
$("reshuffle").onclick = deal;
$("snooze").onclick = () => { onSnooze(); const f = $("snooze"); f.textContent = "🦀 好，待会儿再喊你"; setTimeout(() => window.close(), 900); };
$("rRedraw").onclick = () => { deal(); show("s-draw"); };
$("rStart").onclick = () => show("s-timer");
$("rSkip").onclick = () => { renderReasons(); show("s-refuse"); };
$("twPause").onclick = () => { paused = !paused; $("twPause").textContent = paused ? "▶ 继续" : "⏸ 暂停"; };
$("twSkipSet").onclick = skipSet;
$("twGiveup").onclick = () => { clearInterval(segTimer); renderReasons(); show("s-refuse"); };
$("dClose").onclick = () => window.close();                 // 收下，关窗
$("dRecords").onclick = () => { renderRecords(); show("s-records"); };
$("fConfirm").onclick = () => { onRefuse(); renderRecords(); show("s-records"); };
$("fSkip").onclick = () => { onRefuse(); window.close(); };
$("recTabs").querySelectorAll(".tab").forEach(t => {
  t.onclick = () => {
    $("recTabs").querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active"); recFilter = t.dataset.f; renderRecords();
  };
});
$("gearBtn").onclick = () => { renderSettings(); show("s-settings"); };
$("setBack").onclick = () => show("s-draw");
$("dndToggle").onclick = () => { SETTINGS.dnd = !SETTINGS.dnd; saveSettings(); renderSettings(); };
$("quietToggle").onclick = () => { SETTINGS.quiet = !SETTINGS.quiet; saveSettings(); renderSettings(); };
$("freqSeg").querySelectorAll("span").forEach(s => s.onclick = () => { SETTINGS.freq = s.dataset.f; saveSettings(); renderSettings(); });
document.querySelector(".titlebar .x").onclick = () => { notifyHost("dismissed"); window.close(); };

/* ---- 启动 ---- */
loadData().then(() => {
  loadSettings();
  seedIfEmpty();
  renderCtx();
  deal();
});
