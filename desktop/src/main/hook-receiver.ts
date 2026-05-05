import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentHubEvent, EventStore } from "./event-store";

const DEFAULT_HOOK_PORT = 38765;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RANDOM_PORT_ATTEMPTS = 10;
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103,
  104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513,
  514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export type HookReceiverInfo = {
  url: string;
  token: string;
};

export type AgentResultHookReceiverOptions = {
  port?: number;
  token?: string;
  eventStore: EventStore;
  onEventAppended?: (workspacePath: string, event: AgentHubEvent) => void;
};

type AgentResultPayload = {
  source?: unknown;
  hookEvent?: unknown;
  profileId?: unknown;
  profileName?: unknown;
  agenthubSessionId?: unknown;
  runId?: unknown;
  workspace?: unknown;
  providerSessionId?: unknown;
  providerTurnId?: unknown;
  model?: unknown;
  cwd?: unknown;
  message?: unknown;
  last_assistant_message?: unknown;
  last_agent_message?: unknown;
  prompt_response?: unknown;
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
  request_id?: unknown;
  transcript_path?: unknown;
  conversationId?: unknown;
  conversation_id?: unknown;
  planId?: unknown;
  plan_id?: unknown;
  taskId?: unknown;
  task_id?: unknown;
  teamId?: unknown;
  team_id?: unknown;
};

export class AgentResultHookReceiver {
  private readonly configuredPort: number;
  private readonly token: string;
  private readonly eventStore: EventStore;
  private readonly onEventAppended: ((workspacePath: string, event: AgentHubEvent) => void) | undefined;
  private server: Server | null = null;
  private url: string;

  constructor(options: AgentResultHookReceiverOptions) {
    this.configuredPort = options.port ?? DEFAULT_HOOK_PORT;
    this.token = options.token ?? randomBytes(32).toString("hex");
    this.eventStore = options.eventStore;
    this.onEventAppended = options.onEventAppended;
    this.url = `http://127.0.0.1:${this.configuredPort}/api/agent-result`;
  }

  async start(): Promise<HookReceiverInfo> {
    if (this.server) {
      return this.getClientEnvironment();
    }

    for (let attempt = 0; attempt < MAX_RANDOM_PORT_ATTEMPTS; attempt += 1) {
      const server = http.createServer((request, response) => {
        void this.handleRequest(request, response);
      });
      const port = await listenOnLocalhost(server, this.configuredPort);
      if (this.configuredPort === 0 && FETCH_BLOCKED_PORTS.has(port)) {
        await closeServer(server);
        continue;
      }
      this.server = server;
      this.url = `http://127.0.0.1:${port}/api/agent-result`;
      return this.getClientEnvironment();
    }

    throw new Error("Unable to allocate a fetch-safe hook receiver port");
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = null;
    await closeServer(server);
  }

