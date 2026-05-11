import { setTimeout as delay } from "node:timers/promises";

import type { ResolvedProfile } from "../core/profile-resolution.js";
import { openCotEventWriter } from "../tak/cot/stream.js";
import { buildCotEventXml } from "../tak/cot/xml.js";
import { CliError } from "../cli/runtime.js";
import type {
  ReplayDatasetSummary,
  ReplayProgressSnapshot,
  ReplayRunOptions,
  ReplayRunResult,
  ReplayRunner,
  ReplayTrackPoint
} from "./types.js";

const POLL_INTERVAL_MS = 100;

function buildReplayRemarks(trackPoint: ReplayTrackPoint, sourceTime: string): string {
  const parts = [
    `Source time: ${sourceTime}`,
    trackPoint.type ? `Type: ${trackPoint.type}` : undefined,
    trackPoint.subtype ? `Subtype: ${trackPoint.subtype}` : undefined,
    trackPoint.lengthMeters !== undefined ? `Length: ${trackPoint.lengthMeters}m` : undefined,
    trackPoint.beamMeters !== undefined ? `Beam: ${trackPoint.beamMeters}m` : undefined,
    trackPoint.draughtMeters !== undefined ? `Draught: ${trackPoint.draughtMeters}m` : undefined,
    trackPoint.craftId ? `Craft ID: ${trackPoint.craftId}` : undefined,
    trackPoint.interpolated ? "Interpolated: yes" : undefined,
    "Source: replay file"
  ];

  return parts.filter(Boolean).join(" | ");
}

function lowerBoundTrackPointIndex(trackPoints: ReplayTrackPoint[], timeMs: number): number {
  let low = 0;
  let high = trackPoints.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trackPoints[middle]!.sourceTimeMs < timeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return Math.min(low, trackPoints.length - 1);
}

export function resolveReplayStartIndex(dataset: ReplayDatasetSummary, startFrom?: string): number {
  if (!startFrom || startFrom === "start") {
    return 0;
  }

  if (startFrom === "end") {
    return dataset.trackPoints.length - 1;
  }

  const parsed = Date.parse(startFrom);
  if (Number.isNaN(parsed)) {
    throw new CliError(
      `Invalid --start-from value: ${startFrom}. Use start, end, or an ISO-8601 timestamp such as ${dataset.startTime}.`
    );
  }

  if (parsed < dataset.startTimeMs || parsed > dataset.endTimeMs) {
    throw new CliError(
      `Start time ${startFrom} is outside the dataset range ${dataset.startTime} to ${dataset.endTime}.`
    );
  }

  return lowerBoundTrackPointIndex(dataset.trackPoints, parsed);
}

class ReplayRunnerImpl implements ReplayRunner {
  private currentIndex: number;

  private currentLoop = 1;

  private liveLoopAnchorMs: number | undefined;

  private lastSentEffectiveSourceTime: string | undefined;

  private lastSentTrackPoint: ReplayTrackPoint | undefined;
  private paused = false;

  private pendingIndex: number | undefined;

  private sentEvents = 0;

  private state: ReplayProgressSnapshot["state"] = "idle";

  private stopRequested = false;

  constructor(
    private readonly dataset: ReplayDatasetSummary,
    private readonly options: ReplayRunOptions
  ) {
    this.currentIndex = options.startIndex;
    this.liveLoopAnchorMs = this.createLiveLoopAnchorMs();
  }

  getSnapshot(): ReplayProgressSnapshot {
    const trackPoint = this.dataset.trackPoints[this.currentIndex];
    return {
      currentLoop: this.currentLoop,
      effectiveSourceTime: trackPoint ? this.getEffectiveSourceTime(trackPoint) : undefined,
      loopCount: this.options.loopCount,
      paused: this.paused,
      pendingIndex: this.pendingIndex,
      sentEvents: this.sentEvents,
      state: this.state,
      timeMode: this.options.timeMode,
      trackPoint
    };
  }

  pause(): void {
    this.paused = true;
    this.emitStateChange();
  }

  restart(): void {
    this.pendingIndex = this.options.startIndex;
    this.emitStateChange();
  }

  resume(): void {
    this.paused = false;
    this.emitStateChange();
  }

  seekBySourceMs(offsetMs: number): void {
    const currentTimeMs =
      this.dataset.trackPoints[this.currentIndex]?.sourceTimeMs ??
      this.dataset.trackPoints[this.dataset.trackPoints.length - 1]!.sourceTimeMs;
    const targetTimeMs = Math.max(
      this.dataset.startTimeMs,
      Math.min(this.dataset.endTimeMs, currentTimeMs + offsetMs)
    );
    this.pendingIndex = lowerBoundTrackPointIndex(this.dataset.trackPoints, targetTimeMs);
    this.emitStateChange();
  }

  stop(): void {
    this.stopRequested = true;
    this.emitStateChange();
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    this.emitStateChange();
    return this.paused;
  }

