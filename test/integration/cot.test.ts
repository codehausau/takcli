import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { mkdtemp } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";

import { saveConfig } from "../../src/core/config-store.js";
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

function createCerts() {
  return selfsigned.generate(
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
}

async function createConfig(cotPort: number): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-cot-"));
  const configPath = path.join(baseDir, "config.yaml");
  await saveConfig(configPath, {
    currentProfile: "local",
    profiles: {
      local: {
        auth: {},
        ports: {
          api: 8446,
          cot: cotPort,
          enrollment: 8443,
          federation: 8444
        },
        server: "https://127.0.0.1:8446",
        tls: {
          insecureSkipVerify: true
        }
      }
    },
    schemaVersion: 1
  });

  return configPath;
}

async function createAdHocConfigPath(): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-cot-adhoc-"));
  return path.join(baseDir, "config.yaml");
}

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
});

describe("TAKCLI CoT integration", () => {
  it("queries a CoT event from the TAK HTTP endpoint", async () => {
    const certs = createCerts();
    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (req, res) => {
        const requestUrl = new URL(req.url ?? "/", "https://127.0.0.1");

        if (requestUrl.pathname !== "/Marti/GetCotData") {
          res.writeHead(404);
          res.end();
          return;
        }

        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/><remarks>hello</remarks></detail></event>'
        );
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "query",
        "--config",
        configPath,
        "--uid",
        "alpha",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as { event: { callsign?: string; uid: string } };
    expect(output.event.uid).toBe("alpha");
    expect(output.event.callsign).toBe("Eagle 1");
  });

  it("uses the enrollment HTTPS port for CoT lookups when the primary API port denies them", async () => {
    const certs = createCerts();
    const apiServer = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (_req, res) => {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Use the secure admin port" }));
      }
    );
    servers.push(apiServer);
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", () => resolve()));
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") {
      throw new Error("Expected an API port.");
    }

    const enrollmentServer = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (req, res) => {
        const requestUrl = new URL(req.url ?? "/", "https://127.0.0.1");

        if (requestUrl.pathname === "/Marti/api/uidsearch") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: [{ callSign: "Eagle 1", uid: "alpha" }] }));
          return;
        }

        if (requestUrl.pathname === "/Marti/GetCotData" && requestUrl.searchParams.get("uid") === "alpha") {
          res.writeHead(200, { "content-type": "application/xml" });
          res.end(
            '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/></detail></event>'
          );
          return;
        }

        res.writeHead(404);
        res.end();
      }
    );
    servers.push(enrollmentServer);
    await new Promise<void>((resolve) => enrollmentServer.listen(0, "127.0.0.1", () => resolve()));
    const enrollmentAddress = enrollmentServer.address();
    if (!enrollmentAddress || typeof enrollmentAddress === "string") {
      throw new Error("Expected an enrollment port.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "targets",
        "--config",
        configPath,
        "--server",
        `https://127.0.0.1:${apiAddress.port}`,
        "--enrollment-port",
        String(enrollmentAddress.port),
        "--insecure",
        "--limit",
        "1",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.readStdout())).toMatchObject({
      targets: [
        {
          callsign: "Eagle 1",
          type: "a-f-G-U-C",
          uid: "alpha"
        }
      ]
    });
  });

  it("retries UID queries when the first lookup times out", async () => {
    const certs = createCerts();
    let attempts = 0;
    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      async (req, res) => {
        const requestUrl = new URL(req.url ?? "/", "https://127.0.0.1");

        if (requestUrl.pathname !== "/Marti/GetCotData/") {
          res.writeHead(404);
          res.end();
          return;
        }

        attempts += 1;

        if (attempts === 1) {
          await delay(100);
        }

        if (res.destroyed) {
          return;
        }

        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/></detail></event>'
        );
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "query",
        "--config",
        configPath,
        "--uid",
        "alpha",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure",
        "--timeout",
        "30",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(0);
    expect(attempts).toBeGreaterThanOrEqual(2);
    const output = JSON.parse(io.readStdout()) as { event: { uid: string } };
    expect(output.event.uid).toBe("alpha");
  });

  it("lists CoT targets and keeps partial rows when enrichment fails", async () => {
    const certs = createCerts();
    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (req, res) => {
        const requestUrl = new URL(req.url ?? "/", "https://127.0.0.1");

        if (requestUrl.pathname === "/Marti/api/uidsearch") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: [
                { callSign: "Eagle 1", uid: "alpha" },
                { callSign: "Bravo", uid: "beta" }
              ]
            })
          );
          return;
        }

        if (requestUrl.pathname === "/Marti/GetCotData" && requestUrl.searchParams.get("uid") === "alpha") {
          res.writeHead(200, { "content-type": "application/xml" });
          res.end(
            '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/></detail></event>'
          );
          return;
        }

        res.writeHead(404);
        res.end();
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "targets",
        "--config",
        configPath,
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure",
        "--limit",
        "2",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as {
      targets: Array<{ error?: string; type?: string; uid: string }>;
    };
    expect(output.targets).toHaveLength(2);
    expect(output.targets[0]).toMatchObject({ type: "a-f-G-U-C", uid: "alpha" });
    expect(output.targets[1].uid).toBe("beta");
    expect(output.targets[1].error).toContain("endpoint");
  });

  it("injects a generated CoT event over the live TLS stream", async () => {
    const certs = createCerts();
    let received = "";
    let receivedResolve: (() => void) | undefined;
    const receivedPromise = new Promise<void>((resolve) => {
      receivedResolve = resolve;
    });
    const server = tls.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (socket) => {
        socket.on("data", (chunk) => {
          received += chunk.toString("utf8");
          if (received.includes("</event>")) {
            socket.end();
            receivedResolve?.();
          }
        });
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createConfig(address.port);
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "inject",
        "--config",
        configPath,
        "--uid",
        "alpha",
        "--type",
        "a-f-G-U-C",
        "--lat",
        "-35.3",
        "--lon",
        "149.1",
        "--callsign",
        "Eagle 1",
        "--remarks",
        "hello",
        "--json"
      ],
      io.io
    );

    await receivedPromise;

    expect(exitCode).toBe(0);
    expect(received).toContain('uid="alpha"');
    expect(received).toContain('callsign="Eagle 1"');
    const output = JSON.parse(io.readStdout()) as { event: { uid: string } };
    expect(output.event.uid).toBe("alpha");
  });

  it("follows a CoT TLS stream and emits one JSON object per event", async () => {
    const certs = createCerts();
    const frames = [
      '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/></detail></event>',
      '<event version="2.0" uid="beta" type="a-f-G-U-C" time="2026-03-17T10:01:00.000Z" start="2026-03-17T10:01:00.000Z" stale="2026-03-17T10:06:00.000Z" how="m-g"><point lat="-35.4" lon="149.2" hae="451" ce="13" le="23"/></event>'
    ];
    const server = tls.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (socket) => {
        socket.write(frames.join(""));
        socket.end();
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createConfig(address.port);
    const io = createMemoryIo();
    const exitCode = await runCli(
      ["cot", "follow", "--config", configPath, "--limit", "2", "--json"],
      io.io
    );

    expect(exitCode).toBe(0);
    const lines = io
      .readStdout()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: { uid: string }; sequence: number });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sequence: 1, event: { uid: "alpha" } });
    expect(lines[1]).toMatchObject({ sequence: 2, event: { uid: "beta" } });
  });

  it("returns a non-zero exit code for unauthorized CoT queries", async () => {
    const certs = createCerts();
    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (_req, res) => {
        res.writeHead(403);
        res.end("forbidden");
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "query",
        "--config",
        configPath,
        "--uid",
        "alpha",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure"
      ],
      io.io
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("HTTP 403");
  });

  it("returns a non-zero exit code for malformed CoT XML", async () => {
    const certs = createCerts();
    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end("<invalid />");
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const configPath = await createAdHocConfigPath();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "cot",
        "query",
        "--config",
        configPath,
        "--uid",
        "alpha",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--insecure"
      ],
      io.io
    );

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("Invalid CoT XML");
  });
});
