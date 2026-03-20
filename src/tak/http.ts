import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import type { ResolvedProfile } from "../core/profile-resolution.js";

export interface TakHttpRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: "DELETE" | "GET" | "POST" | "PUT";
  pathname: string;
  port?: number;
  searchParams?: Record<string, string | undefined>;
}

export interface TakHttpResponse {
  body: string;
  headers: IncomingHttpHeaders;
  statusCode?: number;
  statusMessage?: string;
  url: string;
}

function ensureValidTlsPair(profile: ResolvedProfile): void {
  const hasCert = Boolean(profile.tls.certFile);
  const hasKey = Boolean(profile.tls.keyFile);

  if (hasCert !== hasKey) {
    throw new Error("Both tls.certFile and tls.keyFile must be configured together.");
  }
}

function buildAuthHeader(profile: ResolvedProfile): string | undefined {
  if (profile.auth.token) {
    return `Bearer ${profile.auth.token}`;
  }

  const hasUsername = Boolean(profile.auth.username);
  const hasPassword = Boolean(profile.auth.password);

  if (hasUsername !== hasPassword) {
    throw new Error("Both auth.username and auth.password must be configured together.");
  }

  if (!hasUsername || !hasPassword) {
    return undefined;
  }

  return `Basic ${Buffer.from(`${profile.auth.username}:${profile.auth.password}`, "utf8").toString("base64")}`;
}

export function buildTakUrl(
  profile: ResolvedProfile,
  pathname: string,
  searchParams: Record<string, string | undefined> = {},
  port = profile.ports.api
): URL {
  const url = new URL(profile.server);
  url.pathname = pathname;
  url.port = String(port);
  url.search = "";

  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

export async function requestTak(
  profile: ResolvedProfile,
  timeoutMs: number,
  options: TakHttpRequestOptions
): Promise<TakHttpResponse> {
  ensureValidTlsPair(profile);

  const url = buildTakUrl(profile, options.pathname, options.searchParams, options.port);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? https.request : http.request;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers
  };
  const authHeader = buildAuthHeader(profile);

  if (authHeader) {
    headers.Authorization = authHeader;
  }

  if (options.body !== undefined) {
    headers["Content-Length"] = Buffer.byteLength(options.body, "utf8").toString();
    if (!("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
  }

  return await new Promise<TakHttpResponse>((resolve, reject) => {
    const request = requestFn(
      {
        ca: profile.tls.caFile ? readFileSync(profile.tls.caFile) : undefined,
        cert: profile.tls.certFile ? readFileSync(profile.tls.certFile) : undefined,
        headers,
        host: url.hostname,
        key: profile.tls.keyFile ? readFileSync(profile.tls.keyFile) : undefined,
        method: options.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port ? Number(url.port) : undefined,
        rejectUnauthorized: isHttps ? !profile.tls.insecureSkipVerify : undefined,
        servername: isHttps && !net.isIP(url.hostname) ? url.hostname : undefined
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          clearTimeout(timer);
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            url: url.toString()
          });
        });
      }
    );

    const timer = setTimeout(() => {
      request.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}

export function parseTakError(response: Pick<TakHttpResponse, "body" | "statusCode" | "statusMessage">): string {
  const fallback = `TAK endpoint returned HTTP ${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}`.trim();
  const body = response.body.trim();

  if (!body) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown; errors?: unknown; message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) {
      return parsed.message;
    }

    if (typeof parsed.error === "string" && parsed.error) {
      return parsed.error;
    }

    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const messages = parsed.errors.filter((value): value is string => typeof value === "string" && value.length > 0);
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }
  } catch {
    // Fall back to plain-text handling below.
  }

  return body.length <= 300 ? body : fallback;
}

export async function requestTakJson<T>(
  profile: ResolvedProfile,
  timeoutMs: number,
  options: TakHttpRequestOptions
): Promise<T> {
  const response = await requestTak(profile, timeoutMs, options);

  if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
    throw new Error(parseTakError(response));
  }

  const body = response.body.trim();
  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}
