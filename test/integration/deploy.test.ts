import os from "node:os";
import path from "node:path";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/index.js";
import type { CliServices } from "../../src/cli/create-cli.js";
import type { CommandRunner, DeployPrompt } from "../../src/deploy/types.js";

const execFileAsync = promisify(execFile);

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

const unusedPrompt: DeployPrompt = {
  async confirm() {
    throw new Error("prompt.confirm should not be called");
  },
  async input() {
    throw new Error("prompt.input should not be called");
  },
  async select() {
    throw new Error("prompt.select should not be called");
  }
};

class HybridRunner implements CommandRunner {
  readonly invocations: string[] = [];

  async run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ) {
    this.invocations.push([command, ...args].join(" "));

    if (command === "docker" && args[0] === "--version") {
      return { exitCode: 0, stderr: "", stdout: "Docker version 26.0.0\n" };
    }
    if (command === "docker" && args[0] === "compose" && args[1] === "version") {
      return { exitCode: 0, stderr: "", stdout: "Docker Compose version v2.0.0\n" };
    }
    if (command === "docker" && args[0] === "compose") {
      return { exitCode: 0, stderr: "", stdout: "started\n" };
    }

    try {
      const result = await execFileAsync(command, args, {
        cwd: options?.cwd,
        env: options?.env
      });
      return { exitCode: 0, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
    } catch (error) {
      const failure = error as {
        code?: number;
        stderr?: string;
        stdout?: string;
      };
      return {
        exitCode: failure.code ?? 1,
        stderr: failure.stderr ?? "",
        stdout: failure.stdout ?? ""
      };
    }
  }
}

class MissingComposeRunner implements CommandRunner {
  async run(command: string, args: string[]) {
    if (command === "git") {
      return { exitCode: 0, stderr: "", stdout: "git version 2.0.0\n" };
    }
    if (command === "docker" && args[0] === "--version") {
      return { exitCode: 0, stderr: "", stdout: "Docker version 26.0.0\n" };
    }
    return { exitCode: 1, stderr: "missing", stdout: "" };
  }
}

async function createFakeTakServerRepo(): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-repo-"));
  const composeDir = path.join(repoDir, "src", "takserver-core", "docker", "full");
  await mkdir(composeDir, { recursive: true });
  await writeFile(
    path.join(composeDir, "docker-compose.yml"),
    "version: '3.4'\nservices:\n  takserver:\n    image: takserver:latest\n",
    "utf8"
  );
  await writeFile(path.join(composeDir, "EDIT_ME.env"), "POSTGRES_PASSWORD=\n", "utf8");
  await execFileAsync("git", ["init"], { cwd: repoDir });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "TAKCLI Test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "takcli@example.invalid"], { cwd: repoDir });
  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });
  return repoDir;
}

function createServices(runner: CommandRunner): CliServices {
  return {
    deploy: {
      prompt: unusedPrompt,
      runner
    }
  };
}

class RecordingPrompt implements DeployPrompt {
  readonly inputCalls: Array<{ message: string; secret?: boolean }> = [];

  async confirm() {
    return true;
  }

  async input(options: { defaultValue?: string; message: string; secret?: boolean }) {
    this.inputCalls.push({ message: options.message, secret: options.secret });

    const defaults: Record<string, string> = {
      "Admin certificate password": "admin-pass",
      "Admin certificate name": "admin",
      "Certificate authority name": "PromptCA",
      "Certificate authority password": "ca-pass",
      "Certificate city/locality": "Canberra",
      "Certificate organization": "CodeHaus",
      "Certificate organizational unit": "Ops",
      "Certificate state/province": "ACT",
      "Deployment data directory": "/tmp/takcli-prompt-data",
      "Deployment name": "prompt-demo",
      "Deployment workspace path": "/tmp/takcli-prompt-workspace",
      "Docker image registry namespace": "docker.io/codehausau",
      "Docker image tag": "main",
      "Postgres password": "postgres-pass",
      "TAK Server certificate password": "tak-pass",
      "TAK Server git ref": "main",
      "TAK certs directory": "/tmp/takcli-prompt-data/certs",
      "TAK logs directory": "/tmp/takcli-prompt-data/logs"
    };

    return defaults[options.message] ?? options.defaultValue ?? "value";
  }

  async select() {
    return "docker-compose";
  }
}

