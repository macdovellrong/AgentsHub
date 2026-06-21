import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type AgentTranscriptEvent =
  | {
      type: "session_started";
      sessionId: string;
      profileId: string;
      hostKind?: string;
    }
  | {
      type: "session_exited";
      sessionId: string;
      profileId: string;
      exitCode: number | null;
    }
  | {
      type: "terminal_input";
      sessionId: string;
      profileId: string;
      bytes: number;
    }
  | {
      type: "terminal_output";
      sessionId: string;
      profileId: string;
      bytes: number;
      preview?: string;
      alternateBuffer?: boolean;
    };

type StoredAgentTranscriptEvent = AgentTranscriptEvent & {
  timestamp: string;
};

export class AgentTranscriptStore {
  private readonly appendQueues = new Map<string, Promise<void>>();

  async append(workspacePath: string, runId: string, event: AgentTranscriptEvent): Promise<string> {
    const transcriptPath = this.resolveTranscriptPath(workspacePath, runId);
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    const storedEvent: StoredAgentTranscriptEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    const previous = this.appendQueues.get(transcriptPath) ?? Promise.resolve();
    const next = previous.then(() => appendFile(transcriptPath, `${JSON.stringify(storedEvent)}\n`, "utf8"));
    this.appendQueues.set(
      transcriptPath,
      next.catch(() => {
        // Later transcript writes should not be permanently blocked by one failed append.
      }),
    );
    await next;
    return transcriptPath;
  }

  resolveTranscriptPath(workspacePath: string, runId: string): string {
    return path.join(workspacePath, ".agenthub", "runs", runId, "transcript.jsonl");
  }
}
