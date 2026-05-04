import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDefaultCliServices, runCli } from "../../src/index.js";
import { saveConfig } from "../../src/core/config-store.js";
import { saveDeploymentState, type TrackedDeployment } from "../../src/deploy/state.js";
import type { CliServices } from "../../src/cli/create-cli.js";
import type { ObserveCommandRunner } from "../../src/observe/service.js";

function createMemoryIo() {
  let stderr = "";
  let stdout = "";

  return {
    io: {
      stderr: (text: string) => {
        stderr += text;
      },
      stdout: (text: string) => {
        stdout += text;
      }
    },
    readStderr: () => stderr,
    readStdout: () => stdout
  };
}

function createTrackedDeployment(
  rootDir: string,
  name: string,
  overrides: Partial<TrackedDeployment> = {}
): TrackedDeployment {
  const target = overrides.target ?? "docker-compose";
  const workspacePath = path.join(rootDir, `${name}-workspace`);

  return {
    addons: [],
    certsDir: path.join(rootDir, `${name}-data`, "certs"),
    createdAt: "2026-03-20T00:00:00.000Z",
    dataDir: path.join(rootDir, `${name}-data`),
    deploymentRoot: workspacePath,
    gitCommit: "deadbeef",
    imageTag: "latest",
    logsDir: path.join(rootDir, `${name}-logs`),
    profileNames: [],
    ref: "main",
    registry: "docker.io/codehausau",
    repoUrl: "https://github.com/TAK-Product-Center/Server.git",
    target,
    ...(target === "docker-compose"
      ? {
          compose: {
            composeFilePath: path.join(workspacePath, "docker-compose.yml"),
            envFilePath: path.join(workspacePath, ".env")
          }
        }
      : {}),
    ...(target === "kubernetes"
      ? {
          kubernetes: {
            manifestPath: path.join(workspacePath, "tak.yml"),
            namespace: name
          }
        }
      : {}),
    ...overrides
  };
}

async function writeObserveFixture(
  deployment: TrackedDeployment,
  options: {
    configPath: string;
    currentProfile?: string;
    deploymentName: string;
  }
): Promise<void> {
  await mkdir(path.dirname(options.configPath), { recursive: true });
  await saveConfig(options.configPath, {
    currentProfile: options.currentProfile,
    profiles: {},
    schemaVersion: 1
  });
  await saveDeploymentState(path.join(path.dirname(options.configPath), "deployments.yaml"), {
    deployments: {
      [options.deploymentName]: deployment
    },
    schemaVersion: 1
  });
}

function createServices(runner: ObserveCommandRunner): CliServices {
  return {
    ...createDefaultCliServices(),
    observe: {
      pollIntervalMs: 10,
      runner
    }
  };
}

class MockObserveRunner implements ObserveCommandRunner {
  readonly runInvocations: string[] = [];
  readonly streamInvocations: string[] = [];

  constructor(
    private readonly handlers: {
      run?: (command: string, args: string[]) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
      stream?: (command: string, args: string[]) => AsyncIterable<string>;
    } = {}
  ) {}

