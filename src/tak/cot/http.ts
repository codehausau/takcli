import type { ClientRequest } from "node:http";
import http from "node:http";
import https from "node:https";

import type { ResolvedProfile } from "../../core/profile-resolution.js";
import { buildTakUrl } from "../http.js";
import { buildTlsClientOptions, describeTlsClientError } from "../tls.js";
import type { UidSearchResult } from "./types.js";

interface HttpTextResponse {
  body: string;
  statusCode?: number;
  statusMessage?: string;
  url: string;
}

function getCotHttpPorts(profile: ResolvedProfile): number[] {
  return [...new Set([profile.ports.enrollment, profile.ports.api])];
}

function buildEndpointUrls(
  profile: ResolvedProfile,
  pathnames: string[],
  searchParams: Record<string, string>
): URL[] {
  const urls: URL[] = [];

  for (const port of getCotHttpPorts(profile)) {
    for (const pathname of pathnames) {
      urls.push(buildTakUrl(profile, pathname, searchParams, port));
    }
  }

  return urls;
}

async function requestText(
  url: URL,
  profile: ResolvedProfile,
  timeoutMs: number
): Promise<HttpTextResponse> {
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? https.request : http.request;
  const tlsOptions = isHttps ? buildTlsClientOptions(url.hostname, profile.tls) : undefined;

  return new Promise<HttpTextResponse>((resolve, reject) => {
    let request: ClientRequest | undefined;
    const timer = setTimeout(() => {
      request?.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      request = requestFn(
        {
          ...tlsOptions,
          host: url.hostname,
          method: "GET",
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
    request.end();
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

  for (const url of buildEndpointUrls(profile, pathnames, searchParams)) {

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
    `TAK endpoint not found. Tried ${buildEndpointUrls(profile, pathnames, searchParams)
      .map((url) => url.pathname + (url.port ? ` on ${url.port}` : ""))
      .join(", ")}${lastResponse ? ` (last response: HTTP ${lastResponse.statusCode ?? "unknown"})` : ""}.`
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
