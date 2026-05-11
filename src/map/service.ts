import { readFile } from "node:fs/promises";
import http from "node:http";

import type { LoadedConfig } from "../core/config-store.js";
import type { ResolvedProfile } from "../core/profile-resolution.js";
import { CliError } from "../cli/runtime.js";
import { loadReplayDataset } from "../replay/geojson.js";
import { readReplayTelemetry } from "../replay/telemetry.js";
import type { ReplayDatasetSummary, ReplaySourceOption, ReplayTrackPoint } from "../replay/types.js";
import { collectStatusSummary } from "../tak/doctor.js";
import { getDefaultCotTargetDateRange, collectCotTargets, followCot, injectCot, queryCot } from "../tak/cot/service.js";
import type { CotFollowEvent, CotInjectInput, CotInjectResult, CotQueryResult, CotTargetsResult } from "../tak/cot/types.js";
import type { StatusSummary } from "../tak/types.js";
import { buildMapHtml, buildPlaceholderLogoSvg, mapAppCss, mapAppJs } from "./ui.js";

const DEFAULT_LOGO_LABEL = "Your Logo";
const JSON_BODY_LIMIT_BYTES = 64 * 1024;

const LINE_COLORS = ["#f1b768", "#7ee0c3", "#73b7ff", "#d99bff", "#ff9f80", "#87d1ff"];

export interface MapServerOptions {
  autoStartLive?: boolean;
  config: LoadedConfig;
  host: string;
  logoLabel?: string;
  port: number;
  profile: ResolvedProfile;
  replayDataset?: ReplayDatasetSummary;
  timeoutMs: number;
  title?: string;
}

export interface RunningMapServer {
  close: () => Promise<void>;
  port: number;
  url: string;
  waitForClose: () => Promise<void>;
}

interface MapBackend {
  getStatus: () => Promise<StatusSummary>;
  getTargets: (startDate: string, endDate: string, limit: number) => Promise<CotTargetsResult>;
  injectEvent: (input: CotInjectInput) => Promise<CotInjectResult>;
  queryEvent: (lookup: { cotId?: number; uid?: string }) => Promise<CotQueryResult>;
  streamEvents: (options: { onEvent: (event: CotFollowEvent) => void; signal?: AbortSignal }) => Promise<void>;
}

interface MapServerContext {
  backend: MapBackend;
  liveEvents: Map<string, CotFollowEvent>;
  logoLabel: string;
  options: MapServerOptions;
  replayResponse?: ReturnType<typeof buildReplayResponse>;
  title: string;
}

interface ClientProfile {
  host: string;
  name?: string;
  ports: ResolvedProfile["ports"];
  server: string;
  source: ResolvedProfile["source"];
  tls: {
    clientCertificateConfigured: boolean;
    customCaConfigured: boolean;
    insecureSkipVerify: boolean;
  };
}

interface MapTargetsLookupState {
  degraded: boolean;
  message?: string;
  source: "live-cache" | "tak" | "unavailable";
}

interface MapTargetsResponse extends ReturnType<typeof sanitizeTargetsResult> {
  lookup: MapTargetsLookupState;
}

function buildLeafletAssetUrl(relativePath: string): URL {
  return new URL(`../../node_modules/leaflet/dist/${relativePath}`, import.meta.url);
}

async function readLeafletAsset(relativePath: string): Promise<Buffer> {
  return Buffer.from(await readFile(buildLeafletAssetUrl(relativePath)));
}

function buildMilsymbolAssetUrl(relativePath: string): URL {
  return new URL(`../../node_modules/milsymbol/dist/${relativePath}`, import.meta.url);
}

async function readMilsymbolAsset(relativePath: string): Promise<Buffer> {
  return Buffer.from(await readFile(buildMilsymbolAssetUrl(relativePath)));
}

function buildMapAssetUrl(relativePath: string): URL {
  return new URL(`../../assets/map/${relativePath}`, import.meta.url);
}

async function readMapAsset(relativePath: string): Promise<Buffer> {
  return Buffer.from(await readFile(buildMapAssetUrl(relativePath)));
}

