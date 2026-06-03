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

describe("chat layout", () => {
  it("uses a multiline textarea for the chat composer", () => {
    const appSource = readRendererFile("App.tsx");
    const styles = readRendererFile("styles.css");

    expect(appSource).toContain('<textarea\n                className="composer-input"');
    expect(appSource).toContain("resizeComposerInput");
    expect(cssBlock(styles, ".composer-row textarea")).toContain("flex: 1 1 260px");
  });

  it("renders a compact composer shortcut selector", () => {
    const appSource = readRendererFile("App.tsx");
    const styles = readRendererFile("styles.css");

    expect(appSource).toContain('className="composer-shortcut-select"');
    expect(appSource).toContain('value="ctrlEnter"');
    expect(cssBlock(styles, ".composer-shortcut-select")).toContain("flex: 0 0 auto");
  });

  it("pins user messages to the right and non-user messages to the left responsively", () => {
    const styles = readRendererFile("styles.css");

    expect(cssBlock(styles, ".chat-list")).toContain("display: flex");
    expect(cssBlock(styles, ".chat-list")).toContain("flex-direction: column");
    expect(cssBlock(styles, ".chat-message")).toContain("width: 100%");
    expect(cssBlock(styles, ".chat-message-user")).toContain("justify-content: flex-end");
    expect(cssBlock(styles, ".chat-message-user")).toContain("padding-left: clamp");
    expect(cssBlock(styles, ".chat-message-agent,\n.chat-message-system,\n.chat-message-error")).toContain(
      "justify-content: flex-start",
    );
    expect(cssBlock(styles, ".chat-message-agent,\n.chat-message-system,\n.chat-message-error")).toContain(
      "padding-right: clamp",
    );
    expect(cssBlock(styles, ".chat-bubble")).toContain("max-width: min");
  });
});
