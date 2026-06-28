# BreakCard 交互方案 v1（Claire → 给 Yolanda 对齐）

> 这份是 README 里说的「改结构要先对一下」的那份对齐文档。
> **内容（moves.json 里加动作/改文案）我已经直接改了，不用对；这份讲的是「结构 / 流程 / 引擎要做的事」，需要你过一遍。**
> 可点的视觉原型：`design/prototype/breakcard-ui.html`（neobrutalism 风 + 思源黑体，数据内置，双击即开，底部 demo 导航可跳全部 7 个画面）。

---

## 1. 一句话：从「单卡」升级成「场景盲盒 + 分组训练 + 记录 + AI 调整」

v0：弹一张牌 → 抽一张 → 翻面 → 5 分钟 → 完成。
v1 主流程：

```
选场景(chip) → 该场景发 6 张牌背(翻翻乐) → 点一张翻开(盲盒惊喜)
   → 看动作详情(含组数 & 约估时长) → 开始 → 按组训练(reps点按/hold计时/组间休息)
   → 做完所有组才弹 Done(激励语) 或 中途放弃→拒绝(问原因)
   → 全程写入「记录」；AI 阶段性根据记录调整下次抽卡
   ↑ 触发与免打扰：working→idle 直接弹整张卡，受 设置页/trigger 参数 约束
```

核心假设没变：等 agent 时被递一张卡，动一下。新增的是：抽得更合场景、动得更像真训练（分组）、做没做记下来、推荐会进化、不烦人。

---

## 2. 数据结构变更（moves.json）—— 重点看这里

**都是增量字段，老引擎忽略它们仍能按 goal 加权随机跑，不会崩。**

### 2.1 `contexts` 场景 + 每 move 的 `tags`（盲盒按场景过滤）
```json
"contexts": { "office": { "label":"🏢 办公室/工位", "max": {"space":1,"noise":0,"social":0,"posture":1} }, ... }
{ "zh":"靠墙静蹲", ..., "tags": {"space":1,"noise":0,"social":0,"posture":1} }
```
四维约束 `0..2`，越小越克制：space 空间 / noise 声音 / social 社死度 / posture 姿势。
**过滤规则：`move.tags[d] <= context.max[d]` 四维都成立 → 进该场景牌池。** 已验证每场景都 ≥6 张可发（office 12 / cafe 8 / home 21 / hallway 14）。

### 2.2 每 move 的 `protocol` 组数/节奏（本次新增的重点）
```json
靠墙静蹲 → "protocol": { "mode":"hold",  "sets":3, "holdSec":45, "restSec":20 }
深蹲类   → "protocol": { "mode":"reps",  "sets":3, "reps":12,   "restSec":20 }
颈部放松 → "protocol": { "mode":"hold",  "sets":2, "holdSec":30, "restSec":10, "perSide":true }
原地踏步 → "protocol": { "mode":"timed", "workSec":180 }
```
三种 `mode`：

| mode | 谁判定"这组完了" | 用于 |
|---|---|---|
| `reps` 次数型 | **人点「✓ 这组做完」推进**（机器数不出个数） | 深蹲/俯卧撑/开合跳/弓步… |
| `hold` 保持型 | **倒计时自动跳**；`perSide:true` 则左右各一次 | 平板/靠墙静蹲/各种拉伸 |
| `timed` 持续型 | 倒计时自动跳，一段时长 | 踏步/呼吸/远眺 |

字段：`sets` 组数 · `reps` 每组次数 · `holdSec` 每组保持秒 · `restSec` 组间休息秒 · `workSec` 持续秒 · `perSide` 是否分左右。

### 2.3 `config.trigger` 触发与免打扰参数（新增）
```json
"trigger": {
  "cooldownMin": 30,   // 两次弹卡最小间隔
  "dailyCap": 8,       // 每天上限
  "minWorkMin": 10,    // 至少专注工作这么久才弹(短任务不打扰)
  "quietHours": ["22:00","08:00"],
  "snoozeOptions": [5, 30],
  "dnd": false         // 免打扰开关
}
```

### 2.4 顺手挪进 json 的文案（你之前写死的，现在归 Claire）
`config.defaultContext`、`config.drawCount`(6)、`doneMessages[]`、`refuseReasons[]`。

---

## 3. 两个核心机制的判定规则（要和引擎对齐的"结构"）