  getClientEnvironment(): HookReceiverInfo {
    return {
      url: this.url,
      token: this.token,
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== "POST" || request.url !== "/api/agent-result") {
        this.sendJson(response, 404, { ok: false, error: "not_found" });
        return;
      }

      if (request.headers["x-agenthub-token"] !== this.token) {
        console.warn(`[agenthub:hook] rejected status=401 error=invalid_token`);
        this.sendJson(response, 401, { ok: false, error: "invalid_token" });
        return;
      }

      const body = await this.readBody(request);
      const payload = JSON.parse(body) as AgentResultPayload;
      const workspacePath = requiredString(
        optionalString(payload.workspace) ?? headerString(request, "x-agenthub-workspace"),
        "workspace",
      );
      const message = requiredString(await resolveAgentMessage(payload), "message");
      const profileId = optionalString(payload.profileId) ?? headerString(request, "x-agenthub-profile-id");
      const sessionId = optionalString(payload.agenthubSessionId) ?? headerString(request, "x-agenthub-session-id");
      const explicitConversationId =
        optionalString(payload.conversationId) ??
        optionalString(payload.conversation_id) ??
        headerString(request, "x-agenthub-conversation-id");
      const explicitTaskId =
        optionalString(payload.taskId) ?? optionalString(payload.task_id) ?? headerString(request, "x-agenthub-task-id");
      const explicitPlanId =
        optionalString(payload.planId) ?? optionalString(payload.plan_id) ?? headerString(request, "x-agenthub-plan-id");
      const teamId =
        optionalString(payload.teamId) ?? optionalString(payload.team_id) ?? headerString(request, "x-agenthub-team-id");
      const inferredTaskPlanMetadata = await this.resolvePendingTaskPlanMetadata(workspacePath, {
        profileId,
        sessionId,
        planId: explicitPlanId,
        taskId: explicitTaskId,
      });
      const planId = explicitPlanId ?? inferredTaskPlanMetadata.planId;
      const inferredConversationMetadata: { conversationId?: string; taskId?: string } = planId
        ? {}
        : await this.resolvePendingConversationMetadata(workspacePath, {
            profileId,
            sessionId,
            conversationId: explicitConversationId,
            taskId: explicitTaskId,
          });
      const taskId = explicitTaskId ?? inferredTaskPlanMetadata.taskId ?? inferredConversationMetadata.taskId;
      const metadata = compactMetadata({
        source: optionalString(payload.source) ?? headerString(request, "x-agenthub-source"),
        hookEvent: optionalString(payload.hookEvent) ?? optionalString(payload.hook_event_name),
        providerSessionId: optionalString(payload.providerSessionId) ?? optionalString(payload.session_id),
        providerTurnId:
          optionalString(payload.providerTurnId) ?? optionalString(payload.turn_id) ?? optionalString(payload.request_id),
        model: optionalString(payload.model),
        cwd: optionalString(payload.cwd),
        teamId,
        planId,
      });

      const event = await this.eventStore.append(workspacePath, {
        type: "agent_output",
        profileId,
        profileName: optionalString(payload.profileName),
        sessionId,
        runId: optionalString(payload.runId) ?? headerString(request, "x-agenthub-run-id"),
        conversationId: explicitConversationId ?? inferredConversationMetadata.conversationId,
        taskId,
        message,
        metadata,
      });
      this.onEventAppended?.(workspacePath, event);
      console.log(
        `[agenthub:hook] accepted profile=${event.profileId ?? ""} run=${event.runId ?? ""} chars=${message.length}`,
      );
      this.sendJson(response, 200, { ok: true, eventId: event.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "payload_too_large" ? 413 : 400;
      console.warn(`[agenthub:hook] rejected status=${statusCode} error=${message}`);
      this.sendJson(response, statusCode, { ok: false, error: message });
    }
  }

  private async resolvePendingConversationMetadata(
    workspacePath: string,
    input: {
      profileId?: string;
      sessionId?: string;
      conversationId?: string;
      taskId?: string;
    },
  ): Promise<{ conversationId?: string; taskId?: string }> {
    if (!input.profileId || (input.conversationId && input.taskId)) {
      return {};
    }

    const events = await this.eventStore.list(workspacePath);
    for (const event of events.slice().reverse()) {
      if (!isPendingConversationDelivery(event, input.profileId)) {
        continue;
      }
      if (input.sessionId && event.sessionId && event.sessionId !== input.sessionId) {
        continue;
      }
      if (input.conversationId && event.conversationId !== input.conversationId) {
        continue;
      }
      if (input.taskId && event.taskId !== input.taskId) {
        continue;
      }
      if (hasLaterManualMessage(events, event, input.profileId)) {
        continue;
      }
      if (hasLaterAgentOutput(events, event, input.profileId, input.sessionId)) {
        continue;
      }
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
      };
    }

    return {};
  }

