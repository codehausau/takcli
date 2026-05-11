import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedConfig } from "../../src/core/config-store.js";
import type { ResolvedProfile } from "../../src/core/profile-resolution.js";
import { launchMapServer } from "../../src/map/service.js";
import { clearReplayTelemetry, createReplayTelemetryPublisher } from "../../src/replay/telemetry.js";
import type { ReplayDatasetSummary } from "../../src/replay/types.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
  await clearReplayTelemetry(createProfile());
});

function createLoadedConfig(): LoadedConfig {
  return {
    config: {
      currentProfile: "local",
      profiles: {},
      schemaVersion: 1
    },
    exists: true,
    path: "/tmp/takcli-config.yaml"
  };
}

function createProfile(): ResolvedProfile {
  return {
    auth: {
      password: "secret-password",
      username: "operator"
    },
    host: "tak.example.internal",
    name: "local",
    ports: {
      api: 8446,
      cot: 8089,
      enrollment: 8443,
      federation: 8444
    },
    server: "https://tak.example.internal:8446",
    source: "named",
    tls: {
      caFile: "/tmp/ca.pem",
      certFile: "/tmp/client.pem",
      insecureSkipVerify: true,
      keyFile: "/tmp/client-key.pem"
    },
    url: new URL("https://tak.example.internal:8446")
  };
}

function createReplayDataset(): ReplayDatasetSummary {
  return {
    detectedSource: "geojson-vessel-tracks",
    endTime: "2026-03-01T01:00:00.000Z",
    endTimeMs: Date.parse("2026-03-01T01:00:00.000Z"),
    filePath: "/tmp/replay.geojson",
    skippedFeatures: 0,
    startTime: "2026-03-01T00:00:00.000Z",
    startTimeMs: Date.parse("2026-03-01T00:00:00.000Z"),
    totalFeatures: 2,
    trackPoints: [
      {
        callsign: "Vessel Alpha",
        craftId: "A100",
        lat: -34.9,
        lon: 138.6,
        sourceTime: "2026-03-01T00:00:00.000Z",
        sourceTimeMs: Date.parse("2026-03-01T00:00:00.000Z"),
        subtype: "Harbor support",
        type: "Tug",
        uid: "replay-vessel-alpha"
      },
      {
        callsign: "Vessel Alpha",
        craftId: "A100",
        lat: -35.0,
        lon: 138.7,
        sourceTime: "2026-03-01T01:00:00.000Z",
        sourceTimeMs: Date.parse("2026-03-01T01:00:00.000Z"),
        subtype: "Harbor support",
        type: "Tug",
        uid: "replay-vessel-alpha"
      }
    ]
  };
}

