import { generateKeyPairSync } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/index.js";
import type { CliServices } from "../../src/cli/create-cli.js";
import { CliError } from "../../src/cli/runtime.js";
import { loadConfig } from "../../src/core/config-store.js";
import { loadDeploymentState } from "../../src/deploy/state.js";
import type { CommandRunner, DeployPrompt, DeployPromptChoice } from "../../src/deploy/types.js";
import { createDefaultObserveServices } from "../../src/observe/service.js";

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
    if (command === "kubectl" && args[0] === "version") {
      return { exitCode: 0, stderr: "", stdout: "Client Version: v1.30.0\n" };
    }
    if (command === "kubectl" && args[0] === "apply") {
      return { exitCode: 0, stderr: "", stdout: "manifest applied\n" };
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

class MissingKubectlRunner implements CommandRunner {
  async run(command: string, args: string[]) {
    if (command === "git") {
      return { exitCode: 0, stderr: "", stdout: "git version 2.0.0\n" };
    }
    if (command === "kubectl" && args[0] === "version") {
      return { exitCode: 1, stderr: "missing", stdout: "" };
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
    },
    observe: createDefaultObserveServices()
  };
}

function createServicesWithPrompt(prompt: DeployPrompt, runner: CommandRunner): CliServices {
  return {
    deploy: {
      prompt,
      runner
    },
    observe: createDefaultObserveServices()
  };
}

class RecordingPrompt implements DeployPrompt {
  readonly confirmCalls: string[] = [];
  readonly inputCalls: Array<{ message: string; secret?: boolean }> = [];
  readonly selectCalls: string[] = [];

  constructor(
    private readonly options: {
      adsbEnabled?: boolean;
      adsbSource?: "geo" | "mil";
    } = {}
  ) {}

  async confirm(options: { defaultValue?: boolean; message: string }) {
    this.confirmCalls.push(options.message);
    if (options.message === "Enable the ADS-B gateway sidecar?") {
      return this.options.adsbEnabled ?? false;
    }
    return true;
  }

  async input(options: { defaultValue?: string; message: string; secret?: boolean }) {
    this.inputCalls.push({ message: options.message, secret: options.secret });

    const defaults: Record<string, string> = {
      "Admin certificate password": "admin-pass",
      "ADS-B distance": "25",
      "ADS-B latitude": "60.3179",
      "ADS-B longitude": "24.9496",
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
      "Docker image tag": "latest",
      "Initial WebTAK password": "Str0ng!Bootstrap",
      "Initial WebTAK username": "admin",
      "Postgres password": "postgres-pass",
      "TAK Server certificate password": "tak-pass",
      "TAK Server git ref": "main",
      "TAK certs directory": "/tmp/takcli-prompt-data/certs",
      "TAK logs directory": "/tmp/takcli-prompt-data/logs"
    };

    return defaults[options.message] ?? options.defaultValue ?? "value";
  }

  async select(options: {
    choices: DeployPromptChoice[];
    defaultValue?: string;
    message: string;
  }) {
    this.selectCalls.push(options.message);
    if (options.message === "Choose an ADS-B source profile") {
      return this.options.adsbSource ?? "mil";
    }
    return "docker-compose";
  }
}

class DefaultingPrompt implements DeployPrompt {
  async confirm(options: { defaultValue?: boolean; message: string }) {
    if (options.message === "Enable the ADS-B gateway sidecar?") {
      return false;
    }
    return true;
  }

  async input(options: { defaultValue?: string; message: string; secret?: boolean }) {
    return options.defaultValue ?? "value";
  }

  async select() {
    return "kubernetes";
  }
}

class RetryingPrompt implements DeployPrompt {
  readonly inputCalls: Array<{ message: string; secret?: boolean }> = [];

  private readonly confirms: boolean[];
  private readonly adsbConfirms: boolean[];
  private readonly selects: Record<string, string[]>;
  private readonly values: Record<string, string[]>;

  constructor(options?: {
    adsbConfirms?: boolean[];
    confirms?: boolean[];
    selects?: Record<string, string[]>;
    values?: Record<string, string[]>;
  }) {
    this.confirms = options?.confirms ? [...options.confirms] : [false, true];
    this.adsbConfirms = options?.adsbConfirms ? [...options.adsbConfirms] : [];
    this.selects = {
      ...(options?.selects ?? {})
    };
    this.values = {
      "Admin certificate password": ["admin-pass"],
      "ADS-B distance": ["25"],
      "ADS-B latitude": ["60.3179"],
      "ADS-B longitude": ["24.9496"],
      "Admin certificate name": ["admin"],
      "Certificate authority name": ["PromptCA"],
      "Certificate authority password": ["short", "ca-pass"],
      "Certificate city/locality": ["Canberra"],
      "Certificate organization": ["CodeHaus"],
      "Certificate organizational unit": ["Ops"],
      "Certificate state/province": ["ACT"],
      "Deployment data directory": ["/tmp/takcli-retry-data"],
      "Deployment name": ["retry-demo"],
      "Deployment workspace path": ["/tmp/takcli-retry-workspace"],
      "Docker image registry namespace": ["docker.io/codehausau"],
      "Docker image tag": ["latest"],
      "Initial WebTAK password": ["Str0ng!Bootstrap"],
      "Initial WebTAK username": ["admin"],
      "Postgres password": ["postgres-pass"],
      "TAK Server certificate password": ["tak-pass"],
      "TAK Server git ref": ["main"],
      "TAK certs directory": ["/tmp/takcli-retry-data/certs"],
      "TAK logs directory": ["/tmp/takcli-retry-data/logs"],
      ...(options?.values ?? {})
    };
  }

  async confirm(options: { defaultValue?: boolean; message: string }) {
    if (options.message === "Enable the ADS-B gateway sidecar?") {
      return this.adsbConfirms.shift() ?? false;
    }
    return this.confirms.shift() ?? true;
  }

  async input(options: { defaultValue?: string; message: string; secret?: boolean }) {
    this.inputCalls.push({ message: options.message, secret: options.secret });
    const values = this.values[options.message];
    if (values && values.length > 0) {
      const value = values.shift() as string;
      if (!value && options.defaultValue === undefined) {
        throw new CliError(`A value is required for "${options.message}".`);
      }
      return value;
    }

    return options.defaultValue ?? "value";
  }

  async select(options: { choices: DeployPromptChoice[]; defaultValue?: string; message: string }) {
    const values = this.selects[options.message];
    if (values && values.length > 0) {
      return values.shift() as string;
    }
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

  it("reports missing kubectl with guidance", async () => {
    const io = createMemoryIo();

    const exitCode = await runCli(
      ["deploy", "--target", "kubernetes"],
      io.io,
      createServices(new MissingKubectlRunner())
    );

    expect(exitCode).toBe(1);
    expect(io.readStdout()).toContain("Missing dependencies");
    expect(io.readStdout()).toContain("kubectl");
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
    expect(output.compose.images.db).toBe("kartoza/postgis:15-3.4");
    await access(output.compose.composeFilePath);

    const composeFile = await readFile(output.compose.composeFilePath, "utf8");
    expect(composeFile).toContain("docker.io/codehausau/takserver-full:main");
    expect(composeFile).toContain("kartoza/postgis:15-3.4");

    const envStats = await stat(path.join(deploymentRoot, ".env"));
    expect(envStats.mode & 0o777).toBe(0o600);
  });

  it("renders ADS-B gateway assets when requested for a compose deployment", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-adsb-"));
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
        "demo-adsb",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
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
        "--with-adsb",
        "--adsb-feed-url",
        "https://example.invalid/adsb-feed",
        "--yes",
        "--dry-run",
        "--json"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);

    const composeFile = await readFile(path.join(deploymentRoot, "docker-compose.yml"), "utf8");
    expect(composeFile).toContain("tak-adsb-gateway:");
    expect(composeFile).toContain("context: ./ads-b");
    expect(composeFile).toContain("depends_on:");
    expect(composeFile).toContain("- takserver");

    const adsbDockerfile = await readFile(path.join(deploymentRoot, "ads-b", "Dockerfile"), "utf8");
    expect(adsbDockerfile).toContain("FROM python:3.11-slim");
    expect(adsbDockerfile).toContain("adsbcot[with_pymodes]");

    const adsbConfig = await readFile(path.join(deploymentRoot, "ads-b", "adsbcot.ini"), "utf8");
    expect(adsbConfig).toContain("FEED_URL = https://example.invalid/adsb-feed");
    expect(adsbConfig).toContain("PYTAK_TLS_CLIENT_CERT = /etc/adsbcot/certs/admin.pem");
    expect(adsbConfig).toContain("PYTAK_TLS_CLIENT_CAFILE = /etc/adsbcot/certs/root-ca.pem");
    expect(adsbConfig).toContain("Acceptable use summary for adsb.fi public endpoints");

    const adsbConfigStats = await stat(path.join(deploymentRoot, "ads-b", "adsbcot.ini"));
    expect(adsbConfigStats.mode & 0o777).toBe(0o600);
  });

  it("allows overriding the database image for a compose deployment", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-db-image-"));
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
        "demo-db-image",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "main",
        "--db-image",
        "example/postgis:custom",
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
      compose: {
        composeFilePath: string;
        images: { db: string };
      };
    };

    expect(output.compose.images.db).toBe("example/postgis:custom");
    const composeFile = await readFile(output.compose.composeFilePath, "utf8");
    expect(composeFile).toContain("example/postgis:custom");
  });

  it("builds a geographic adsb.fi v3 feed URL when ADS-B geo mode is selected", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-adsb-geo-"));
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
        "demo-adsb-geo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
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
        "--with-adsb",
        "--adsb-source",
        "geo",
        "--adsb-lat",
        "60.3179",
        "--adsb-lon",
        "24.9496",
        "--adsb-dist-nm",
        "25",
        "--yes",
        "--dry-run",
        "--json"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);

    const adsbConfig = await readFile(path.join(deploymentRoot, "ads-b", "adsbcot.ini"), "utf8");
    expect(adsbConfig).toContain("Source profile: geographic area centered at 60.3179, 24.9496 within 25 NM.");
    expect(adsbConfig).toContain("FEED_URL = https://opendata.adsb.fi/api/v3/lat/60.3179/lon/24.9496/dist/25");
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

  it("rejects weak initial WebTAK passwords before cloning", async () => {
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
        "--webtak-username",
        "admin",
        "--webtak-password",
        "short",
        "--yes",
        "--dry-run"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("Initial WebTAK password must be at least 15 characters");
    expect(runner.invocations.some((invocation) => invocation.startsWith("git clone "))).toBe(false);
  });

  it("rejects WebTAK bootstrap flags for kubernetes deployments", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-workspace-"));
    const runner = new HybridRunner();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "kubernetes",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "demo-k8s",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
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
        "--webtak-username",
        "admin",
        "--webtak-password",
        "Str0ng!Bootstrap",
        "--yes",
        "--dry-run"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("only supported for docker-compose deployments");
  });

  it("defaults the main ref to the latest image tag", async () => {
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
        "kubernetes",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "default-tag",
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
      createServicesWithPrompt(new DefaultingPrompt(), runner)
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      imageTag: string;
      kubernetes: {
        images: { server: string };
      };
    };

    expect(output.imageTag).toBe("latest");
    expect(output.kubernetes.images.server).toBe("docker.io/codehausau/takserver-full:latest");
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
      createServicesWithPrompt(prompt, runner)
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

  it("prompts for an initial WebTAK user during interactive compose deploys", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-prompt-webtak-"));
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
        "--dry-run"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(prompt.inputCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Initial WebTAK username" }),
        expect.objectContaining({ message: "Initial WebTAK password", secret: true })
      ])
    );
  });

  it("can enable ADS-B interactively and prompt for geographic source details", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-prompt-adsb-"));
    const dataDir = path.join(deploymentRoot, "data");
    const logsDir = path.join(dataDir, "logs");
    const certsDir = path.join(dataDir, "certs");
    const runner = new HybridRunner();
    const prompt = new RecordingPrompt({
      adsbEnabled: true,
      adsbSource: "geo"
    });
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
        "prompt-adsb",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        dataDir,
        "--logs-dir",
        logsDir,
        "--certs-dir",
        certsDir,
        "--dry-run"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(prompt.confirmCalls).toContain("Enable the ADS-B gateway sidecar?");
    expect(prompt.selectCalls).toContain("Choose an ADS-B source profile");
    expect(prompt.inputCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "ADS-B latitude" }),
        expect.objectContaining({ message: "ADS-B longitude" }),
        expect.objectContaining({ message: "ADS-B distance" })
      ])
    );

    const adsbConfig = await readFile(path.join(deploymentRoot, "ads-b", "adsbcot.ini"), "utf8");
    expect(adsbConfig).toContain("FEED_URL = https://opendata.adsb.fi/api/v3/lat/60.3179/lon/24.9496/dist/25");
  });

  it("re-prompts certificate passwords after validation failures", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-retry-workspace-"));
    const prompt = new RetryingPrompt();
    const runner = new HybridRunner();
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
        "retry-demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--dry-run"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(io.readStderr()).toContain("Certificate authority password must be at least 6 characters");
    expect(prompt.inputCalls.filter((call) => call.message === "Certificate authority password")).toHaveLength(2);
  });

  it("re-prompts empty password entries instead of exiting", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-empty-retry-workspace-"));
    const prompt = new RetryingPrompt({
      values: {
        "Certificate authority password": ["", "ca-pass"]
      }
    });
    const runner = new HybridRunner();
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
        "empty-retry-demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--dry-run"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(io.readStderr()).toContain('A value is required for "Certificate authority password".');
    expect(prompt.inputCalls.filter((call) => call.message === "Certificate authority password")).toHaveLength(2);
  });

  it("re-prompts the initial WebTAK password after validation failures", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-webtak-retry-"));
    const prompt = new RetryingPrompt({
      confirms: [true, true],
      values: {
        "Certificate authority password": ["ca-pass"],
        "Initial WebTAK password": ["short", "Str0ng!Bootstrap"]
      }
    });
    const runner = new HybridRunner();
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
        "webtak-retry-demo",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--dry-run"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(io.readStderr()).toContain("Initial WebTAK password must be at least 15 characters");
    expect(prompt.inputCalls.filter((call) => call.message === "Initial WebTAK password")).toHaveLength(2);
  });

  it("defaults the prompted image tag to latest when the ref is main", async () => {
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
        "--dry-run",
        "--json"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);
    expect(prompt.inputCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Docker image tag" })
      ])
    );

    const output = JSON.parse(io.readStdout()) as {
      compose: {
        images: { server: string };
      };
    };
    expect(output.compose.images.server).toBe("docker.io/codehausau/takserver-full:latest");
  });

  it("prepares a Kubernetes workspace from an official repo clone", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-k8s-workspace-"));
    const dataDir = path.join(deploymentRoot, "data");
    const logsDir = path.join(dataDir, "logs");
    const certsDir = path.join(dataDir, "certs");
    const runner = new HybridRunner();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "kubernetes",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "demo-k8s",
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
      kubernetes: {
        images: { db: string; server: string };
        manifestPath: string;
        namespace: string;
      };
      target: string;
    };

    expect(output.target).toBe("kubernetes");
    expect(output.kubernetes.images.server).toBe("docker.io/codehausau/takserver-full:main");
    expect(output.kubernetes.images.db).toBe("kartoza/postgis:15-3.4");
    expect(output.kubernetes.namespace).toBe("demo-k8s");
    await access(output.kubernetes.manifestPath);

    const manifest = await readFile(output.kubernetes.manifestPath, "utf8");
    expect(manifest).toContain("docker.io/codehausau/takserver-full:main");
    expect(manifest).toContain("kind: Namespace");
    expect(manifest).toContain("type: LoadBalancer");
  });

  it("applies Kubernetes manifests when dry-run is disabled", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-k8s-apply-"));
    const runner = new HybridRunner();

    const exitCode = await runCli(
      [
        "deploy",
        "--target",
        "kubernetes",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "apply-k8s",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
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
        "--yes"
      ],
      createMemoryIo().io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    expect(runner.invocations.some((invocation) => invocation.startsWith("kubectl apply -f "))).toBe(true);
  });

  it("bootstraps an initial WebTAK user after compose startup when requested", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-apply-"));
    const runner = new HybridRunner();

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
        "apply-compose",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "latest",
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
        "--webtak-username",
        "admin",
        "--webtak-password",
        "Str0ng!Bootstrap",
        "--yes"
      ],
      createMemoryIo().io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    expect(
      runner.invocations.some((invocation) =>
        invocation.includes("docker compose") &&
        invocation.includes("exec -T") &&
        invocation.includes("UserManager.jar usermod -A")
      )
    ).toBe(true);
  });

  it("can save compose deployments into TAKCLI profiles after a successful deploy", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-profiles-"));
    const configPath = path.join(deploymentRoot, "takcli-config.yaml");
    const certsFilesDir = path.join(deploymentRoot, "data", "certs", "files");
    const runner = new HybridRunner();
    const prompt = new RetryingPrompt({
      confirms: [false, true, true, true],
      values: {
        "Certificate authority password": ["ca-pass"]
      }
    });
    const io = createMemoryIo();
    const encryptedPrivateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: {
        cipher: "aes-256-cbc",
        format: "pem",
        passphrase: "admin-pass",
        type: "pkcs8"
      },
      publicKeyEncoding: {
        format: "pem",
        type: "spki"
      }
    }).privateKey;

    await mkdir(certsFilesDir, { recursive: true });
    await writeFile(path.join(certsFilesDir, "admin.key"), encryptedPrivateKey, "utf8");

    const exitCode = await runCli(
      [
        "deploy",
        "--config",
        configPath,
        "--target",
        "docker-compose",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "profiled-compose",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "latest"
      ],
      io.io,
      createServicesWithPrompt(prompt, runner)
    );

    expect(exitCode).toBe(0);

    const loaded = await loadConfig(configPath);
    expect(loaded.config.currentProfile).toBe("profiled-compose");
    expect(loaded.config.profiles["profiled-compose"]).toMatchObject({
      server: "https://127.0.0.1:8446",
      tls: {
        insecureSkipVerify: true
      }
    });
    expect(loaded.config.profiles["profiled-compose-admin"]).toMatchObject({
      server: "https://127.0.0.1:8443",
      tls: {
        caFile: path.join(deploymentRoot, "data", "certs", "files", "root-ca.pem"),
        certFile: path.join(deploymentRoot, "data", "certs", "files", "admin.pem"),
        insecureSkipVerify: true,
        keyFile: path.join(deploymentRoot, "data", "certs", "files", "admin.unencrypted.key")
      }
    });
    await expect(access(path.join(certsFilesDir, "admin.unencrypted.key"))).resolves.toBeUndefined();
    await expect(readFile(path.join(certsFilesDir, "admin.unencrypted.key"), "utf8")).resolves.toContain(
      "BEGIN PRIVATE KEY"
    );
    expect(io.readStdout()).toContain("Saved TAKCLI profiles");
  });

  it("can save compose deployments into TAKCLI profiles during non-interactive deploys", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-profiles-"));
    const configPath = path.join(deploymentRoot, "takcli-config.yaml");
    const certsFilesDir = path.join(deploymentRoot, "data", "certs", "files");
    const runner = new HybridRunner();
    const io = createMemoryIo();
    const encryptedPrivateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: {
        cipher: "aes-256-cbc",
        format: "pem",
        passphrase: "admin-pass",
        type: "pkcs8"
      },
      publicKeyEncoding: {
        format: "pem",
        type: "spki"
      }
    }).privateKey;

    await mkdir(certsFilesDir, { recursive: true });
    await writeFile(path.join(certsFilesDir, "admin.key"), encryptedPrivateKey, "utf8");

    const exitCode = await runCli(
      [
        "deploy",
        "--config",
        configPath,
        "--target",
        "docker-compose",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "noninteractive-compose",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "latest",
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
        "--save-profiles",
        "--yes"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);

    const loaded = await loadConfig(configPath);
    expect(loaded.config.currentProfile).toBe("noninteractive-compose");
    expect(loaded.config.profiles["noninteractive-compose"]).toMatchObject({
      server: "https://127.0.0.1:8446",
      tls: {
        insecureSkipVerify: true
      }
    });
    expect(loaded.config.profiles["noninteractive-compose-admin"]).toMatchObject({
      server: "https://127.0.0.1:8443",
      tls: {
        caFile: path.join(deploymentRoot, "data", "certs", "files", "root-ca.pem"),
        certFile: path.join(deploymentRoot, "data", "certs", "files", "admin.pem"),
        insecureSkipVerify: true,
        keyFile: path.join(deploymentRoot, "data", "certs", "files", "admin.unencrypted.key")
      }
    });
    expect(io.readStdout()).toContain("Saved TAKCLI profiles");
  });

  it("tracks successful compose deployments in the deployment state file", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-state-"));
    const configPath = path.join(deploymentRoot, "takcli-config.yaml");
    const runner = new HybridRunner();
    const io = createMemoryIo();

    const exitCode = await runCli(
      [
        "deploy",
        "--config",
        configPath,
        "--target",
        "docker-compose",
        "--ref",
        "main",
        "--repo-url",
        repoDir,
        "--cache-root",
        cacheRoot,
        "--name",
        "tracked-compose",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "latest",
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
        "--json"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as { statePath: string };
    const loaded = await loadDeploymentState(configPath);
    const tracked = loaded.state.deployments["tracked-compose"];

    expect(output.statePath).toBe(loaded.path);
    expect(tracked).toMatchObject({
      addons: [],
      certsDir: path.join(deploymentRoot, "data", "certs"),
      compose: {
        composeFilePath: path.join(deploymentRoot, "docker-compose.yml"),
        envFilePath: path.join(deploymentRoot, ".env")
      },
      dataDir: path.join(deploymentRoot, "data"),
      deploymentRoot,
      imageTag: "latest",
      logsDir: path.join(deploymentRoot, "data", "logs"),
      profileNames: [],
      ref: "main",
      registry: "docker.io/codehausau",
      repoUrl: repoDir,
      target: "docker-compose"
    });
  });

  it("prints a deployment wait message while compose startup is in progress", async () => {
    const repoDir = await createFakeTakServerRepo();
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-deploy-cache-"));
    const deploymentRoot = await mkdtemp(path.join(os.tmpdir(), "takcli-compose-progress-"));
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
        "progress-compose",
        "--deployment-root",
        deploymentRoot,
        "--data-dir",
        path.join(deploymentRoot, "data"),
        "--logs-dir",
        path.join(deploymentRoot, "data", "logs"),
        "--certs-dir",
        path.join(deploymentRoot, "data", "certs"),
        "--registry",
        "docker.io/codehausau",
        "--image-tag",
        "latest",
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
        "--yes"
      ],
      io.io,
      createServices(runner)
    );

    expect(exitCode).toBe(0);
    expect(io.readStdout()).toContain("Starting Docker Compose deployment...");
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
