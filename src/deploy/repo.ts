import os from "node:os";
import path from "node:path";

export function getDefaultDeploymentRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".takcli", "deployments");
}