function getContentType(pathname: string): string {
  if (pathname.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (pathname.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (pathname.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }

  if (pathname.endsWith(".png")) {
    return "image/png";
  }

  return "text/plain; charset=utf-8";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new CliError(`Invalid ${label}.`);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeLineColor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length]!;
}

function groupTrackPoints(trackPoints: ReplayTrackPoint[]): Map<string, ReplayTrackPoint[]> {
  const grouped = new Map<string, ReplayTrackPoint[]>();

  for (const trackPoint of trackPoints) {
    const bucket = grouped.get(trackPoint.uid);
    if (bucket) {
      bucket.push(trackPoint);
      continue;
    }

    grouped.set(trackPoint.uid, [trackPoint]);
  }

  return grouped;
}

function buildReplayResponse(dataset: ReplayDatasetSummary) {
  const grouped = groupTrackPoints(dataset.trackPoints);
  const features: Array<Record<string, unknown>> = [];
  const vessels: Array<Record<string, unknown>> = [];
  let colorIndex = 0;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let minLon = Infinity;

  for (const [uid, trackPoints] of grouped.entries()) {
    const lineColor = sanitizeLineColor(colorIndex);
    colorIndex += 1;

    for (const trackPoint of trackPoints) {
      minLat = Math.min(minLat, trackPoint.lat);
      minLon = Math.min(minLon, trackPoint.lon);
      maxLat = Math.max(maxLat, trackPoint.lat);
      maxLon = Math.max(maxLon, trackPoint.lon);
    }

    if (trackPoints.length > 1) {
      features.push({
        geometry: {
          coordinates: trackPoints.map((trackPoint) => [trackPoint.lon, trackPoint.lat]),
          type: "LineString"
        },
        properties: {
          callsign: trackPoints[0]?.callsign,
          kind: "replay-track",
          lineColor,
          uid
        },
        type: "Feature"
      });
    }

    vessels.push({
      callsign: trackPoints[0]?.callsign,
      lineColor,
      trackPoints: trackPoints.map((trackPoint) => ({
        callsign: trackPoint.callsign,
        craftId: trackPoint.craftId,
        lat: trackPoint.lat,
        lon: trackPoint.lon,
        sourceTime: trackPoint.sourceTime,
        sourceTimeMs: trackPoint.sourceTimeMs,
        subtype: trackPoint.subtype,
        type: trackPoint.type,
        uid: trackPoint.uid
      })),
      uid
    });
  }

  return {
    fullHistoryGeojson: {
      features,
      type: "FeatureCollection"
    },
    summary: {
      bounds:
        Number.isFinite(minLat) &&
        Number.isFinite(minLon) &&
        Number.isFinite(maxLat) &&
        Number.isFinite(maxLon)
          ? {
              maxLat,
              maxLon,
              minLat,
              minLon
            }
          : undefined,
      detectedSource: dataset.detectedSource,
      endTime: dataset.endTime,
      filePath: dataset.filePath,
      startTime: dataset.startTime,
      trackPoints: dataset.trackPoints.length,
      vesselCount: vessels.length
    },
    vessels
  };
}

function buildBackend(options: MapServerOptions): MapBackend {
  return {
    getStatus: async () => await collectStatusSummary(options.config, options.profile, options.timeoutMs),
    getTargets: async (startDate, endDate, limit) =>
      await collectCotTargets(
        {
          config: options.config,
          profile: options.profile,
          timeoutMs: options.timeoutMs
        },
        startDate,
        endDate,
        limit
      ),
    injectEvent: async (input) =>
      await injectCot(
        {
          config: options.config,
          profile: options.profile,
          timeoutMs: options.timeoutMs
        },
        input
      ),
    queryEvent: async (lookup) =>
      await queryCot(
        {
          config: options.config,
          profile: options.profile,
          timeoutMs: options.timeoutMs
        },
        lookup
      ),
    streamEvents: async (streamOptions) =>
      await followCot(
        {
          config: options.config,
          profile: options.profile,
          timeoutMs: options.timeoutMs
        },
        streamOptions
      )
  };
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;

      if (total > JSON_BODY_LIMIT_BYTES) {
        reject(new CliError("Request body is too large.", 413));
        request.destroy();
        return;
      }

      chunks.push(buffer);
    });

    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").trim();
      resolve(body.length > 0 ? JSON.parse(body) as unknown : {});
    });
    request.on("error", reject);
  });
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body, "utf8"),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function writeText(response: http.ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body, "utf8"),
    "content-type": contentType
  });
  response.end(body);
}

function writeBuffer(response: http.ServerResponse, statusCode: number, body: Buffer, contentType: string): void {
  response.writeHead(statusCode, {
    "cache-control": "public, max-age=3600",
    "content-length": body.length,
    "content-type": contentType
  });
  response.end(body);
}

function parseDateQueryParam(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  }

  return value;
}

