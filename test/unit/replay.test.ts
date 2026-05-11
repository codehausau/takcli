import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";

import { describe, expect, it } from "vitest";

import { loadReplayDataset } from "../../src/replay/geojson.js";
import { interpolateReplayDataset } from "../../src/replay/interpolation.js";
import { resolveReplayStartIndex } from "../../src/replay/service.js";

async function writeReplayFixture(content: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "takcli-replay-"));
  const filePath = path.join(dir, "tracks.geojson");
  await writeFile(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

async function withHttpFixture(
  content: unknown,
  callback: (url: string) => Promise<void>
): Promise<void> {
  const payload = JSON.stringify(content);
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "application/geo+json" });
    res.end(payload);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IP address.");
  }

  try {
    await callback(`http://127.0.0.1:${address.port}/tracks.geojson`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("Replay dataset loading", () => {
  it("loads and sorts GeoJSON vessel tracks while skipping invalid features", async () => {
    const filePath = await writeReplayFixture({
      features: [
        {
          geometry: {
            coordinates: [138.7, -34.9],
            type: "Point"
          },
          properties: {
            craftId: "bravo",
            timestampIsoUtc: "2026-03-01T01:00:00Z",
            type: "Cargo"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.6, -34.8],
            type: "Point"
          },
          properties: {
            craftId: "alpha",
            timestampIsoUtc: "2026-03-01T00:00:00Z",
            type: "Sailing"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.5, -34.7],
            type: "Point"
          },
          properties: {
            craftId: "invalid"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    });

    const dataset = await loadReplayDataset(filePath, "auto");

    expect(dataset.detectedSource).toBe("geojson-vessel-tracks");
    expect(dataset.totalFeatures).toBe(3);
    expect(dataset.skippedFeatures).toBe(1);
    expect(dataset.trackPoints).toHaveLength(2);
    expect(dataset.trackPoints[0]?.uid).toBe("replay-vessel-alpha");
    expect(dataset.trackPoints[1]?.uid).toBe("replay-vessel-bravo");
    expect(dataset.startTime).toBe("2026-03-01T00:00:00.000Z");
    expect(dataset.endTime).toBe("2026-03-01T01:00:00.000Z");
  });

  it("resolves start-from positions from keywords and timestamps", async () => {
    const filePath = await writeReplayFixture({
      features: [
        {
          geometry: {
            coordinates: [138.6, -34.8],
            type: "Point"
          },
          properties: {
            craftId: "alpha",
            timestampIsoUtc: "2026-03-01T00:00:00Z"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.7, -34.9],
            type: "Point"
          },
          properties: {
            craftId: "bravo",
            timestampIsoUtc: "2026-03-01T02:00:00Z"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.8, -35.0],
            type: "Point"
          },
          properties: {
            craftId: "charlie",
            timestampIsoUtc: "2026-03-01T04:00:00Z"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    });

    const dataset = await loadReplayDataset(filePath, "auto");

    expect(resolveReplayStartIndex(dataset, "start")).toBe(0);
    expect(resolveReplayStartIndex(dataset, "end")).toBe(2);
    expect(resolveReplayStartIndex(dataset, "2026-03-01T01:00:00Z")).toBe(1);
  });

  it("interpolates sparse vessel updates without crossing vessel tracks", async () => {
    const filePath = await writeReplayFixture({
      features: [
        {
          geometry: {
            coordinates: [138.0, -34.0],
            type: "Point"
          },
          properties: {
            course: 10,
            craftId: "alpha",
            speedKnots: 5,
            timestampIsoUtc: "2026-03-01T00:00:00Z"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [139.0, -33.0],
            type: "Point"
          },
          properties: {
            craftId: "bravo",
            timestampIsoUtc: "2026-03-01T00:30:00Z"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [138.2, -33.8],
            type: "Point"
          },
          properties: {
            course: 20,
            craftId: "alpha",
            speedKnots: 7,
            timestampIsoUtc: "2026-03-01T01:00:00Z"
          },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    });

    const dataset = await loadReplayDataset(filePath, "auto");
    const interpolated = interpolateReplayDataset(dataset, 30 * 60 * 1000);

    expect(interpolated.interpolation).toEqual({
      generatedTrackPoints: 1,
      intervalMs: 30 * 60 * 1000,
      originalTrackPoints: 3
    });
    expect(interpolated.trackPoints).toHaveLength(4);

    const alphaPoints = interpolated.trackPoints.filter((point) => point.uid === "replay-vessel-alpha");
    expect(alphaPoints).toHaveLength(3);
    expect(alphaPoints[1]).toMatchObject({
      course: 15,
      interpolated: true,
      lat: -33.9,
      lon: 138.1,
      sourceTime: "2026-03-01T00:30:00.000Z",
      speedKnots: 6,
      uid: "replay-vessel-alpha"
    });

    const bravoPoints = interpolated.trackPoints.filter((point) => point.uid === "replay-vessel-bravo");
    expect(bravoPoints).toHaveLength(1);
    expect(bravoPoints[0]?.interpolated).toBeUndefined();
  });

  it("loads GeoJSON vessel tracks from an HTTP URL", async () => {
    await withHttpFixture(
      {
        features: [
          {
            geometry: {
              coordinates: [138.6, -34.8],
              type: "Point"
            },
            properties: {
              craftId: "alpha",
              timestampIsoUtc: "2026-03-01T00:00:00Z"
            },
            type: "Feature"
          }
        ],
        type: "FeatureCollection"
      },
      async (url) => {
        const dataset = await loadReplayDataset(url, "auto");

        expect(dataset.filePath).toBe(url);
        expect(dataset.detectedSource).toBe("geojson-vessel-tracks");
        expect(dataset.trackPoints).toHaveLength(1);
        expect(dataset.trackPoints[0]?.uid).toBe("replay-vessel-alpha");
      }
    );
  });
});
