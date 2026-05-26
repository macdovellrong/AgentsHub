# AgentHub Terminal Stability Design

## 背景

当前 AgentHub 的终端链路是 Electron renderer 中的 xterm.js 直接接收主进程 `node-pty` 输出，并把用户输入通过 IPC 写回 PTY。这条链路简单、Windows 原生兼容性好，但相比 golutra 缺少三个稳定性机制：启动期输入缓冲、输出消费确认、终端内搜索。

## 目标

第一版只做低风险、可回退的终端稳定性增强：

- 在 Agent CLI 启动早期缓冲自动发送的输入，降低 Codex/Claude/Gemini 吞输入或回车不生效的概率。
- 为终端输出增加单调递增 `seq` 和 renderer ACK，建立后续背压、重连、去重的基础。
- 为 xterm 接入 SearchAddon，提供终端内搜索能力。

## 非目标

本阶段不实现完整后端 terminal emulator，不迁移到 Rust/Tauri，不实现完整 ANSI snapshot 恢复。后端快照需要解析 ANSI、光标、备用屏幕、resize 和滚动历史，复杂度应独立评估。

## 设计

### 输入 ready buffer

`PtySessionManager` 为每个 session 增加 `inputReady`、`inputBuffer`、`createdAt`、`firstOutputAt` 状态。会话创建后进入 warming 状态。来自编排、聊天转发、hook 后续观察等程序化输入先进入 buffer；满足任一条件后 flush：

- 首次 PTY 输出后经过短延迟；
- 会话创建超过 3000ms；
- 用户在终端直接交互输入。

flush 时复用现有 `splitSubmittedTerminalInput`、bracketed paste 和延迟回车策略，避免绕过已有 Codex/Claude/Gemini 特殊处理。

### 输出 seq 与 ACK

主进程为每个 session 维护 `outputSeq` 和 `unackedBytes`。每次 PTY data 事件持久化后发出：

```ts
{ sessionId, data, seq, byteLength }
```

renderer 在 `terminal.write(data, callback)` 完成后批量调用 `terminal:ack`。第一版只记录并扣减 `unackedBytes`，不暂停 PTY 读取；这样可以先验证 ACK 链路，不引入读流背压风险。

### SearchAddon

`TerminalPane` 加载 `@xterm/addon-search`。第一版暴露最小 UI：右键菜单增加“查找”，输入关键字后可查找下一处。后续可扩展为顶部搜索条、上一个/下一个和匹配计数。

## 数据与兼容性

IPC 类型在 `desktop/src/shared/ipc.ts` 中扩展，旧字段 `sessionId`、`data` 保持不变，renderer 可兼容已有输出事件。运行期数据仍写入 `<workspace>/.agenthub/`，不改变 run/event/chat/task-plan 存储格式。

## 测试

- `pty-session-manager`：覆盖 warming 状态输入缓冲、首次输出后 flush、超时 flush、用户输入直写、ACK 扣减。
- IPC guard：覆盖新增 `seq`、`byteLength` 与 `terminal:ack` 请求校验。
- renderer helper：覆盖 ACK 批量逻辑和搜索 addon 的最小接入点。

## 风险

启动期缓冲如果判断过严会让用户感觉输入延迟。因此用户直接键入的数据必须立即放行，缓冲主要面向程序化发送。ACK 第一版只观测不背压，避免因为 ACK bug 卡住终端输出。
