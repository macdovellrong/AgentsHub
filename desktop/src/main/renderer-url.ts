export type RendererUrlEnvironment = {
  isPackaged: boolean;
  nodeEnv?: string;
};

const trustedLocalHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getAllowedDevRendererUrl(
  rendererUrl: string | undefined,
  environment: RendererUrlEnvironment,
): string | null {
  if (!rendererUrl || environment.isPackaged || environment.nodeEnv !== "development") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rendererUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" || !parsed.port || parsed.username || parsed.password) {
    return null;
  }

  return trustedLocalHosts.has(parsed.hostname) ? parsed.toString() : null;
}