function parseLimit(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid limit: ${value}`);
  }

  return parsed;
}

function toClientProfile(profile: ResolvedProfile): ClientProfile {
  return {
    host: profile.host,
    name: profile.name,
    ports: profile.ports,
    server: profile.server,
    source: profile.source,
    tls: {
      clientCertificateConfigured: Boolean(profile.tls.certFile && profile.tls.keyFile),
      customCaConfigured: Boolean(profile.tls.caFile),
      insecureSkipVerify: profile.tls.insecureSkipVerify
    }
  };
}

function sanitizeStatusSummary(summary: StatusSummary) {
  return {
    ...summary,
    profile: toClientProfile(summary.profile)
  };
}

function sanitizeTargetsResult(result: CotTargetsResult) {
  return {
    ...result,
    profile: toClientProfile(result.profile)
  };
}

function buildEmptyTargetsResult(
  context: MapServerContext,
  startDate: string,
  endDate: string,
  limit: number
): CotTargetsResult {
  return {
    command: "cot targets",
    configPath: context.options.config.path,
    endDate,
    generatedAt: new Date().toISOString(),
    limit,
    profile: context.options.profile,
    startDate,
    targets: []
  };
}

function buildTargetsApiResponse(
  result: CotTargetsResult,
  lookup: MapTargetsLookupState
): MapTargetsResponse {
  return {
    ...sanitizeTargetsResult(result),
    lookup
  };
}

function sanitizeInjectResult(result: CotInjectResult) {
  return {
    ...result,
    profile: toClientProfile(result.profile)
  };
}

function sanitizeQueryResult(result: CotQueryResult) {
  return {
    ...result,
    profile: toClientProfile(result.profile)
  };
}

function buildTargetsResultFromLiveEvents(
  context: MapServerContext,
  startDate: string,
  endDate: string,
  limit: number
): CotTargetsResult {
  const targets = [...context.liveEvents.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(left.event.time ?? left.event.start ?? left.generatedAt);
      const rightTime = Date.parse(right.event.time ?? right.event.start ?? right.generatedAt);
      return rightTime - leftTime;
    })
    .slice(0, limit)
    .map((entry) => ({
      callsign: entry.event.callsign,
      lat: entry.event.point.lat,
      lon: entry.event.point.lon,
      remarks: entry.event.remarks,
      time: entry.event.time ?? entry.event.start ?? entry.generatedAt,
      type: entry.event.type,
      uid: entry.event.uid
    }));

  return {
    command: "cot targets",
    configPath: context.options.config.path,
    endDate,
    generatedAt: new Date().toISOString(),
    limit,
    profile: context.options.profile,
    startDate,
    targets
  };
}

function buildMetaPayload(context: MapServerContext) {
  return {
    autoStartLive: Boolean(context.options.autoStartLive),
    profile: toClientProfile(context.options.profile),
    replaySummary: context.replayResponse?.summary,
    title: context.title
  };
}

function buildInjectInput(payload: unknown): CotInjectInput {
  if (typeof payload !== "object" || payload === null) {
    throw new CliError("Expected a JSON object request body.");
  }

  const record = payload as Record<string, unknown>;

  return {
    callsign: asString(record.callsign),
    ce: record.ce === undefined ? 9999999 : parseFiniteNumber(record.ce, "ce"),
    hae: record.hae === undefined ? 0 : parseFiniteNumber(record.hae, "hae"),
    how: asString(record.how) ?? "m-g",
    lat: parseFiniteNumber(record.lat, "latitude"),
    le: record.le === undefined ? 9999999 : parseFiniteNumber(record.le, "le"),
    lon: parseFiniteNumber(record.lon, "longitude"),
    remarks: asString(record.remarks),
    staleSeconds: record.staleSeconds === undefined ? 300 : parseFiniteNumber(record.staleSeconds, "stale-seconds"),
    type: asString(record.type) ?? "a-f-G-U-C",
    uid: asString(record.uid) ?? (() => {
      throw new CliError("Missing uid.");
    })()
  };
}

async function handleApiRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  context: MapServerContext
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/meta") {
    writeJson(response, 200, buildMetaPayload(context));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, sanitizeStatusSummary(await context.backend.getStatus()));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/targets") {
    const range = getDefaultCotTargetDateRange();
    const startDate = parseDateQueryParam(url.searchParams.get("startDate"), range.startDate);
    const endDate = parseDateQueryParam(url.searchParams.get("endDate"), range.endDate);
    const limit = parseLimit(url.searchParams.get("limit"), 50);

    try {
      writeJson(
        response,
        200,
        buildTargetsApiResponse(await context.backend.getTargets(startDate, endDate, limit), {
          degraded: false,
          source: "tak"
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (context.liveEvents.size > 0) {
        writeJson(
          response,
          200,
          buildTargetsApiResponse(buildTargetsResultFromLiveEvents(context, startDate, endDate, limit), {
            degraded: true,
            message,
            source: "live-cache"
          })
        );
        return;
      }

      writeJson(
        response,
        200,
        buildTargetsApiResponse(buildEmptyTargetsResult(context, startDate, endDate, limit), {
          degraded: true,
          message,
          source: "unavailable"
        })
      );
      return;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/query") {
    const uid = asString(url.searchParams.get("uid"));
    const cotIdRaw = url.searchParams.get("cotId");
    const cotId = cotIdRaw === null || cotIdRaw.trim() === "" ? undefined : parseLimit(cotIdRaw, 1);

    if (!uid && cotId === undefined) {
      throw new CliError("Provide either `uid` or `cotId` when querying TAK.");
    }

    writeJson(response, 200, sanitizeQueryResult(await context.backend.queryEvent({ cotId, uid })));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/replay") {
    if (!context.replayResponse) {
      writeJson(response, 404, { error: "No replay dataset is loaded." });
      return;
    }

    writeJson(response, 200, context.replayResponse);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/replay-telemetry") {
    writeJson(response, 200, {
      telemetry: (await readReplayTelemetry(context.options.profile)) ?? null
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/inject") {
    const payload = await readJsonBody(request);
    const result = sanitizeInjectResult(await context.backend.injectEvent(buildInjectInput(payload)));
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const abortController = new AbortController();
    const heartbeat = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 15000);

    response.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8"
    });
    response.write("retry: 5000\n\n");

    const closeStream = () => {
      clearInterval(heartbeat);
      abortController.abort();
      if (!response.writableEnded) {
        response.end();
      }
    };

    request.on("close", closeStream);

    try {
      await context.backend.streamEvents({
        onEvent: (event) => {
          context.liveEvents.set(event.event.uid, event);
          response.write(`event: cot\ndata: ${JSON.stringify(event)}\n\n`);
        },
        signal: abortController.signal
      });
    } catch (error) {
      if (!abortController.signal.aborted) {
        response.write(
          `event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : String(error)
          })}\n\n`
        );
      }
    } finally {
      request.off("close", closeStream);
      closeStream();
    }
    return;
  }

  writeJson(response, 404, { error: `Unknown API path: ${url.pathname}` });
}

async function handleStaticRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  context: MapServerContext
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    writeText(response, 405, "Method not allowed.");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    writeText(response, 200, buildMapHtml(context.title), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === "/app.css") {
    writeText(response, 200, mapAppCss, "text/css; charset=utf-8");
    return;
  }

  if (url.pathname === "/app.js") {
    writeText(response, 200, mapAppJs, "application/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/company-logo.svg") {
    writeText(response, 200, buildPlaceholderLogoSvg(context.logoLabel), "image/svg+xml; charset=utf-8");
    return;
  }

  if (url.pathname === "/takcli-logo.png") {
    writeBuffer(response, 200, await readMapAsset("takcli-logo.png"), "image/png");
    return;
  }

  if (url.pathname === "/codehaus.png") {
    writeBuffer(response, 200, await readMapAsset("codehaus.png"), "image/png");
    return;
  }

  if (url.pathname === "/leaflet.css") {
    writeBuffer(response, 200, await readLeafletAsset("leaflet.css"), "text/css; charset=utf-8");
    return;
  }

  if (url.pathname === "/leaflet.js") {
    writeBuffer(response, 200, await readLeafletAsset("leaflet.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/milsymbol.js") {
    writeBuffer(response, 200, await readMilsymbolAsset("milsymbol.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/leaflet/images/")) {
    const relativePath = url.pathname.slice("/leaflet/".length);
    writeBuffer(response, 200, await readLeafletAsset(relativePath), getContentType(relativePath));
    return;
  }

  writeText(response, 404, `Unknown path: ${url.pathname}`);
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: MapServerContext
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, url, context);
      return;
    }

    await handleStaticRequest(request, response, url, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      error instanceof CliError
        ? error.exitCode >= 400 && error.exitCode <= 599
          ? error.exitCode
          : 400
        : 500;
    if (!response.headersSent) {
      writeText(response, statusCode, message);
      return;
    }

    response.end();
  }
}

export async function maybeLoadReplayDataset(
  replayFile: string | undefined,
  replaySource: ReplaySourceOption
): Promise<ReplayDatasetSummary | undefined> {
  if (!replayFile) {
    return undefined;
  }

  return await loadReplayDataset(replayFile, replaySource);
}

export async function launchMapServer(
  options: MapServerOptions,
  backend: MapBackend = buildBackend(options)
): Promise<RunningMapServer> {
  const context: MapServerContext = {
    backend,
    liveEvents: new Map(),
    logoLabel: options.logoLabel ?? DEFAULT_LOGO_LABEL,
    options,
    replayResponse: options.replayDataset ? buildReplayResponse(options.replayDataset) : undefined,
    title: options.title ?? "TAKCLI Map"
  };

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, context);
  });

  const closePromise = new Promise<void>((resolve, reject) => {
    server.once("close", resolve);
    server.once("error", reject);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Map server failed to bind to a TCP port.");
  }

  const protocol = options.host.includes(":") && !options.host.startsWith("[") ? `[${options.host}]` : options.host;
  const url = `http://${protocol}:${address.port}`;

  return {
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    port: address.port,
    url,
    waitForClose: async () => await closePromise
  };
}