  async run(): Promise<ReplayRunResult> {
    if (this.state !== "idle") {
      throw new CliError("This replay session has already been started.");
    }

    const writer = await openCotEventWriter(this.options.profile, this.options.timeoutMs);
    const startedAt = new Date().toISOString();
    this.state = "running";
    this.emitStateChange();

    try {
      while (!this.stopRequested && this.currentIndex < this.dataset.trackPoints.length) {
        if (this.applyPendingIndex()) {
          continue;
        }

        if (this.paused) {
          await delay(POLL_INTERVAL_MS);
          continue;
        }

        const trackPoint = this.dataset.trackPoints[this.currentIndex]!;
        const effectiveSourceTime = this.getEffectiveSourceTime(trackPoint);
        const xml = buildCotEventXml(
          {
            callsign: trackPoint.callsign,
            ce: 9999999,
            course: trackPoint.course,
            hae: 0,
            how: this.options.how,
            lat: trackPoint.lat,
            le: 9999999,
            lon: trackPoint.lon,
            remarks: buildReplayRemarks(trackPoint, effectiveSourceTime),
            speed: trackPoint.speedMetersPerSecond,
            staleSeconds: this.options.staleSeconds,
            type: this.options.cotType,
            uid: trackPoint.uid
          },
          new Date()
        );
        const bytesSent = await writer.send(xml);
        this.sentEvents += 1;
        this.lastSentTrackPoint = trackPoint;
        this.lastSentEffectiveSourceTime = effectiveSourceTime;
        this.options.onEventSent?.({
          bytesSent,
          sentEvents: this.sentEvents,
          trackPoint
        });
        this.emitStateChange();

        if (
          this.options.maxEvents !== undefined &&
          this.sentEvents >= this.options.maxEvents
        ) {
          break;
        }

        if (this.currentIndex >= this.dataset.trackPoints.length - 1) {
          if (!(await this.advanceLoopOrFinish())) {
            break;
          }

          continue;
        }

        const nextTrackPoint = this.dataset.trackPoints[this.currentIndex + 1]!;
        let remainingDelayMs =
          this.options.speed > 0
            ? Math.max(
                0,
                Math.round((nextTrackPoint.sourceTimeMs - trackPoint.sourceTimeMs) / this.options.speed)
              )
            : 0;
        this.currentIndex += 1;
        this.emitStateChange();

        while (remainingDelayMs > 0 && !this.stopRequested) {
          if (this.applyPendingIndex()) {
            remainingDelayMs = 0;
            break;
          }

          if (this.paused) {
            await delay(POLL_INTERVAL_MS);
            continue;
          }

          const sleepMs = Math.min(POLL_INTERVAL_MS, remainingDelayMs);
          await delay(sleepMs);
          remainingDelayMs -= sleepMs;
        }
      }
    } finally {
      await writer.close();
    }

    this.state = this.stopRequested ? "stopped" : "completed";
    this.emitStateChange();

    return {
      completedAt: new Date().toISOString(),
      dataset: {
        detectedSource: this.dataset.detectedSource,
        endTime: this.dataset.endTime,
        filePath: this.dataset.filePath,
        interpolation: this.dataset.interpolation,
        startTime: this.dataset.startTime,
        totalFeatures: this.dataset.totalFeatures,
        trackPoints: this.dataset.trackPoints.length
      },
      finalTrackPointTime: this.lastSentEffectiveSourceTime ?? this.lastSentTrackPoint?.sourceTime,
      loop: this.options.loop,
      loopCount: this.options.loopCount,
      loopDelayMs: this.options.loopDelayMs,
      maxEvents: this.options.maxEvents,
      profile: this.options.profile,
      sentEvents: this.sentEvents,
      speed: this.options.speed,
      startedAt,
      startFromTime: this.dataset.trackPoints[this.options.startIndex]!.sourceTime,
      state: this.stopRequested ? "stopped" : "completed",
      timeMode: this.options.timeMode
    };
  }

  private async advanceLoopOrFinish(): Promise<boolean> {
    if (!this.options.loop) {
      return false;
    }

    if (this.options.loopCount !== undefined && this.currentLoop >= this.options.loopCount) {
      return false;
    }

    if (this.options.loopDelayMs > 0) {
      let remainingDelayMs = this.options.loopDelayMs;
      while (remainingDelayMs > 0 && !this.stopRequested) {
        if (this.paused) {
          await delay(POLL_INTERVAL_MS);
          continue;
        }

        const sleepMs = Math.min(POLL_INTERVAL_MS, remainingDelayMs);
        await delay(sleepMs);
        remainingDelayMs -= sleepMs;
      }
    }

    if (this.stopRequested) {
      return false;
    }

    this.currentLoop += 1;
    this.currentIndex = this.options.startIndex;
    this.liveLoopAnchorMs = this.createLiveLoopAnchorMs();
    this.emitStateChange();
    return true;
  }

  private applyPendingIndex(): boolean {
    if (this.pendingIndex === undefined) {
      return false;
    }

    this.currentIndex = this.pendingIndex;
    this.pendingIndex = undefined;
    this.emitStateChange();
    return true;
  }

  private emitStateChange(): void {
    this.options.onStateChange?.(this.getSnapshot());
  }

  private createLiveLoopAnchorMs(): number | undefined {
    if (this.options.timeMode !== "live") {
      return undefined;
    }

    return Date.now();
  }

  private getEffectiveSourceTime(trackPoint: ReplayTrackPoint): string {
    if (this.options.timeMode === "source") {
      return trackPoint.sourceTime;
    }

    const anchorMs = this.liveLoopAnchorMs ?? Date.now();
    const startMs = this.dataset.trackPoints[this.options.startIndex]!.sourceTimeMs;
    return new Date(anchorMs + (trackPoint.sourceTimeMs - startMs)).toISOString();
  }
}

export function createReplayRunner(
  dataset: ReplayDatasetSummary,
  options: ReplayRunOptions
): ReplayRunner {
  return new ReplayRunnerImpl(dataset, options);
}

export function formatReplayDatasetRange(dataset: ReplayDatasetSummary): {
  endTime: string;
  startTime: string;
} {
  return {
    endTime: dataset.endTime,
    startTime: dataset.startTime
  };
}

export function describeReplayTarget(profile: ResolvedProfile): string[] {
  return [
    `Profile: ${profile.name ?? "(ad-hoc)"}`,
    `Server: ${profile.server}`,
    `CoT port: ${profile.ports.cot}`
  ];
}
