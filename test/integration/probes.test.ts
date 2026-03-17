import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";

import { probeHttp, probeTcp, probeTls } from "../../src/tak/probes.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
});

describe("TAK probes", () => {
  it("probes a plain TCP endpoint", async () => {
    const server = http.createServer((_req, res) => res.writeHead(200).end("ok"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IP address.");
    }

    const result = await probeTcp("127.0.0.1", address.port, 1000);
    expect(result.ok).toBe(true);
  });

  it("supports TLS and HTTP probes against a self-signed endpoint", async () => {
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
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-certs-"));
    const certPath = path.join(baseDir, "cert.pem");
    const keyPath = path.join(baseDir, "key.pem");
    await writeFile(certPath, certs.cert, "utf8");
    await writeFile(keyPath, certs.private, "utf8");

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
      throw new Error("Expected an IP address.");
    }

    const tlsResult = await probeTls("127.0.0.1", address.port, 1000, {
      certFile: certPath,
      insecureSkipVerify: true,
      keyFile: keyPath
    });
    expect(tlsResult.ok).toBe(true);

    const httpResult = await probeHttp(new URL(`https://127.0.0.1:${address.port}`), 1000, {
      insecureSkipVerify: true
    });
    expect(httpResult.ok).toBe(true);
    expect(httpResult.statusCode).toBe(403);
  });
});
