import { readFile } from "node:fs/promises";
import path from "node:path";

import { CliError } from "../cli/runtime.js";
import type { ReplayDatasetSummary, ReplaySourceName, ReplaySourceOption, ReplayTrackPoint } from "./types.js";

interface GeoJsonFeatureCollection {
  features?: unknown;
  type?: unknown;
}

interface GeoJsonPointFeature {
  geometry?: {
    coordinates?: unknown;
    type?: unknown;
  };
  properties?: Record<string, unknown>;
  type?: unknown;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseSourceTimestamp(value: unknown): { iso: string; timeMs: number } | undefined {
  const direct = asString(value);
  if (!direct) {
    return undefined;
  }

  const parsedDirect = Date.parse(direct);
  if (!Number.isNaN(parsedDirect)) {
    return {
      iso: new Date(parsedDirect).toISOString(),
      timeMs: parsedDirect
    };
  }

  const match = direct.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (!match) {
    return undefined;
  }

  const [, dayValue, monthValue, yearValue, hourValue, minuteValue, secondValue, meridiemValue] = match;
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  let hour = hourValue ? Number(hourValue) : 0;
  const minute = minuteValue ? Number(minuteValue) : 0;
  const second = secondValue ? Number(secondValue) : 0;
  const meridiem = meridiemValue?.toUpperCase();

  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  } else if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }

  const timeMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return {
    iso: new Date(timeMs).toISOString(),
    timeMs
  };
}

function sanitizeUidPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "unknown";
}

function buildTrackPoint(feature: GeoJsonPointFeature, index: number): ReplayTrackPoint | undefined {
  if (feature.type !== "Feature") {
    return undefined;
  }

  if (feature.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) {
    return undefined;
  }

  const [lonValue, latValue] = feature.geometry.coordinates;
  const lon = asFiniteNumber(lonValue);
  const lat = asFiniteNumber(latValue);
  if (lon === undefined || lat === undefined) {
    return undefined;
  }

  const properties = isRecord(feature.properties) ? feature.properties : {};
  const parsedTime =
    parseSourceTimestamp(properties.timestampIsoUtc) ?? parseSourceTimestamp(properties.timestamp);
  if (!parsedTime) {
    return undefined;
  }

  const craftIdRaw = properties.craftId ?? properties.CRAFT_ID;
  const craftId = craftIdRaw !== undefined && craftIdRaw !== null ? String(craftIdRaw) : undefined;
  const vesselType = asString(properties.type ?? properties.TYPE);
  const subtype = asString(properties.subtype ?? properties.SUBTYPE);
  const uidSuffix = craftId ?? `feature-${index + 1}`;

  const speedKnots = asFiniteNumber(properties.speedKnots ?? properties.SPEED);
  const course = asFiniteNumber(properties.course ?? properties.COURSE);

  return {
    beamMeters: asFiniteNumber(properties.beamMeters ?? properties.BEAM),
    callsign: craftId ? `Vessel ${craftId}` : `Vessel ${index + 1}`,
    course,
    craftId,
    draughtMeters: asFiniteNumber(properties.draughtMeters ?? properties.DRAUGHT),
    lat,
    lengthMeters: asFiniteNumber(properties.lengthMeters ?? properties.LENGTH),
    lon,
    sourceTime: parsedTime.iso,
    sourceTimeMs: parsedTime.timeMs,
    speedKnots,
    speedMetersPerSecond: speedKnots !== undefined ? speedKnots * 0.514444 : undefined,
    subtype,
    type: vesselType,
    uid: `replay-vessel-${sanitizeUidPart(uidSuffix)}`
  };
}

function detectGeoJsonVesselTracks(collection: GeoJsonFeatureCollection): ReplaySourceName | undefined {
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    return undefined;
  }

  for (const feature of collection.features.slice(0, 10)) {
    if (!isRecord(feature)) {
      continue;
    }

    const candidate = feature as GeoJsonPointFeature;
    if (candidate.type !== "Feature") {
      continue;
    }

    if (candidate.geometry?.type !== "Point") {
      continue;
    }

    const properties = isRecord(candidate.properties) ? candidate.properties : {};
    if ("timestampIsoUtc" in properties || "timestamp" in properties || "craftId" in properties) {
      return "geojson-vessel-tracks";
    }
  }

  return undefined;
}

async function readReplaySourceText(filePath: string): Promise<string> {
  if (!isHttpUrl(filePath)) {
    return await readFile(filePath, "utf8");
  }

  const response = await fetch(filePath);
  if (!response.ok) {
    throw new CliError(
      `Replay source request failed for ${filePath}: HTTP ${response.status} ${response.statusText}`.trim()
    );
  }

  return await response.text();
}

function getReplaySourceExtension(filePath: string): string {
  if (!isHttpUrl(filePath)) {
    return path.extname(filePath).toLowerCase();
  }

  const url = new URL(filePath);
  return path.extname(url.pathname).toLowerCase();
}

export async function detectReplaySource(
  filePath: string,
  requestedSource: ReplaySourceOption
): Promise<ReplaySourceName> {
  if (requestedSource !== "auto") {
    return requestedSource;
  }

  const extension = getReplaySourceExtension(filePath);
  if (extension !== ".geojson" && extension !== ".json") {
    throw new CliError(
      `Could not auto-detect replay source for ${filePath}. Try --source geojson-vessel-tracks.`
    );
  }

  const raw = await readReplaySourceText(filePath);
  const parsed = JSON.parse(raw) as GeoJsonFeatureCollection;
  const detected = detectGeoJsonVesselTracks(parsed);
  if (!detected) {
    throw new CliError(
      `Could not auto-detect a supported replay source in ${filePath}. Supported sources: geojson-vessel-tracks.`
    );
  }

  return detected;
}

export async function loadReplayDataset(
  filePath: string,
  requestedSource: ReplaySourceOption
): Promise<ReplayDatasetSummary> {
  const detectedSource = await detectReplaySource(filePath, requestedSource);
  const raw = await readReplaySourceText(filePath);
  const parsed = JSON.parse(raw) as GeoJsonFeatureCollection;

  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new CliError(`Replay source ${filePath} is not a valid GeoJSON FeatureCollection.`);
  }

  const trackPoints: ReplayTrackPoint[] = [];
  let skippedFeatures = 0;

  parsed.features.forEach((feature, index) => {
    if (!isRecord(feature)) {
      skippedFeatures += 1;
      return;
    }

    const trackPoint = buildTrackPoint(feature as GeoJsonPointFeature, index);
    if (!trackPoint) {
      skippedFeatures += 1;
      return;
    }

    trackPoints.push(trackPoint);
  });

  trackPoints.sort((left, right) =>
    left.sourceTimeMs === right.sourceTimeMs
      ? left.uid.localeCompare(right.uid)
      : left.sourceTimeMs - right.sourceTimeMs
  );

  if (trackPoints.length === 0) {
    throw new CliError(`Replay source ${filePath} did not contain any valid track points.`);
  }

  return {
    detectedSource,
    endTime: trackPoints[trackPoints.length - 1]!.sourceTime,
    endTimeMs: trackPoints[trackPoints.length - 1]!.sourceTimeMs,
    filePath,
    skippedFeatures,
    startTime: trackPoints[0]!.sourceTime,
    startTimeMs: trackPoints[0]!.sourceTimeMs,
    totalFeatures: parsed.features.length,
    trackPoints
  };
}