describe("deploy integration", () => {
  it("reports missing docker compose with guidance", async () => {
    const io = createMemoryIo();

    const exitCode = await runCli(
      ["deploy", "--target", "docker-compose"],
      io.io,
      createServices(new MissingComposeRunner())
    );

    expect(exitCode).toBe(1);
    expect(io.readStdout()).toContain("Missing dependencies");
    expect(io.readStdout()).toContain("docker compose");
    expect(io.readStderr()).toContain("Required deploy dependencies are missing.");
  });

  it("prepares an unhardened compose workspace from an official repo clone", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-workspace-"));
    const dataDir = path.join(deploymentRoot, "data");
    const logsDir = path.join(dataDir, "logs");
    const certsDir = path.join(dataDir, "certs");
    const runner = new HybridRunner();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "docker-compose",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        dataDir,
        "--logs-dir",
        logsDir,
        "--certs-dir",
        certsDir,
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "main",
        "--postgres-password",
        "postgres-pass",
        "--ca-name",
        "DemoCA",
        "--ca-pass",
        "ca-pass",
        "--state",
        "ACT",
        "--city",
        "Canberra",
        "--organization",
        "CodeHaus",
        "--organizational-unit",
        "Ops",
        "--takserver-cert-pass",
        "tak-pass",
        "--admin-cert-name",
        "admin",
        "--admin-cert-pass",
        "admin-pass",
        "--yes",
        "--dry-run",
        "--json"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      clonePath: string;
      compose: {
        composeFilePath: string;
        images: { db: string; server: string };
      };
      target: string;
    };

    expect(output.target).toBe("docker-compose");
    expect(output.compose.images.server).toBe("docker.io/codehausau/takserver-full:main");
    expect(output.compose.images.db).toBe("postgis/postgis:15-3.3");
    await access(output.compose.composeFilePath);

    const composeFile = await readFile(output.compose.composeFilePath, "utf8");
    expect(composeFile).toContain("docker.io/codehausau/takserver-full:main");
    expect(composeFile).toContain("postgis/postgis:15-3.3");

    const envStats = await stat(path.join(deploymentRoot, ".env"));
    expect(envStats.mode & 0o777).toBe(0o600);
  });

  it("rejects certificate passwords shorter than six characters before cloning", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-workspace-"));
    const dataDir = path.join(deploymentRoot, "data");
    const logsDir = path.join(dataDir, "logs");
    const certsDir = path.join(dataDir, "certs");
    const runner = new HybridRunner();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "docker-compose",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        dataDir,
        "--logs-dir",
        logsDir,
        "--certs-dir",
        certsDir,
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "main",
        "--postgres-password",
        "postgres-pass",
        "--ca-name",
        "DemoCA",
        "--ca-pass",
        "short",
        "--state",
        "ACT",
        "--city",
        "Canberra",
        "--organization",
        "CodeHaus",
        "--organizational-unit",
        "Ops",
        "--takserver-cert-pass",
        "tak-pass",
        "--admin-cert-name",
        "admin",
        "--admin-cert-pass",
        "admin-pass",
        "--yes",
        "--dry-run"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("Certificate authority password must be at least 6 characters");
    expect(runner.invocations.some((invocation) => invocation.startsWith("git clone "))).toBe(false);
  });

  it("marks sensitive deploy prompts as secret input", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-workspace-"));
    const dataDir = path.join(deploymentRoot, "data");
    const logsDir = path.join(dataDir, "logs");
    const certsDir = path.join(dataDir, "certs");
    const runner = new HybridRunner();
    const prompt = new RecordingPrompt();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "docker-compose",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        dataDir,
        "--logs-dir",
        logsDir,
        "--certs-dir",
        certsDir,
        "--yes",
        "--dry-run"
      ],
      io.io,
      {
        deploy: {
          prompt,
          runner
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(prompt.inputCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Postgres password", secret: true }),
        expect.objectContaining({ message: "Certificate authority password", secret: true }),
        expect.objectContaining({ message: "TAK Server certificate password", secret: true }),
        expect.objectContaining({ message: "Admin certificate password", secret: true })
      ])
    );
  });

  it("reuses an existing clone cache for repeat deploys", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-first-"));
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-second-"));
    const runner = new HybridRunner();

    const commonArgs = [
      "deploy",
      "--target",
      "docker-compose",
      "--ref",
      "main",
      "--repo-url",
      repoDir,
      "--cache-root",
      cacheRoot,
      "--registry",
      "docker.io/codehausau",
      "--image-tag",
      "main",
      "--postgres-password",
      "postgres-pass",
      "--ca-name",
      "DemoCA",
      "--ca-pass",
      "ca-pass",
      "--state",
      "ACT",
      "--city",
      "Canberra",
      "--organization",
      "CodeHaus",
      "--organizational-unit",
      "Ops",
      "--takserver-cert-pass",
      "tak-pass",
      "--admin-cert-name",
      "admin",
      "--admin-cert-pass",
      "admin-pass",
      "--yes",
      "--dry-run"
    ];

    let exitCode = await runCli(
      [
        ...commonArgs,
        "--name",
        "first",
        "--deployment-root",
        firstRoot,
        "--data-dir",
        path.join(firstRoot, "data"),
        "--logs-dir",
        path.join(firstRoot, "data", "logs"),
        "--certs-dir",
        path.join(firstRoot, "data", "certs")
      ],
      createMemoryIo().io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);

    exitCode = await runCli(
      [
        ...commonArgs,
        "--name",
        "second",
        "--deployment-root",
        secondRoot,
        "--data-dir",
        path.join(secondRoot, "data"),
        "--logs-dir",
        path.join(secondRoot, "data", "logs"),
        "--certs-dir",
        path.join(secondRoot, "data", "certs")
      ],
      createMemoryIo().io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    expect(runner.invocations.filter((invocation) => invocation.startsWith("git clone "))).toHaveLength(1);
  });
});
