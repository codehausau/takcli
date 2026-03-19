import process from "node:process";

import type { CommandRunner, DependencyCheckResult, DependencyStatus, DeployTarget } from "./types.js";

const dependencyHints = {
  docker: {
    darwin: "Install Docker Desktop for macOS: https://docs.docker.com/desktop/setup/install/mac-install/",
    linux: "Install Docker Engine for Linux: https://docs.docker.com/engine/install/",
    win32: "Install Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/",
    default: "Install Docker Engine or Docker Desktop: https://docs.docker.com/get-started/get-docker/"
  },
  "docker compose": {
    darwin: "Install Docker Compose v2 via Docker Desktop: https://docs.docker.com/compose/install/",
    linux: "Install Docker Compose v2: https://docs.docker.com/compose/install/linux/",
    win32: "Install Docker Compose v2 via Docker Desktop: https://docs.docker.com/compose/install/",
    default: "Install Docker Compose v2: https://docs.docker.com/compose/install/"
  },
  git: {
    darwin: "Install Git from https://git-scm.com/download/mac or with Homebrew.",
    linux: "Install Git from https://git-scm.com/download/linux or your distro package manager.",
    win32: "Install Git for Windows: https://git-scm.com/download/win",
    default: "Install Git from https://git-scm.com/downloads"
  },
  kubectl: {
    darwin: "Install kubectl: https://kubernetes.io/docs/tasks/tools/",
    linux: "Install kubectl: https://kubernetes.io/docs/tasks/tools/",
    win32: "Install kubectl: https://kubernetes.io/docs/tasks/tools/",
    default: "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
  }
} as const;

function getDependencyHint(name: keyof typeof dependencyHints): string {
  const entry = dependencyHints[name];
  return entry[process.platform as keyof typeof entry] ?? entry.default;
}

async function probeCommand(
  runner: CommandRunner,
  name: DependencyStatus["name"],
  command: string,
  args: string[]
): Promise<DependencyStatus> {
  try {
    const result = await runner.run(command, args);
    return {
      available: result.exitCode === 0,
      hint: getDependencyHint(name as keyof typeof dependencyHints),
      name
    };
  } catch {
    return {
      available: false,
      hint: getDependencyHint(name as keyof typeof dependencyHints),
      name
    };
  }
}

export async function checkDeployDependencies(
  runner: CommandRunner,
  target: DeployTarget
): Promise<DependencyCheckResult> {
  const statuses: DependencyStatus[] = [];
  statuses.push(await probeCommand(runner, "git", "git", ["--version"]));

  if (target === "docker-compose") {
    statuses.push(await probeCommand(runner, "docker", "docker", ["--version"]));
    statuses.push(await probeCommand(runner, "docker compose", "docker", ["compose", "version"]));
  } else {
    statuses.push(await probeCommand(runner, "kubectl", "kubectl", ["version", "--client"]));
  }

  return {
    missing: statuses.filter((status) => !status.available),
    statuses
  };
}
