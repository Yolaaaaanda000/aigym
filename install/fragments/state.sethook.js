  // ===== BreakCard: 上报状态跳变（prev=currentState, next=newState）；working→idle 命中抽卡 =====
  try {
    if (typeof ctx.onStateTransition === "function") {
      ctx.onStateTransition(currentState, newState);
    }
  } catch (e) {}
  // ===== /BreakCard =====
