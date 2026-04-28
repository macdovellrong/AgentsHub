export type ElectronSandboxEnvironment = {
  isPackaged: boolean;
  nodeEnv?: string;
  noSandbox?: string;
};

export function shouldDisableElectronSandbox(environment: ElectronSandboxEnvironment): boolean {
  if (environment.isPackaged) {
    return false;
  }

  return environment.noSandbox === "1" || environment.nodeEnv === "development";
}
