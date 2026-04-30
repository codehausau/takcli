import type { ResolvedProfile } from "../core/profile-resolution.js";

export type ReplaySourceName = "geojson-vessel-tracks";
export type ReplaySourceOption = ReplaySourceName | "auto";

export interface ReplayTrackPoint {
  callsign: string;
  course?: number;
  craftId?: string;
  draughtMeters?: number;
  lat: number;
  lon: number;
  sourceTime: string;
  sourceTimeMs: number;
  speedKnots?: number;
  speedMetersPerSecond?: number;
  subtype?: string;
  type?: string;
  uid: string;
  beamMeters?: number;
  lengthMeters?: number;
}

export interface ReplayDatasetSummary {
  detectedSource: ReplaySourceName;
  endTime: string;
  endTimeMs: number;
  filePath: string;
  skippedFeatures: number;
  startTime: string;
  startTimeMs: number;
  totalFeatures: number;
  trackPoints: ReplayTrackPoint[];
}

export interface ReplayProgressSnapshot {
  paused: boolean;
  pendingIndex?: number;
  sentEvents: number;
  state: "completed" | "idle" | "running" | "stopped";
  trackPoint?: ReplayTrackPoint;
}

export interface ReplayRunOptions {
  cotType: string;
  how: string;
  maxEvents?: number;
  onEventSent?: (event: { bytesSent: number; sentEvents: number; trackPoint: ReplayTrackPoint }) => void;
  onStateChange?: (snapshot: ReplayProgressSnapshot) => void;
  profile: ResolvedProfile;
  speed: number;
  staleSeconds: number;
  startIndex: number;
  timeoutMs: number;
}

export interface ReplayRunResult {
  completedAt: string;
  dataset: {
    detectedSource: ReplaySourceName;
    endTime: string;
    filePath: string;
    startTime: string;
    totalFeatures: number;
    trackPoints: number;
  };
  finalTrackPointTime?: string;
  maxEvents?: number;
  profile: ResolvedProfile;
  sentEvents: number;
  speed: number;
  startedAt: string;
  state: "completed" | "stopped";
  startFromTime: string;
}

export interface ReplayRunner {
  getSnapshot: () => ReplayProgressSnapshot;
  pause: () => void;
  restart: () => void;
  resume: () => void;
  run: () => Promise<ReplayRunResult>;
  seekBySourceMs: (offsetMs: number) => void;
  stop: () => void;
  togglePause: () => boolean;
}