  private async resolvePendingTaskPlanMetadata(
    workspacePath: string,
    input: {
      profileId?: string;
      sessionId?: string;
      planId?: string;
      taskId?: string;
    },
  ): Promise<{ planId?: string; taskId?: string }> {
    if (!input.profileId || (input.planId && input.taskId)) {
      return {};
    }

    const events = await this.eventStore.list(workspacePath);
    for (const event of events.slice().reverse()) {
      const eventPlanId = taskPlanIdFromEvent(event);
      if (!eventPlanId || !isPendingTaskPlanDelivery(event, input.profileId)) {
        continue;
      }
      if (input.sessionId && event.sessionId && event.sessionId !== input.sessionId) {
        continue;
      }
      if (input.planId && eventPlanId !== input.planId) {
        continue;
      }
      if (input.taskId && event.taskId !== input.taskId) {
        continue;
      }
      if (hasLaterManualMessage(events, event, input.profileId)) {
        continue;
      }
      if (hasLaterTaskPlanAgentOutput(events, event, input.profileId, input.sessionId)) {
        continue;
      }
      return {
        planId: eventPlanId,
        taskId: event.taskId,
      };
    }

    return {};
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      request.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          reject(new Error("payload_too_large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", reject);
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  }
}

function listenOnLocalhost(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address() as AddressInfo | null;
      resolve(address?.port ?? port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isPendingConversationDelivery(event: AgentHubEvent, profileId: string): boolean {
  if (!event.conversationId || event.targetProfileId !== profileId) {
    return false;
  }
  if (event.type === "agent_forward") {
    return event.deliveryStatus === "sent";
  }
  if (event.type === "orchestration_step") {
    return event.status !== "failed";
  }
  return false;
}

function isPendingTaskPlanDelivery(event: AgentHubEvent, profileId: string): boolean {
  return (
    event.type === "agent_forward" &&
    event.deliveryStatus === "sent" &&
    event.targetProfileId === profileId &&
    taskPlanIdFromEvent(event) !== undefined
  );
}

function hasLaterManualMessage(events: AgentHubEvent[], delivery: AgentHubEvent, profileId: string): boolean {
  return laterEvents(events, delivery).some(
    (event) => event.type === "user_message" && event.targetProfileId === profileId,
  );
}

function hasLaterAgentOutput(
  events: AgentHubEvent[],
  delivery: AgentHubEvent,
  profileId: string,
  sessionId?: string,
): boolean {
  return laterEvents(events, delivery).some((event) => {
    if (
      event.type !== "agent_output" ||
      event.profileId !== profileId ||
      event.conversationId !== delivery.conversationId
    ) {
      return false;
    }
    if (sessionId && event.sessionId && event.sessionId !== sessionId) {
      return false;
    }
    if (delivery.taskId && event.taskId !== delivery.taskId) {
      return false;
    }
    return true;
  });
}

function hasLaterTaskPlanAgentOutput(
  events: AgentHubEvent[],
  delivery: AgentHubEvent,
  profileId: string,
  sessionId?: string,
): boolean {
  const deliveryPlanId = taskPlanIdFromEvent(delivery);
  return laterEvents(events, delivery).some((event) => {
    if (
      event.type !== "agent_output" ||
      event.profileId !== profileId ||
      taskPlanIdFromEvent(event) !== deliveryPlanId
    ) {
      return false;
    }
    if (sessionId && event.sessionId && event.sessionId !== sessionId) {
      return false;
    }
    if (delivery.taskId && event.taskId !== delivery.taskId) {
      return false;
    }
    return true;
  });
}

function taskPlanIdFromEvent(event: AgentHubEvent): string | undefined {
  const planId = event.metadata?.planId;
  return typeof planId === "string" && planId.length > 0 ? planId : undefined;
}

function laterEvents(events: AgentHubEvent[], delivery: AgentHubEvent): AgentHubEvent[] {
  const deliveryIndex = events.indexOf(delivery);
  return deliveryIndex === -1 ? [] : events.slice(deliveryIndex + 1);
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing_${fieldName}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compactMetadata(metadata: Record<string, string | undefined>): Record<string, string> {
  const compacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted;
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function resolveAgentMessage(payload: AgentResultPayload): Promise<string | undefined> {
  const directMessage =
    optionalString(payload.message) ??
    optionalString(payload.last_assistant_message) ??
    optionalString(payload.last_agent_message) ??
    optionalString(payload.prompt_response);
  if (directMessage) {
    return directMessage;
  }

  const transcriptPath = optionalString(payload.transcript_path);
  if (!transcriptPath) {
    return undefined;
  }

  return extractMessageFromTranscript(transcriptPath);
}

async function extractMessageFromTranscript(transcriptPath: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return undefined;
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines.reverse()) {
    try {
      const entry = JSON.parse(line) as unknown;
      const message = extractMessageFromTranscriptEntry(entry);
      if (message) {
        return message;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractMessageFromTranscriptEntry(entry: unknown): string | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  const payload = entry.payload;
  if (isRecord(payload)) {
    const directPayloadMessage =
      optionalString(payload.last_agent_message) ??
      optionalString(payload.last_assistant_message) ??
      optionalString(payload.message);
    if (directPayloadMessage) {
      return directPayloadMessage;
    }
    if (payload.type === "message" && payload.role === "assistant") {
      return extractTextContent(payload.content);
    }
  }

  const message = entry.message;
  if (isRecord(message) && message.role === "assistant") {
    return extractTextContent(message.content);
  }

  if (entry.type === "assistant") {
    return extractTextContent(entry.content);
  }

  return undefined;
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content.flatMap((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    if (isRecord(item)) {
      const text = item.text;
      return typeof text === "string" ? text.trim() : [];
    }
    return [];
  });
  const joined = parts.filter((part) => part.length > 0).join("\n");
  return joined.length > 0 ? joined : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
