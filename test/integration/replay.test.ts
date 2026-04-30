import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import http from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

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

async function writeReplayFixture(): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-replay-int-"));
  const filePath = path.join(baseDir, "tracks.geojson");
  await writeFile(
    filePath,
    JSON.stringify({
      features: [
        {
          geometry: {
            coordinates: [138.6, -34.8],
            type: "Point"
          },
          properties: {
            craftId: "charlie",
            speedKnots: 12.5,
            timestampIsoUtc: "2026-03-01T00:02:00Z",
            type: "Cargo"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.5, -34.7],
            type: "Point"
          },
          properties: {
            craftId: "alpha",
            speedKnots: 3.2,
            timestampIsoUtc: "2026-03-01T00:00:00Z",
            type: "Sailing"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.55, -34.75],
            type: "Point"
          },
          properties: {
            craftId: "bravo",
            speedKnots: 6.4,
            timestampIsoUtc: "2026-03-01T00:01:00Z",
            type: "Fishing"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    }),
    "utf8"
  );

  return filePath;
}

async function serveReplayFixture(filePath: string): Promise<{ close: () => Promise<void>; url: string }> {
  const payload = await readFile(filePath, "utf8");
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "application/geo+json" });
    res.end(payload);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IP address.");
  }

  return {
    close: async () =>
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    url: `http://127.0.0.1:${address.port}/tracks.geojson`
  };
}

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
});

describe("TAKCLI replay integration", () => {
  it("replays a GeoJSON track file into the CoT TLS stream", async () => {
    const certs = createCerts();
    const receivedFrames: string[] = [];

    const server = tls.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (socket) => {
        let buffer = "";
        let parsed = false;

        const flushFrames = () => {
          if (parsed) {
            return;
          }
          parsed = true;

          let working = buffer;
          while (true) {
            const endIndex = working.indexOf("</event>");
            if (endIndex === -1) {
              break;
            }

            const startIndex = working.indexOf("<event");
            if (startIndex === -1 || startIndex > endIndex) {
              break;
            }

            receivedFrames.push(working.slice(startIndex, endIndex + "</event>".length));
            working = working.slice(endIndex + "</event>".length);
          }
        };

        socket.on("data", (chunk: Buffer | string) => {
          buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        });
        socket.on("end", flushFrames);
        socket.on("close", flushFrames);
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const filePath = await writeReplayFixture();
    const io = createMemoryIo();
    const exitCode = await runCli(
      [
        "replay",
        "file",
        filePath,
        "--source",
        "auto",
        "--start-from",
        "start",
        "--speed",
        "3600",
        "--max-events",
        "3",
        "--server",
        "https://127.0.0.1:8446",
        "--cot-port",
        String(address.port),
        "--insecure",
        "--json"
      ],
      io.io
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.readStdout()) as { sentEvents: number; state: string };
    expect(output.sentEvents).toBe(3);
    expect(output.state).toBe("completed");

    for (let attempt = 0; attempt < 20 && receivedFrames.length < 3; attempt += 1) {
      await delay(50);
    }

    expect(receivedFrames).toHaveLength(3);
    expect(receivedFrames[0]).toContain('uid="replay-vessel-alpha"');
    expect(receivedFrames[1]).toContain('uid="replay-vessel-bravo"');
    expect(receivedFrames[2]).toContain('uid="replay-vessel-charlie"');
    expect(receivedFrames[0]).toContain("<track");
    expect(receivedFrames[0]).toContain("Source time: 2026-03-01T00:00:00.000Z");
  });

  it("replays a GeoJSON track file from an HTTP URL", async () => {
    const certs = createCerts();
    const receivedFrames: string[] = [];

    const tlsServer = tls.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      (socket) => {
        let buffer = "";
        let parsed = false;

        const flushFrames = () => {
          if (parsed) {
            return;
          }
          parsed = true;

          let working = buffer;
          while (true) {
            const endIndex = working.indexOf("</event>");
            if (endIndex === -1) {
              break;
            }

            const startIndex = working.indexOf("<event");
            if (startIndex === -1 || startIndex > endIndex) {
              break;
            }

            receivedFrames.push(working.slice(startIndex, endIndex + "</event>".length));
            working = working.slice(endIndex + "</event>".length);
          }
        };

        socket.on("data", (chunk: Buffer | string) => {
          buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        });
        socket.on("end", flushFrames);
        socket.on("close", flushFrames);
      }
    );
    servers.push(tlsServer);
    await new Promise<void>((resolve) => tlsServer.listen(0, "127.0.0.1", () => resolve()));

    const address = tlsServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const filePath = await writeReplayFixture();
    const httpFixture = await serveReplayFixture(filePath);
    const io = createMemoryIo();

    try {
      const exitCode = await runCli(
        [
          "replay",
          "file",
          httpFixture.url,
          "--source",
          "auto",
          "--start-from",
          "start",
          "--speed",
          "3600",
          "--max-events",
          "2",
          "--server",
          "https://127.0.0.1:8446",
          "--cot-port",
          String(address.port),
          "--insecure",
          "--json"
        ],
        io.io
      );

      expect(exitCode).toBe(0);
      const output = JSON.parse(io.readStdout()) as { sentEvents: number; state: string };
      expect(output.sentEvents).toBe(2);
      expect(output.state).toBe("completed");

      for (let attempt = 0; attempt < 20 && receivedFrames.length < 2; attempt += 1) {
        await delay(50);
      }

      expect(receivedFrames).toHaveLength(2);
      expect(receivedFrames[0]).toContain('uid="replay-vessel-alpha"');
      expect(receivedFrames[1]).toContain('uid="replay-vessel-bravo"');
    } finally {
      await httpFixture.close();
    }
  });
});
