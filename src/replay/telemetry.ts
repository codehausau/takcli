import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ResolvedProfile } from "../core/profile-resolution.js";
import type {
  ReplayDatasetSummary,
  ReplayProgressSnapshot,
  ReplayRunResult,
  ReplayTelemetryProfile,
  ReplayTelemetrySnapshot
} from "./types.js";

function toTelemetryProfile(profile: ResolvedProfile): ReplayTelemetryProfile {
  return {
    cotPort: profile.ports.cot,
    name: profile.name,
    server: profile.server
  };
}

function buildReplayTelemetryKey(profile: ResolvedProfile): string {
  return `${profile.server}|${profile.ports.cot}`;
}

export function getReplayTelemetryFilePath(profile: ResolvedProfile): string {
  const hash = createHash("sha1").update(buildReplayTelemetryKey(profile)).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `takcli-replay-telemetry-${hash}.json`);
}

function buildBaseSnapshot(
  dataset: ReplayDatasetSummary,
  profile: ResolvedProfile,
  speed: number,
  maxEvents: number | undefined,
  startedAt: string,
  startFromTime: string
): ReplayTelemetrySnapshot {
  return {
    dataset: {
      detectedSource: dataset.detectedSource,
      endTime: dataset.endTime,
      filePath: dataset.filePath,
      startTime: dataset.startTime,
      trackPoints: dataset.trackPoints.length
    },
    maxEvents,
    profile: toTelemetryProfile(profile),
    currentLoop: 1,
    sentEvents: 0,
    speed,
    startedAt,
    startFromTime,
    state: "idle",
    updatedAt: startedAt
  };
}

async function writeSnapshot(profile: ResolvedProfile, snapshot: ReplayTelemetrySnapshot): Promise<void> {
  await writeFile(getReplayTelemetryFilePath(profile), JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
}

export async function readReplayTelemetry(
  profile: ResolvedProfile
): Promise<ReplayTelemetrySnapshot | undefined> {
  try {
    const raw = await readFile(getReplayTelemetryFilePath(profile), "utf8");
    return JSON.parse(raw) as ReplayTelemetrySnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

export async function clearReplayTelemetry(profile: ResolvedProfile): Promise<void> {
  await rm(getReplayTelemetryFilePath(profile), { force: true });
}

export function createReplayTelemetryPublisher(options: {
  dataset: ReplayDatasetSummary;
  maxEvents?: number;
  profile: ResolvedProfile;
  speed: number;
  startFromTime: string;
}) {
  let snapshot = buildBaseSnapshot(
    options.dataset,
    options.profile,
    options.speed,
    options.maxEvents,
    new Date().toISOString(),
    options.startFromTime
  );
  let writeChain = Promise.resolve();

  const queueWrite = async (nextSnapshot: ReplayTelemetrySnapshot) => {
    snapshot = nextSnapshot;
    writeChain = writeChain.then(async () => {
      await writeSnapshot(options.profile, nextSnapshot);
    });
    await writeChain;
  };

  return {
    initialize: async () => {
      await queueWrite(snapshot);
    },
    onRunCompleted: async (result: ReplayRunResult) => {
      await queueWrite({
        ...snapshot,
        completedAt: result.completedAt,
        currentSourceTime: result.finalTrackPointTime,
        sentEvents: result.sentEvents,
        state: result.state,
        updatedAt: result.completedAt
      });
    },
    onStateChange: async (progress: ReplayProgressSnapshot) => {
      const updatedAt = new Date().toISOString();
      await queueWrite({
        ...snapshot,
        currentSourceTime: progress.effectiveSourceTime ?? progress.trackPoint?.sourceTime ?? snapshot.currentSourceTime,
        currentLoop: progress.currentLoop,
        currentUid: progress.trackPoint?.uid ?? snapshot.currentUid,
        sentEvents: progress.sentEvents,
        state:
          progress.state === "running" && progress.paused
            ? "paused"
            : progress.state,
        updatedAt
      });
    },
    onRunFailed: async () => {
      await queueWrite({
        ...snapshot,
        state: "stopped",
        updatedAt: new Date().toISOString()
      });
    }
  };
}
