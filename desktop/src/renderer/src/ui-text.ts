export const UI_TEXT = {
  loadingWorkspace: "正在加载工作目录...",
  currentWorkspaceHint: "当前工作目录",
  buttons: {
    openWorkspace: "打开目录",
    refresh: "刷新",
    new: "新建",
    start: "启动",
    stop: "停止",
    stopSelected: "停止当前",
    saveProfile: "保存角色",
    duplicate: "复制",
    delete: "删除",
    send: "发送",
    queue: "加入队列",
    pause: "暂停",
    create: "创建",
  },
  sections: {
    profiles: "智能体",
    profileEditor: "角色配置",
    conversation: "协作消息",
    orchestration: "受控编排",
    forwarding: "转发控制",
    tasks: "任务看板",
    terminals: "终端",
    runs: "运行记录",
  },
  labels: {
    name: "名称",
    command: "命令",
    args: "参数",
    aliases: "别名",
    rolePrompt: "角色提示",
    workspaceWriteLock: "启用工作目录写入锁",
    source: "来源",
    allProfiles: "全部智能体",
    manual: "手动",
    manualTrigger: "手动触发",
  },
  placeholders: {
    routedInput: "@codex 实现下一个任务",
    orchestrationGoal: "输入目标，先交给规划 Agent",
    forwardMessage: "把结果或审查请求发送给目标 Agent",
    taskTitle: "任务标题",
    taskDescription: "任务说明",
  },
  empty: {
    events: "当前工作目录暂无事件。",
    forwards: "当前工作目录暂无转发记录。",
    terminals: "启动一个智能体后会打开独立终端。",
    rawLog: "选择一条运行记录查看 raw.log。",
  },
  summaries: {
    onlineSuffix: "在线",
    started: "已启动",
    exited: "已退出",
  },
  errors: {
    addTargetPrefix: "请先添加 @profile 目标，例如 @codex。",
    targetNotOnline: (profileName: string) => `${profileName} 未在线，请先启动该智能体。`,
  },
} as const;

export const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  all: "全部",
  offline: "离线",
  starting: "启动中",
  pending: "待处理",
  running: "运行中",
  review: "审查中",
  done: "完成",
  failed: "失败",
  exited: "已退出",
  error: "错误",
  sent: "已发送",
  paused: "已暂停",
  stopped: "已停止",
  blocked: "阻塞",
  waiting_session: "等待会话",
  waiting_previous_step: "等待上一步",
  prompt_sent: "提示已发送",
  queued: "已排队",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  user_message: "用户消息",
  agent_output: "Agent 结果",
  session_started: "会话启动",
  session_exited: "会话退出",
  task_created: "任务创建",
  task_updated: "任务更新",
  orchestration_step: "编排步骤",
  agent_forward: "智能体转发",
  error: "错误",
};

export function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function formatEventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}