describe("Map server", () => {
  it("serves the UI shell and safe API payloads", async () => {
    const getTargets = vi.fn(async (startDate: string, endDate: string, limit: number) => ({
      command: "cot targets" as const,
      configPath: "/tmp/takcli-config.yaml",
      endDate,
      generatedAt: "2026-03-01T03:00:00.000Z",
      limit,
      profile: createProfile(),
      startDate,
      targets: [
        {
          callsign: "Eagle 1",
          lat: -34.91,
          lon: 138.61,
          time: "2026-03-01T02:59:00.000Z",
          type: "a-f-G-U-C",
          uid: "eagle-1"
        }
      ]
    }));
    const injectEvent = vi.fn(async (input) => ({
      bytesSent: 182,
      command: "cot inject" as const,
      configPath: "/tmp/takcli-config.yaml",
      event: {
        how: input.how,
        point: {
          ce: input.ce,
          hae: input.hae,
          lat: input.lat,
          le: input.le,
          lon: input.lon
        },
        rawXml: "<event />",
        remarks: input.remarks,
        time: "2026-03-01T04:00:00.000Z",
        type: input.type,
        uid: input.uid
      },
      generatedAt: "2026-03-01T04:00:00.000Z",
      profile: createProfile()
    }));
    const queryEvent = vi.fn(async ({ cotId, uid }: { cotId?: number; uid?: string }) => ({
      command: "cot query" as const,
      configPath: "/tmp/takcli-config.yaml",
      event: {
        callsign: "Query Eagle",
        how: "m-g",
        point: {
          ce: 12,
          hae: 0,
          lat: -34.92,
          le: 18,
          lon: 138.62
        },
        rawXml: "<event />",
        remarks: "Source time: 2026-03-01T02:58:00.000Z | Source: replay file",
        time: "2026-03-01T03:01:00.000Z",
        type: "a-u-S-X-M",
        uid: uid ?? `cot-${cotId}`
      },
      generatedAt: "2026-03-01T03:01:00.000Z",
      lookup: {
        cotId,
        uid
      },
      profile: createProfile(),
      rawXml: "<event />"
    }));
    const server = await launchMapServer(
      {
        config: createLoadedConfig(),
        host: "127.0.0.1",
        logoLabel: "Acme Placeholder",
        port: 0,
        profile: createProfile(),
        replayDataset: createReplayDataset(),
        timeoutMs: 5000,
        title: "Acme TAK Console"
      },
      {
        getStatus: async () => ({
          command: "status" as const,
          configPath: "/tmp/takcli-config.yaml",
          dns: {
            address: "127.0.0.1",
            durationMs: 3,
            family: 4,
            ok: true
          },
          endpoints: [
            {
              http: {
                durationMs: 9,
                ok: true,
                statusCode: 200,
                statusMessage: "OK",
                url: "https://tak.example.internal:8446"
              },
              name: "api" as const,
              port: 8446,
              tcp: {
                durationMs: 4,
                host: "tak.example.internal",
                ok: true,
                port: 8446
              },
              tls: {
                durationMs: 5,
                ok: true
              }
            }
          ],
          generatedAt: "2026-03-01T03:00:00.000Z",
          ok: true,
          overall: "healthy" as const,
          profile: createProfile()
        }),
        getTargets,
        injectEvent,
        queryEvent,
        streamEvents: async ({ onEvent }) => {
          onEvent({
            command: "cot follow",
            configPath: "/tmp/takcli-config.yaml",
            event: {
              how: "m-g",
              point: {
                ce: 10,
                hae: 0,
                lat: -34.95,
                le: 15,
                lon: 138.65
              },
              rawXml: "<event />",
              time: "2026-03-01T03:30:00.000Z",
              type: "a-f-G-U-C",
              uid: "live-1"
            },
            generatedAt: "2026-03-01T03:30:00.000Z",
            profile: createProfile(),
            sequence: 1
          });
        }
      }
    );
    servers.push(server);

    const shellResponse = await fetch(`${server.url}/`);
    const shellHtml = await shellResponse.text();
    expect(shellResponse.status).toBe(200);
    expect(shellHtml).toContain("Acme TAK Console");
    expect(shellHtml).toContain("Company Logo Slot");
    expect(shellHtml).toContain("/takcli-logo.png");
    expect(shellHtml).toContain("TAKCLI");
    expect(shellHtml).toContain("/leaflet.js");
    expect(shellHtml).toContain("/milsymbol.js");
    expect(shellHtml).toContain("Marker Symbology");
    expect(shellHtml).toContain("2525-style");
    expect(shellHtml).toContain("Primary workflow:");
    expect(shellHtml).toContain("secondary inspection and demo mode");
    expect(shellHtml).toContain("Source pending");
    expect(shellHtml).toContain("Hide Sidebar");
    expect(shellHtml).toContain("aria-controls=\"map-sidebar\"");
    expect(shellHtml).toContain("Powered by");
    expect(shellHtml).toContain("/codehaus.png");
    expect(shellHtml).toContain("Layers");
    expect(shellHtml).toContain("Live markers");
    expect(shellHtml).toContain("Live tracks");
    expect(shellHtml).toContain("Replay tracks");
    expect(shellHtml).toContain("History overlays");
    expect(shellHtml).toContain("TAK Actions");
    expect(shellHtml).toContain("Lookup UID");
    expect(shellHtml).toContain("Lookup CoT ID");
    expect(shellHtml).toContain("Connection State");
    expect(shellHtml).toContain("CoT Stream");
    expect(shellHtml).toContain("HTTP Lookup");
    expect(shellHtml).toContain("2525 / Maritime Legend");
    expect(shellHtml).toContain("Affiliation Frames");
    expect(shellHtml).toContain("Law enforcement");
    expect(shellHtml).toContain("Injection Status");
    expect(shellHtml).toContain("Last Source Time");

    const appJsResponse = await fetch(`${server.url}/app.js`);
    const appJs = await appJsResponse.text();
    expect(appJsResponse.status).toBe(200);
    expect(appJs).toContain("Replay via TAK");
    expect(appJs).toContain("Live CoT Cache");
    expect(appJs).toContain("TAK Lookup");
    expect(appJs).toContain("TAK Event Time");
    expect(appJs).toContain("Overlay Time");
    expect(appJs).toContain("sidebar-hidden");
    expect(appJs).toContain("XMC---");
    expect(appJs).toContain("XMT---");
    expect(appJs).toContain("XL----");

    const metaResponse = await fetch(`${server.url}/api/meta`);
    const meta = await metaResponse.json() as {
      autoStartLive?: boolean;
      profile: { auth?: unknown; name?: string; tls: { clientCertificateConfigured: boolean } };
      replaySummary?: { trackPoints: number; vesselCount: number };
    };
    expect(meta.autoStartLive).toBe(false);
    expect(meta.profile.name).toBe("local");
    expect(meta.profile.auth).toBeUndefined();
    expect(meta.profile.tls.clientCertificateConfigured).toBe(true);
    expect(meta.replaySummary?.trackPoints).toBe(2);
    expect(meta.replaySummary?.vesselCount).toBe(1);

    const statusResponse = await fetch(`${server.url}/api/status`);
    const status = await statusResponse.json() as { overall: string; profile: { auth?: unknown } };
    expect(status.overall).toBe("healthy");
    expect(status.profile.auth).toBeUndefined();

    const targetsResponse = await fetch(
      `${server.url}/api/targets?startDate=2026-03-01&endDate=2026-03-02&limit=25`
    );
    const targets = await targetsResponse.json() as { targets: Array<{ uid: string }> };
    expect(targets.targets[0]?.uid).toBe("eagle-1");
    expect(getTargets).toHaveBeenCalledWith("2026-03-01", "2026-03-02", 25);

    const injectResponse = await fetch(`${server.url}/api/inject`, {
      body: JSON.stringify({
        lat: -34.9,
        lon: 138.6,
        remarks: "Sent from test",
        uid: "test-alpha"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const injectResult = await injectResponse.json() as { event: { how: string; type: string; uid: string } };
    expect(injectResult.event.uid).toBe("test-alpha");
    expect(injectResult.event.how).toBe("m-g");
    expect(injectResult.event.type).toBe("a-f-G-U-C");
    expect(injectEvent).toHaveBeenCalled();

    const queryResponse = await fetch(`${server.url}/api/query?uid=query-eagle`);
    const query = await queryResponse.json() as { event: { uid: string }; lookup: { uid?: string } };
    expect(query.event.uid).toBe("query-eagle");
    expect(query.lookup.uid).toBe("query-eagle");
    expect(queryEvent).toHaveBeenCalledWith({ cotId: undefined, uid: "query-eagle" });

    const replayResponse = await fetch(`${server.url}/api/replay`);
    const replay = await replayResponse.json() as {
      fullHistoryGeojson: { features: Array<{ geometry?: { type?: string } }> };
      summary: { vesselCount: number };
      vessels: Array<{ trackPoints: Array<{ craftId?: string; sourceTimeMs: number; subtype?: string; type?: string }>; uid: string }>;
    };
    expect(replay.summary.vesselCount).toBe(1);
    expect(replay.vessels[0]?.uid).toBe("replay-vessel-alpha");
    expect(replay.vessels[0]?.trackPoints).toHaveLength(2);
    expect(replay.vessels[0]?.trackPoints[0]).toMatchObject({
      craftId: "A100",
      subtype: "Harbor support",
      type: "Tug"
    });
    expect(replay.fullHistoryGeojson.features[0]?.geometry?.type).toBe("LineString");

    const logoResponse = await fetch(`${server.url}/company-logo.svg`);
    const logoText = await logoResponse.text();
    expect(logoText).toContain("Acme Placeholder");

    const takCliLogoResponse = await fetch(`${server.url}/takcli-logo.png`);
    expect(takCliLogoResponse.headers.get("content-type")).toContain("image/png");
    expect((await takCliLogoResponse.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const codehausLogoResponse = await fetch(`${server.url}/codehaus.png`);
    expect(codehausLogoResponse.headers.get("content-type")).toContain("image/png");
    expect((await codehausLogoResponse.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const eventsResponse = await fetch(`${server.url}/api/events`);
    const eventStreamText = await eventsResponse.text();
    expect(eventStreamText).toContain("event: cot");
    expect(eventStreamText).toContain("\"uid\":\"live-1\"");
  });

  it("surfaces the auto-start-live hint in metadata", async () => {
    const server = await launchMapServer({
      autoStartLive: true,
      config: createLoadedConfig(),
      host: "127.0.0.1",
      port: 0,
      profile: createProfile(),
      timeoutMs: 5000,
      title: "Auto Live"
    }, {
      getStatus: async () => ({
        command: "status" as const,
        configPath: "/tmp/takcli-config.yaml",
        dns: { durationMs: 1, ok: true },
        endpoints: [],
        generatedAt: "2026-03-01T03:00:00.000Z",
        ok: true,
        overall: "healthy" as const,
        profile: createProfile()
      }),
      getTargets: async () => ({
        command: "cot targets" as const,
        configPath: "/tmp/takcli-config.yaml",
        endDate: "2026-03-01",
        generatedAt: "2026-03-01T03:00:00.000Z",
        limit: 50,
        profile: createProfile(),
        startDate: "2026-02-29",
        targets: []
      }),
      injectEvent: async () => {
        throw new Error("not used");
      },
      queryEvent: async () => {
        throw new Error("not used");
      },
      streamEvents: async () => {}
    });
    servers.push(server);

    const meta = await (await fetch(`${server.url}/api/meta`)).json() as { autoStartLive?: boolean };
    expect(meta.autoStartLive).toBe(true);
  });

  it("falls back to cached live contacts when the TAK targets lookup fails", async () => {
    const server = await launchMapServer({
      autoStartLive: true,
      config: createLoadedConfig(),
      host: "127.0.0.1",
      port: 0,
      profile: createProfile(),
      timeoutMs: 5000,
      title: "Live Cache Fallback"
    }, {
      getStatus: async () => ({
        command: "status" as const,
        configPath: "/tmp/takcli-config.yaml",
        dns: { durationMs: 1, ok: true },
        endpoints: [],
        generatedAt: "2026-03-01T03:00:00.000Z",
        ok: true,
        overall: "healthy" as const,
        profile: createProfile()
      }),
      getTargets: async () => {
        throw new Error("TAK endpoint /api/uidsearch returned HTTP 403");
      },
      injectEvent: async () => {
        throw new Error("not used");
      },
      queryEvent: async () => {
        throw new Error("not used");
      },
      streamEvents: async ({ onEvent }) => {
        onEvent({
          command: "cot follow",
          configPath: "/tmp/takcli-config.yaml",
          event: {
            callsign: "Fallback Contact",
            how: "m-g",
            point: {
              ce: 10,
              hae: 0,
              lat: -34.95,
              le: 15,
              lon: 138.65
            },
            rawXml: "<event />",
            time: "2026-03-01T03:30:00.000Z",
            type: "a-u-S-X-M",
            uid: "fallback-1"
          },
          generatedAt: "2026-03-01T03:30:00.000Z",
          profile: createProfile(),
          sequence: 1
        });
      }
    });
    servers.push(server);

    const eventsResponse = await fetch(`${server.url}/api/events`);
    const eventStreamText = await eventsResponse.text();
    expect(eventStreamText).toContain("\"uid\":\"fallback-1\"");

    const targetsResponse = await fetch(`${server.url}/api/targets`);
    expect(targetsResponse.status).toBe(200);
    const targets = await targetsResponse.json() as {
      lookup: { degraded: boolean; message?: string; source: string };
      targets: Array<{ callsign?: string; uid: string }>;
    };
    expect(targets.lookup).toEqual({
      degraded: true,
      message: "TAK endpoint /api/uidsearch returned HTTP 403",
      source: "live-cache"
    });
    expect(targets.targets).toEqual([
      {
        callsign: "Fallback Contact",
        lat: -34.95,
        lon: 138.65,
        time: "2026-03-01T03:30:00.000Z",
        type: "a-u-S-X-M",
        uid: "fallback-1"
      }
    ]);
  });

  it("returns an empty degraded targets payload instead of a 500 when TAK lookup fails before live cache exists", async () => {
    const server = await launchMapServer({
      config: createLoadedConfig(),
      host: "127.0.0.1",
      port: 0,
      profile: createProfile(),
      timeoutMs: 5000,
      title: "Lookup Unavailable"
    }, {
      getStatus: async () => ({
        command: "status" as const,
        configPath: "/tmp/takcli-config.yaml",
        dns: { durationMs: 1, ok: true },
        endpoints: [],
        generatedAt: "2026-03-01T03:00:00.000Z",
        ok: true,
        overall: "healthy" as const,
        profile: createProfile()
      }),
      getTargets: async () => {
        throw new Error("TAK endpoint /api/uidsearch returned HTTP 403");
      },
      injectEvent: async () => {
        throw new Error("not used");
      },
      queryEvent: async () => {
        throw new Error("not used");
      },
      streamEvents: async () => {}
    });
    servers.push(server);

    const targetsResponse = await fetch(`${server.url}/api/targets`);
    expect(targetsResponse.status).toBe(200);
    const targets = await targetsResponse.json() as {
      lookup: { degraded: boolean; message?: string; source: string };
      targets: Array<{ uid: string }>;
    };
    expect(targets.lookup).toEqual({
      degraded: true,
      message: "TAK endpoint /api/uidsearch returned HTTP 403",
      source: "unavailable"
    });
    expect(targets.targets).toEqual([]);
  });

  it("serves replay telemetry for the current TAK profile", async () => {
    const dataset = createReplayDataset();
    const publisher = createReplayTelemetryPublisher({
      dataset,
      maxEvents: 25,
      profile: createProfile(),
      speed: 3600,
      startFromTime: dataset.trackPoints[0]!.sourceTime
    });
    await publisher.initialize();
    await publisher.onStateChange({
      currentLoop: 1,
      paused: false,
      sentEvents: 7,
      state: "running",
      timeMode: "source",
      trackPoint: dataset.trackPoints[1]
    });

    const server = await launchMapServer({
      config: createLoadedConfig(),
      host: "127.0.0.1",
      port: 0,
      profile: createProfile(),
      timeoutMs: 5000,
      title: "Replay Telemetry"
    }, {
      getStatus: async () => ({
        command: "status" as const,
        configPath: "/tmp/takcli-config.yaml",
        dns: { durationMs: 1, ok: true },
        endpoints: [],
        generatedAt: "2026-03-01T03:00:00.000Z",
        ok: true,
        overall: "healthy" as const,
        profile: createProfile()
      }),
      getTargets: async () => ({
        command: "cot targets" as const,
        configPath: "/tmp/takcli-config.yaml",
        endDate: "2026-03-01",
        generatedAt: "2026-03-01T03:00:00.000Z",
        limit: 50,
        profile: createProfile(),
        startDate: "2026-02-29",
        targets: []
      }),
      injectEvent: async () => {
        throw new Error("not used");
      },
      queryEvent: async () => {
        throw new Error("not used");
      },
      streamEvents: async () => {}
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/replay-telemetry`);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      telemetry: {
        currentSourceTime?: string;
        sentEvents: number;
        speed: number;
        state: string;
      } | null;
    };
    expect(payload.telemetry).toMatchObject({
      currentSourceTime: "2026-03-01T01:00:00.000Z",
      sentEvents: 7,
      speed: 3600,
      state: "running"
    });
  });
});
