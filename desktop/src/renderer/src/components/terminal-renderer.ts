export type TerminalRendererMode = "canvas" | "webgl";

export function resolveTerminalRendererMode(value: string | undefined): TerminalRendererMode {
  return value === "webgl" ? "webgl" : "canvas";
}
