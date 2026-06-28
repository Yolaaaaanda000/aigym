#!/usr/bin/env bash
# 启动健身桌宠。用法：./start.sh [clawd-on-desk 目录]（默认 <本仓库>/clawd-on-desk）
set -euo pipefail
AIGYM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$AIGYM/clawd-on-desk}"
[ -d "$DEST" ] || { echo "没找到 $DEST —— 先跑 ./install.sh"; exit 1; }
cd "$DEST"
export CLAWD_SKIP_SIDECAR_FETCH=1   # 跳过 sidecar 下载（更快/可离线）；要完整 sidecar 把这行删掉
exec npm start
