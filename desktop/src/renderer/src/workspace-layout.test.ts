import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = __dirname;

function readRendererFile(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function cssBlock(source: string, selector: string): string {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{(?<body>[^}]*)\\}`).exec(source);
  return match?.groups?.body ?? "";
}

describe("workspace layout", () => {
  it("does not render a redundant internal title bar", () => {
    const appSource = readRendererFile("App.tsx");
    const styles = readRendererFile("styles.css");

    expect(appSource).not.toContain('className="topbar"');
    expect(appSource).not.toContain("<h1>AgentHub</h1>");
    expect(appSource).not.toContain('className="topbar-actions"');
    expect(cssBlock(styles, ".topbar")).toBe("");
    expect(cssBlock(styles, ".brand-block")).toBe("");
  });

  it("keeps the workspace open action only in the workspace panel", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).toContain("打开/添加");
  });

  it("moves workspace actions into a row context menu", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).toContain("openWorkspaceContextMenu(event, workspace.path)");
    expect(appSource).toContain("refreshWorkspaceCard(contextMenuWorkspace.path)");
    expect(appSource).toContain("openWorkspaceLogs(contextMenuWorkspace.path)");
    expect(appSource).toContain("openWorkspaceFolder(contextMenuWorkspace.path)");
    expect(appSource).toContain("deleteWorkspace(contextMenuWorkspace.path)");
    expect(appSource).toContain("countOnlineSessionsForWorkspace(sessions, workspace.path)");
    expect(appSource).toContain('className="workspace-context-menu"');
    expect(appSource).not.toContain('className="workspace-actions"');
  });

  it("lets the full workspace row switch workspaces on left click", () => {
    const appSource = readRendererFile("App.tsx");
    const styles = readRendererFile("styles.css");

    expect(appSource).toMatch(
      /<article\s+className=\{`workspace-row[\s\S]*?onClick=\{\(\) => void activateWorkspace\(workspace\.path\)\}[\s\S]*?onContextMenu/,
    );
    expect(appSource).toContain('className="workspace-main"');
    expect(cssBlock(styles, ".workspace-row")).toContain("cursor: pointer");
  });

  it("lets the dashboard fill remaining height independent of optional banners", () => {
    const styles = readRendererFile("styles.css");
    const appShell = cssBlock(styles, ".app-shell");
    const dashboard = cssBlock(styles, ".dashboard-grid");

    expect(appShell).toContain("display: flex");
    expect(appShell).toContain("flex-direction: column");
    expect(appShell).not.toContain("grid-template-rows");
    expect(dashboard).toContain("flex: 1 1 auto");
    expect(cssBlock(styles, ".sidebar,\n.workspace-content,\n.center-stack")).toContain("height: 100%");
  });

  it("uses the main workspace tab strip for chat and agent terminals", () => {
    const appSource = readRendererFile("App.tsx");
    const styles = readRendererFile("styles.css");

    expect(appSource).toContain('className="workspace-content"');
    expect(appSource).toContain('className="workspace-main-tabs"');
    expect(appSource).toContain('mainTab === "conversation"');
    expect(appSource).toContain('setMainTab(`terminal:${session.sessionId}`)');
    expect(appSource).not.toContain('className="right-stack"');
    expect(appSource).not.toContain('className="terminal-dock panel"');

    expect(cssBlock(styles, ".dashboard-grid")).toContain("grid-template-columns: 330px minmax(0, 1fr)");
    expect(cssBlock(styles, ".workspace-content")).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(cssBlock(styles, ".workspace-tab-pane")).toContain("min-height: 0");
    expect(cssBlock(styles, ".workspace-terminal-pane")).toContain("grid-template-rows: auto minmax(0, 1fr)");
  });
});
