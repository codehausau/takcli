import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import type { ResolvedProfile } from "../../core/profile-resolution.js";
import type { UidSearchResult } from "./types.js";

interface HttpTextResponse {
  body: string;
  statusCode?: number;
  statusMessage?: string;
  url: string;
}

function withTimeout<T>(label: string, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    work().finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

function ensureValidTlsPair(profile: ResolvedProfile): void {
  const hasCert = Boolean(profile.tls.certFile);
  const hasKey = Boolean(profile.tls.keyFile);

  if (hasCert !== hasKey) {
    throw new Error("Both tls.certFile and tls.keyFile must be configured together.");
  }
}

function buildApiUrl(profile: ResolvedProfile, pathname: string, searchParams: Record<string, string>): URL {
  const url = new URL(profile.server);
  url.pathname = pathname;
  url.port = String(profile.ports.api);
  url.search = "";

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function requestText(
  url: URL,
  profile: ResolvedProfile,
  timeoutMs: number
): Promise<HttpTextResponse> {
  ensureValidTlsPair(profile);

  return withTimeout("HTTP request", timeoutMs, async () => {
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? https.request : http.request;

    return new Promise<HttpTextResponse>((resolve, reject) => {
      const request = requestFn(
        {
          ca: profile.tls.caFile ? readFileSync(profile.tls.caFile) : undefined,
          cert: profile.tls.certFile ? readFileSync(profile.tls.certFile) : undefined,
          host: url.hostname,
          key: profile.tls.keyFile ? readFileSync(profile.tls.keyFile) : undefined,
          method: "GET",
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
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              statusCode: response.statusCode,
              statusMessage: response.statusMessage,
              url: url.toString()
            });
          });
        }
      );

      request.once("error", reject);
      request.end();
    });
  });
}

async function requestWithFallback(
  profile: ResolvedProfile,
  timeoutMs: number,
  pathnames: string[],
  searchParams: Record<string, string>
): Promise<HttpTextResponse> {
  let lastResponse: HttpTextResponse | undefined;
  let lastError: Error | undefined;

  for (const pathname of pathnames) {
    const url = buildApiUrl(profile, pathname, searchParams);

    try {
      const response = await requestText(url, profile, timeoutMs);
      if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) {
        return response;
      }

      if (response.statusCode === 404) {
        lastResponse = response;
        continue;
      }

      throw new Error(
        `TAK endpoint ${url.pathname} returned HTTP ${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}`.trim()
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(
    `TAK endpoint not found. Tried ${pathnames.join(", ")}${lastResponse ? ` (last response: HTTP ${lastResponse.statusCode ?? "unknown"})` : ""}.`
  );
}

export async function fetchCotEventXml(
  profile: ResolvedProfile,
  timeoutMs: number,
  lookup: { cotId?: number; uid?: string }
): Promise<string> {
  const response = await requestWithFallback(
    profile,
    timeoutMs,
    ["/Marti/GetCotData/", "/Marti/GetCotData", "/GetCotData/", "/GetCotData"],
    {
      ...(lookup.cotId !== undefined ? { cotId: String(lookup.cotId) } : {}),
      ...(lookup.uid ? { uid: lookup.uid } : {}),
      xml: "1"
    }
  );

  return response.body.trim();
}

function parseUidSearchPayload(body: string): UidSearchResult[] {
  const parsed = JSON.parse(body) as {
    data?: unknown;
    errors?: string[];
  } | unknown[];

  const data = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.data)
      ? parsed.data
      : undefined;

  if (!data) {
    if (!Array.isArray(parsed) && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      throw new Error(parsed.errors.join("; "));
    }

    throw new Error("TAK uidsearch response did not include a data array.");
  }

  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as { callSign?: unknown; uid?: unknown };
    if (typeof candidate.uid !== "string") {
      return [];
    }

    return [
      {
        callSign: typeof candidate.callSign === "string" ? candidate.callSign : undefined,
        uid: candidate.uid
      }
    ];
  });
}

export async function fetchUidSearchResults(
  profile: ResolvedProfile,
  timeoutMs: number,
  startDate: string,
  endDate: string
): Promise<UidSearchResult[]> {
  const response = await requestWithFallback(
    profile,
    timeoutMs,
    ["/Marti/api/uidsearch", "/api/uidsearch"],
    {
      endDate,
      startDate
    }
  );

  return parseUidSearchPayload(response.body);
}
