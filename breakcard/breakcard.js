/* =======================================================
   breakcard.js —— 浮窗逻辑（Yolanda / 后端）
   Claire 改 breakcard.html（视图 + CSS）；本文件只管逻辑。两人改不同文件、不冲突。

   ── 接口契约（Claire 设计新卡片时保留这些，逻辑就能直接接上）──
   - 读取：fetch("../design/moves.json")；宿主调用 window.breakcardSetGoal(goal)
   - 抛事件：notifyHost("workout_done" | "workout_skipped" | "dismissed")
   - 要填内容的元素 ID：goalLabel / moveZh / moveEn / moveEmoji / moveDesc
                       / tagGoal / tagPart / timerMove / count / prog
   - 按钮 ID：drawBtn / skipBtn / closeBtn
   ======================================================= */

let MOVES = [];                 // 启动时从 moves.json 加载
let GOAL_LABEL = {};            // 目标 key → 显示名，也来自 moves.json
let CONFIG = {};                // 文案/行为开关，来自 moves.json

// 加载失败时的兜底，保证浮窗在没有 json 时也不白屏（仅占位）
const FALLBACK = {
  goals: { strength: "力量" },
  moves: [{ zh:"站起来动一动", en:"Stand & Move", emoji:"🚶", goal:"strength", part:"全身", desc:"moves.json 未加载，这是占位动作。" }],
  config: {}
};

async function loadMoves(){
  try{
    const res = await fetch("../design/moves.json", { cache:"no-store" });
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    MOVES = data.moves || [];
    GOAL_LABEL = data.goals || {};
    CONFIG = data.config || {};
  }catch(e){
    console.warn("[breakcard] moves.json 加载失败，用占位数据:", e);
    MOVES = FALLBACK.moves; GOAL_LABEL = FALLBACK.goals; CONFIG = FALLBACK.config;
  }
}

/* 当前健身目标 —— 决定加权抽卡。之后从用户设置读取 */
let CURRENT_GOAL = "strength";        // lose | strength | stretch | null(=不偏好)
let DURATION = 300;                   // 默认 5 分钟；由 design/moves.json 的 config.durationSec 覆盖（Claire 可调）

/* ---- 加权抽卡 ---- */
function drawMove(){
  // 命中目标的动作权重×3，其它×1
  const weighted = [];
  for(const m of MOVES){
    const w = (CURRENT_GOAL && m.goal===CURRENT_GOAL) ? 3 : 1;
    for(let i=0;i<w;i++) weighted.push(m);
  }
  return weighted[Math.floor(Math.random()*weighted.length)];
}

const deck=document.getElementById("deck");
const card=document.getElementById("card");
const drawBtn=document.getElementById("drawBtn");
const skipBtn=document.getElementById("skipBtn");
const controls=document.getElementById("controls");
const timer=document.getElementById("timer");
let dealt=false, ticking=null;

function fillCard(m){
  document.getElementById("goalLabel").textContent = GOAL_LABEL[m.goal];
  document.getElementById("moveZh").textContent = m.zh;
  document.getElementById("moveEn").textContent = m.en;
  document.getElementById("moveEmoji").textContent = m.emoji;
  document.getElementById("moveDesc").textContent = m.desc;
  document.getElementById("tagGoal").textContent = GOAL_LABEL[m.goal];
  document.getElementById("tagPart").textContent = m.part;
  document.getElementById("timerMove").textContent = m.zh;
}

function handleDraw(){
  if(dealt) return;
  dealt=true;
  const m=drawMove();
  fillCard(m);
  deck.classList.add("dealing");
  setTimeout(()=>{
    deck.classList.remove("dealing");
    deck.classList.add("flipped");          // 翻到正面
    // 翻完后把按钮换成"开始 5 分钟 / 再抽一张"
    drawBtn.textContent="开始 5 分钟";
    drawBtn.onclick=startTimer;
    skipBtn.textContent="换一张";
    skipBtn.onclick=reDraw;
  },480);
}

function reDraw(){
  deck.classList.remove("flipped");
  setTimeout(()=>{ dealt=false; handleDraw(); },400);
}

function startTimer(){
  controls.classList.add("hidden");
  timer.classList.add("show");
  const prog=document.getElementById("prog");
  const count=document.getElementById("count");
  const C=565.48;
  let left=DURATION;
  const render=()=>{
    const mm=Math.floor(left/60), ss=left%60;
    count.textContent=`${mm}:${String(ss).padStart(2,"0")}`;
    prog.style.strokeDashoffset = C*(1-left/DURATION);
  };
  render();
  ticking=setInterval(()=>{
    left--;
    if(left<0){ finish(); return; }
    render();
  },1000);
}

function finish(){
  clearInterval(ticking);
  document.getElementById("timerSub").textContent="完成 ✓ 螃蟹给你比个心";
  document.getElementById("count").textContent="✓";
  document.querySelector(".prog").style.stroke="var(--accent-cool)";
  card.parentElement.classList.add("done");
  // 通知宿主(Electron): 该让螃蟹切到 happy/比心，并关掉浮窗
  setTimeout(()=>{ notifyHost("workout_done"); window.close(); }, 1800);
}

function handleSkip(){ notifyHost("workout_skipped"); window.close(); }

/* ---- 与宿主通信的桩。浏览器调试时只 console.log ---- */
function notifyHost(event){
  if(window.breakcardAPI && window.breakcardAPI.notify){
    window.breakcardAPI.notify(event);
  }else{
    console.log("[breakcard] notifyHost:", event);
    // 浏览器调试: 自己复位
    if(event!=="workout_done") location.reload();
  }
}

drawBtn.onclick=handleDraw;
skipBtn.onclick=handleSkip;
document.getElementById("closeBtn").onclick = ()=>{ notifyHost("dismissed"); window.close(); };

/* 宿主可调用: 设置目标 + 自动展示 */
window.breakcardSetGoal = (g)=>{ CURRENT_GOAL = g; };

/* ---- 启动：先加载数据，再放开抽卡 ---- */
drawBtn.disabled = true;
drawBtn.textContent = "准备中…";
loadMoves().then(()=>{
  drawBtn.disabled = false;
  drawBtn.textContent = "抽一张";
  // 若 config 里有默认目标，用它
  if(CONFIG.defaultGoal) CURRENT_GOAL = CONFIG.defaultGoal;
  // 倒计时时长也由 Claire 在 moves.json 的 config.durationSec 控制（秒）
  if(CONFIG.durationSec) DURATION = CONFIG.durationSec;
});
