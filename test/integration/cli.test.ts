import https from "node:https";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";

import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/index.js";

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

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
});

describe("TAKCLI integration", () => {
  it("prints a completion script", async () => {
    const io = createMemoryIo();
    const exitCode = await runCli(["completion", "bash"], io.io);

    expect(exitCode).toBe(0);
    expect(io.readStdout()).toContain("takcli __complete bash");
    expect(io.readStdout()).toContain("complete -o default -F _takcli_completion takcli");
  });

  it("adds, uses, and lists profiles", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-cli-"));
    const configPath = path.join(baseDir, "config.yaml");
    const first = createMemoryIo();

    let exitCode = await runCli(
      [
        "profile",
        "add",
        "local",
        "--server",
        "https://127.0.0.1:8446",
        "--insecure",
        "--set-current",
        "--config",
        configPath,
        "--json"
      ],
      first.io
    );

    expect(exitCode).toBe(0);
    const addOutput = JSON.parse(first.readStdout()) as { currentProfile?: string };
    expect(addOutput.currentProfile).toBe("local");

    const second = createMemoryIo();
    exitCode = await runCli(["profile", "list", "--config", configPath, "--json"], second.io);
    expect(exitCode).toBe(0);
    const listOutput = JSON.parse(second.readStdout()) as {
      profiles: Array<{ current: boolean; name: string }>;
    };
    expect(listOutput.profiles).toHaveLength(1);
    expect(listOutput.profiles[0]).toMatchObject({ current: true, name: "local" });
  });

  it("runs doctor against a local self-signed HTTPS endpoint", async () => {
    const certs = selfsigned.generate(
      [
        {
          name: "commonName",
          value: "127.0.0.1"
        }
      ],
      {
        days: 365,
        keySize: 2048
      }
    );

    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (_req, res) => {
        res.writeHead(403);
        res.end();
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a bound address.");
    }

    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-cli-"));
    const configPath = path.join(baseDir, "config.yaml");
    const add = createMemoryIo();

    let exitCode = await runCli(
      [
        "profile",
        "add",
        "local",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure",
        "--api-port",
        String(address.port),
        "--enrollment-port",
        String(address.port),
        "--federation-port",
        String(address.port),
        "--cot-port",
        String(address.port),
        "--set-current",
        "--config",
        configPath
      ],
      add.io
    );

    expect(exitCode).toBe(0);

    const doctor = createMemoryIo();
    exitCode = await runCli(["doctor", "--config", configPath, "--json"], doctor.io);
    expect(exitCode).toBe(0);

    const report = JSON.parse(doctor.readStdout()) as { ok: boolean; summary: { failed: number } };
    expect(report.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
  });

  it("supports ad-hoc insecure checks against a self-signed HTTPS endpoint", async () => {
    const certs = selfsigned.generate(
      [
        {
          name: "commonName",
          value: "127.0.0.1"
        }
      ],
      {
        days: 365,
        keySize: 2048
      }
    );

    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (_req, res) => {
        res.writeHead(403);
        res.end();
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a bound address.");
    }

    const status = createMemoryIo();
    let exitCode = await runCli(
      [
        "status",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--api-port",
        String(address.port),
        "--enrollment-port",
        String(address.port),
        "--federation-port",
        String(address.port),
        "--cot-port",
        String(address.port),
        "--insecure",
        "--json"
      ],
      status.io
    );

    expect(exitCode).toBe(0);
    const statusOutput = JSON.parse(status.readStdout()) as { ok: boolean; overall: string };
    expect(statusOutput.ok).toBe(true);
    expect(statusOutput.overall).toBe("healthy");

    const doctor = createMemoryIo();
    exitCode = await runCli(
      [
        "doctor",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--api-port",
        String(address.port),
        "--enrollment-port",
        String(address.port),
        "--federation-port",
        String(address.port),
        "--cot-port",
        String(address.port),
        "--insecure",
        "--json"
      ],
      doctor.io
    );

    expect(exitCode).toBe(0);
    const doctorOutput = JSON.parse(doctor.readStdout()) as { ok: boolean; summary: { failed: number } };
    expect(doctorOutput.ok).toBe(true);
    expect(doctorOutput.summary.failed).toBe(0);
  });

  it("runs kubernetes doctor checks through kubectl", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-kubectl-"));
    await mkdir(path.join(baseDir, "bin"), { recursive: true });
    const kubectlPath = path.join(baseDir, "bin", "kubectl");
    await writeFile(
      kubectlPath,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"version\" ] && [ \"$2\" = \"--client=true\" ]; then",
        "  printf '%s' '{\"clientVersion\":{\"gitVersion\":\"v1.30.0\"}}'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"config\" ] && [ \"$2\" = \"current-context\" ]; then",
        "  printf '%s\\n' 'k3s-test'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"get\" ] && [ \"$2\" = \"nodes\" ]; then",
        "  printf '%s' '{\"items\":[{\"metadata\":{\"name\":\"node-1\"},\"status\":{\"conditions\":[{\"type\":\"Ready\",\"status\":\"True\"}]}}]}'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"get\" ] && [ \"$2\" = \"storageclass\" ]; then",
        "  printf '%s' '{\"items\":[{\"metadata\":{\"name\":\"local-path\",\"annotations\":{\"storageclass.kubernetes.io/is-default-class\":\"true\"}}}]}'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"get\" ] && [ \"$2\" = \"namespace\" ]; then",
        "  printf '%s' '{}'",
        "  exit 0",
        "fi",
        "printf '%s\\n' \"unexpected kubectl invocation: $*\" >&2",
        "exit 1"
      ].join("\n"),
      "utf8"
    );
    await chmod(kubectlPath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${path.join(baseDir, "bin")}:${originalPath ?? ""}`;

    try {
      const io = createMemoryIo();
      const exitCode = await runCli(["doctor", "--kubernetes", "--namespace", "tak-demo", "--json"], io.io);

      expect(exitCode).toBe(0);
      const report = JSON.parse(io.readStdout()) as {
        kubernetes: { context?: string; defaultStorageClass?: string; readyNodes?: number };
        mode: string;
        ok: boolean;
      };
      expect(report.mode).toBe("kubernetes");
      expect(report.ok).toBe(true);
      expect(report.kubernetes.context).toBe("k3s-test");
      expect(report.kubernetes.defaultStorageClass).toBe("local-path");
      expect(report.kubernetes.readyNodes).toBe(1);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("returns a non-zero exit code when status is degraded", async () => {
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "status",
        "--server",
        "https://127.0.0.1:65530",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(1);
    const output = JSON.parse(io.readStdout()) as { overall: string; ok: boolean };
    expect(output.ok).toBe(false);
    expect(output.overall).toBe("unreachable");
    expect(io.readStderr()).toContain("TAK status is degraded");
  });
});
