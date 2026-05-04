import { Buffer } from "node:buffer";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import http from "node:http";
import https from "node:https";

import type { ResolvedProfile } from "../core/profile-resolution.js";
import { buildTlsClientOptions, describeTlsClientError } from "./tls.js";

export type TakHttpPortName = "api" | "enrollment" | "federation";

export interface TakHttpRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: "DELETE" | "GET" | "POST" | "PUT";
  pathname: string;
  port?: number;
  portName?: TakHttpPortName;
  searchParams?: Record<string, string | undefined>;
}

export interface TakHttpResponse {
  body: string;
  headers: IncomingHttpHeaders;
  statusCode?: number;
  statusMessage?: string;
  url: string;
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
  port: number | TakHttpPortName = "api"
): URL {
  const url = new URL(profile.server);
  url.pathname = pathname;
  url.port = String(typeof port === "number" ? port : profile.ports[port]);
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
  const port = options.port ?? options.portName ?? "api";
  const url = buildTakUrl(profile, options.pathname, options.searchParams, port);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? https.request : http.request;
  const tlsOptions = isHttps ? buildTlsClientOptions(url.hostname, profile.tls) : undefined;
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
    let request: ClientRequest | undefined;
    const timer = setTimeout(() => {
      request?.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      request = requestFn(
        {
          ...tlsOptions,
          headers,
          host: url.hostname,
          method: options.method ?? "GET",
          path: `${url.pathname}${url.search}`,
          port: url.port ? Number(url.port) : undefined
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
    } catch (error) {
      clearTimeout(timer);
      reject(describeTlsClientError(error));
      return;
    }

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
