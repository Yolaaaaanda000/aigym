  // ===== BreakCard: working→idle 时触发抽卡浮窗 =====
  onStateTransition: (prev, next) => maybeShowBreakCard(prev, next),
