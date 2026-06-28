#!/usr/bin/env bash
# BreakCard 一键安装 —— 把「会自己弹卡的微健身桌宠」装到本机。
#   用法：./install.sh [clawd-on-desk 安装目录]   （默认 <本仓库>/clawd-on-desk）
#
# 为什么是脚本而不是打包成 app：clawd-on-desk 是 AGPL，打包分发会传染许可。
# 这里 clawd-on-desk 是在「你自己机器上」clone 的、不是我们分发的成品 → IP 干净（README §许可）。
set -euo pipefail

AIGYM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$AIGYM/clawd-on-desk}"
REPO="https://github.com/rullerzhou-afk/clawd-on-desk.git"
PIN="a17a1fe"   # 注入锚点对齐到的 clawd-on-desk 版本（换版本可能要更新 install/fragments）

say()  { printf "\033[1;36m▸ %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# 0) 前置
for c in git node npm; do command -v "$c" >/dev/null 2>&1 || die "需要 $c，请先安装再跑"; done

# 1) 取 clawd-on-desk（AGPL 引擎；已存在就沿用，不动你的检出）
if [ -d "$DEST/.git" ]; then
  say "已存在 clawd-on-desk：$DEST（沿用，不重新 clone）"
else
  say "clone clawd-on-desk → $DEST"
  git clone "$REPO" "$DEST"
  say "对齐到注入锚点版本 $PIN"
  git -C "$DEST" -c advice.detachedHead=false checkout -q "$PIN" || die "checkout $PIN 失败"
fi

# 2) 注入 + 软链 breakcard/ design/ + 比心素材（幂等，可重复跑）
say "注入 BreakCard 到引擎"
node "$AIGYM/install/inject.cjs" "$DEST" "$AIGYM"

# 3) 依赖
say "npm install（clawd-on-desk，首次几分钟）"
( cd "$DEST" && npm install )

printf "\n\033[1;32m✅ 装好了。\033[0m启动：\n  %s/start.sh\n  （等价于 cd \"%s\" && CLAWD_SKIP_SIDECAR_FETCH=1 npm start）\n" "$AIGYM" "$DEST"
