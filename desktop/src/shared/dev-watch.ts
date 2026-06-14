export type DevServerWatchOptions = {
  usePolling: true;
  interval: number;
  ignored: string[];
};

export function createDevServerWatchOptions(): DevServerWatchOptions {
  return {
    usePolling: true,
    interval: 500,
    ignored: ["**/.agenthub/**", "**/.agenthub-dev/**", "**/out/**", "**/node_modules/**"],
  };
}