  async run(command: string, args: string[]) {
    this.runInvocations.push([command, ...args].join(" "));
    if (this.handlers.run) {
      return await this.handlers.run(command, args);
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  }

  stream(command: string, args: string[]) {
    this.streamInvocations.push([command, ...args].join(" "));
    if (this.handlers.stream) {
      return this.handlers.stream(command, args);
    }
    return (async function* () {})();
  }
}

describe("observe command integration", () => {
  it("lists curated log targets for a tracked compose deployment", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "demo");

    await writeObserveFixture(deployment, {
      configPath,
      deploymentName: "demo"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(["observe", "logs", "list", "--config", configPath, "--json"], io.io);

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      deployment: { deploymentName: string };
      targets: Array<{ kind: string; name: string; source: string }>;
    };

    expect(output.deployment.deploymentName).toBe("demo");
    expect(output.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          name: "api",
          source: path.join(deployment.logsDir, "takserver-api.log")
        }),
        expect.objectContaining({
          kind: "service",
          name: "database"
        })
      ])
    );
  });

  it("reads recent lines from a tracked compose log file", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "demo");
    const logPath = path.join(deployment.logsDir, "takserver-api.log");

    await mkdir(deployment.logsDir, { recursive: true });
    await writeFile(logPath, "one\ntwo\nthree\n", "utf8");
    await writeObserveFixture(deployment, {
      configPath,
      deploymentName: "demo"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(
      ["observe", "logs", "api", "--config", configPath, "--lines", "2", "--json"],
      io.io
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      lines: string[];
      source: string;
      target: string;
    };

    expect(output.target).toBe("api");
    expect(output.source).toBe(logPath);
    expect(output.lines).toEqual(["two", "three"]);
  });

  it("rejects --json together with --follow", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "demo");

    await mkdir(deployment.logsDir, { recursive: true });
    await writeFile(path.join(deployment.logsDir, "takserver-api.log"), "one\n", "utf8");
    await writeObserveFixture(deployment, {
      configPath,
      deploymentName: "demo"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(
      ["observe", "logs", "api", "--config", configPath, "--json", "--follow"],
      io.io
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("does not support `--json` together with `--follow`");
  });

  it("reads compose database logs through docker compose", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "demo");
    const runner = new MockObserveRunner({
      run: async (command, args) => {
        if (command === "docker" && args[0] === "compose") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "db-one\ndb-two\n"
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    await writeObserveFixture(deployment, {
      configPath,
      deploymentName: "demo"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(
      ["observe", "logs", "database", "--config", configPath, "--json"],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      lines: string[];
      source: string;
    };

    expect(output.lines).toEqual(["db-one", "db-two"]);
    expect(output.source).toContain("docker compose service tak-database");
    expect(runner.runInvocations[0]).toContain("docker compose");
  });

  it("streams kubernetes messaging logs in follow mode", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "cluster", {
      profileNames: ["cluster-admin"],
      target: "kubernetes",
      kubernetes: {
        manifestPath: path.join(baseDir, "cluster-workspace", "tak.yml"),
        namespace: "demo-cluster"
      }
    });
    const runner = new MockObserveRunner({
      run: async (command, args) => {
        if (command === "kubectl" && args[0] === "exec") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "preflight\n"
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      stream: (command, args) => {
        if (command !== "kubectl" || args[0] !== "exec") {
          throw new Error(`Unexpected stream command: ${command} ${args.join(" ")}`);
        }

        return (async function* () {
          yield "line-one\n";
          yield "line-two\n";
        })();
      }
    });

    await writeObserveFixture(deployment, {
      configPath,
      currentProfile: "cluster-admin",
      deploymentName: "cluster"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(
      ["observe", "logs", "messaging", "--config", configPath, "--follow"],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    expect(io.readStdout()).toContain("TAKCLI observe logs");
    expect(io.readStdout()).toContain("Mode: follow");
    expect(io.readStdout()).toContain("line-one");
    expect(io.readStdout()).toContain("line-two");
    expect(runner.runInvocations[0]).toContain("kubectl exec");
    expect(runner.streamInvocations[0]).toContain("kubectl exec");
  });

  it("falls back to takserver deployment logs when kubernetes file logs are absent", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-observe-"));
    const configPath = path.join(baseDir, "config.yaml");
    const deployment = createTrackedDeployment(baseDir, "cluster", {
      target: "kubernetes",
      kubernetes: {
        manifestPath: path.join(baseDir, "cluster-workspace", "tak.yml"),
        namespace: "demo-cluster"
      }
    });
    const runner = new MockObserveRunner({
      run: async (command, args) => {
        if (command !== "kubectl") {
          throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        }

        if (args[0] === "exec") {
          return {
            exitCode: 44,
            stderr: "",
            stdout: ""
          };
        }

        if (args[0] === "logs" && args[1] === "deployment/takserver") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "server-one\nserver-two\n"
          };
        }

        throw new Error(`Unexpected kubectl args: ${args.join(" ")}`);
      }
    });

    await writeObserveFixture(deployment, {
      configPath,
      deploymentName: "cluster"
    });

    const io = createMemoryIo();
    const exitCode = await runCli(
      ["observe", "logs", "api", "--config", configPath, "--deployment", "cluster", "--json"],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      lines: string[];
      source: string;
      target: string;
    };

    expect(output.target).toBe("api");
    expect(output.lines).toEqual(["server-one", "server-two"]);
    expect(output.source).toContain("kubectl logs deployment/takserver -n demo-cluster");
    expect(output.source).toContain("fallback for api");
  });
});