### 3.1 完成 = 做完所有组（不是 5 分钟到点）
- 由 protocol 展开成一串"步骤"：每组的工作段 + 组间休息段（最后一组后无休息）。`perSide` 的 hold 每组拆成 左/右 两段。
- reps 段等用户点「这组做完」；hold/timed/rest 段走倒计时自动推进。
- **走完最后一段才触发 `workout_done`**（通知宿主让螃蟹比心）。
- 训练页提供：暂停/继续、跳过这组、放弃（=进拒绝流程）。
- "5 分钟"退成产品口号；卡面显示由 protocol 算出的**真实约估时长**（原型里 `estStr()`，每动作 1~5 分钟不等）。

### 3.2 触发 = 直接弹整张卡 + 三态记录
- **弹卡方式：直接弹整张抽卡浮窗**（不做两段式小牌；已和 Claire 确认）。
- **免打扰：手动开关 + 静默时段**（v1 不做全屏/会议自动检测）。判定/调度在引擎+宿主侧，参数读 `config.trigger`。
- **「没做」分三态，别混为一谈**（影响 AI 不要误判）：

| 行为 | 触发 | 记成 | 通知宿主 |
|---|---|---|---|
| 完成 | 做完所有组 | `done` | `workout_done` |
| 拒绝 | 点「这次不练 / 放弃」+ 选原因 | `skip` + 原因 | `workout_skipped` |
| 小睡 | 点「待会儿再说」/ 选小睡时长 | `snooze` + 时长（不算拒绝） | `workout_snoozed`(建议新增) |
| 忽略 | （直接弹卡场景下＝弹出后一直没操作自动收起） | `ignored`（弱信号） | 可选 |

---

## 4. 引擎要做/改的点（按优先级）

### P0（demo 必须有）
1. 读 `contexts`+`tags`，**按场景过滤后再加权随机发 `drawCount` 张**（原 goal×3 加权保留，先过场景滤网）。
2. **6 张翻翻乐**：发 6 牌背 → 点一张翻开该张(其余变暗) → 动作详情。
3. 场景 chip 切换即重发；默认 `config.defaultContext`。
4. **读 protocol，按组训练**（reps 点按推进 / hold·timed 计时 / 组间休息），**做完所有组才弹 Done**。见 §3.1。
5. 完成→随机 `doneMessages`；放弃/拒绝→`refuseReasons` 选原因。

### P1（记录功能，先对"存哪"，见 §5）
6. 记录每次 `{动作, 场景, 结果(done/skip/snooze/ignored), 原因, 时间}`。
7. 记录页：统计(本周完成/连续天数/完成率) + 列表(全部/完成/拒绝筛选)。原型第 ⑥ 屏。

### P1（触发与免打扰）
8. working→idle 弹卡时套上 `cooldownMin / dailyCap / minWorkMin / quietHours / dnd` 这几道闸。
9. 设置页(原型第 ⑦ 屏)：免打扰开关、弹卡频率(少/中/多→映射 cooldown+cap)、静默时段开关。设置写回 `config.trigger`（或宿主侧用户配置）。

### P2（Agents，先静态占位）
10. 基于记录做**规则式重加权**：某动作连拒→降权/暂停；某场景只接受拉伸→调高该场景拉伸权重；最常拒因「正忙」→默认时长/强度调低；学时段→自动选场景 & 挑最可能被接受的时机弹。原型抽卡页 banner + 记录页「AI 洞察」是它的 UI 出口。

---

## 5. 待定决策（需要你拍板 / 一起定）
1. **记录存哪**：建议 v1 只本地存储（localStorage 或宿主侧本地 json），不联网、不碰隐私，只存 动作/场景/结果/原因/时间戳。够喂记录页 + 规则式 AI。
2. **翻翻乐结构**：确认「点一张翻一张、其余变暗」；要"翻开还能反悔再翻别的"就告诉我。
3. **浮窗尺寸**：6 张牌 + chip + 训练页比 v0 大，原型面板宽 ~408px，注入 Electron 时相应放大。
4. **`workout_snoozed` 事件**：小睡要不要单独发个事件给宿主（区别于 skip），还是宿主侧自己计时重弹。
5. **字体离线**：neobrutalism 用思源黑体走 Google Fonts CDN；上线要完全离线就把字体打包进项目本地引用。

---

## 6. 边界（v1 仍不做）
- 不接屏幕使用时间统计；免打扰不做自动检测（全屏/会议/麦克风）。
- 记录只本地、不上云、不做账号。
- AI 先规则式，不引入训练/模型服务。

先把「场景盲盒 + 分组训练 + 记录 + 不烦人的触发」跑通，验证「人会按场景、按组动起来」，再加 AI 深度。
