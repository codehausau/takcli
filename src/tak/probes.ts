import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

import type { DnsProbeResult, HttpProbeResult, TcpProbeResult, TlsProbeResult } from "./types.js";

function pickCertificateName(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

async function withTimeout<T>(label: string, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function probeDns(host: string, timeoutMs: number): Promise<DnsProbeResult> {
  const start = Date.now();

  try {
    const lookup = await withTimeout("DNS lookup", timeoutMs, () => dns.lookup(host));
    return {
      address: lookup.address,
      durationMs: Date.now() - start,
      family: lookup.family,
      ok: true
    };
  } catch (error) {
    return {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

export async function probeTcp(host: string, port: number, timeoutMs: number): Promise<TcpProbeResult> {
  const start = Date.now();

  try {
    await withTimeout("TCP connection", timeoutMs, () => {
      return new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host, port });

        socket.once("connect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
      });
    });

    return {
      durationMs: Date.now() - start,
      host,
      ok: true,
      port
    };
  } catch (error) {
    return {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      host,
      ok: false,
      port
    };
  }
}

export async function probeTls(
  host: string,
  port: number,
  timeoutMs: number,
  options: {
    caFile?: string;
    certFile?: string;
    insecureSkipVerify?: boolean;
    keyFile?: string;
  } = {}
): Promise<TlsProbeResult> {
  const start = Date.now();

  try {
    const certificate = await withTimeout("TLS handshake", timeoutMs, () => {
      return new Promise<tls.PeerCertificate>((resolve, reject) => {
        const socket = tls.connect({
          ca: options.caFile ? readFileSync(options.caFile) : undefined,
          cert: options.certFile ? readFileSync(options.certFile) : undefined,
          host,
          key: options.keyFile ? readFileSync(options.keyFile) : undefined,
          port,
          rejectUnauthorized: !(options.insecureSkipVerify ?? false),
          servername: net.isIP(host) ? undefined : host
        });

        socket.once("secureConnect", () => {
          const peerCertificate = socket.getPeerCertificate();
          socket.end();
          resolve(peerCertificate);
        });
        socket.once("error", reject);
      });
    });

    return {
      durationMs: Date.now() - start,
      fingerprint256: certificate.fingerprint256,
      issuer: pickCertificateName(certificate.issuer?.CN),
      ok: true,
      subject: pickCertificateName(certificate.subject?.CN),
      validFrom: certificate.valid_from,
      validTo: certificate.valid_to
    };
  } catch (error) {
    return {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

export async function probeHttp(
  url: URL,
  timeoutMs: number,
  options: {
    caFile?: string;
    certFile?: string;
    insecureSkipVerify?: boolean;
    keyFile?: string;
    method?: "GET" | "HEAD";
  } = {}
): Promise<HttpProbeResult> {
  const start = Date.now();

  try {
    const result = await withTimeout("HTTP request", timeoutMs, () => {
      return new Promise<{ statusCode?: number; statusMessage?: string }>((resolve, reject) => {
        const isHttps = url.protocol === "https:";
        const requestFn = isHttps ? https.request : http.request;
        const request = requestFn(
          {
            ca: options.caFile ? readFileSync(options.caFile) : undefined,
            cert: options.certFile ? readFileSync(options.certFile) : undefined,
            host: url.hostname,
            key: options.keyFile ? readFileSync(options.keyFile) : undefined,
            method: options.method ?? "HEAD",
            path: `${url.pathname || "/"}${url.search}`,
            port: url.port ? Number(url.port) : undefined,
            rejectUnauthorized: isHttps ? !(options.insecureSkipVerify ?? false) : undefined
          },
          (response) => {
            response.resume();
            resolve({
              statusCode: response.statusCode,
              statusMessage: response.statusMessage
            });
          }
        );

        request.once("error", reject);
        request.end();
      });
    });

    return {
      durationMs: Date.now() - start,
      ok: true,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      url: url.toString()
    };
  } catch (error) {
    return {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      url: url.toString()
    };
  }
}
