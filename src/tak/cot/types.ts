import type { LoadedConfig } from "../../core/config-store.js";
import type { ResolvedProfile } from "../../core/profile-resolution.js";

export interface CotPoint {
  ce: number;
  hae: number;
  lat: number;
  le: number;
  lon: number;
}

export interface CotEventSummary {
  callsign?: string;
  how: string;
  point: CotPoint;
  rawXml: string;
  remarks?: string;
  start?: string;
  stale?: string;
  time?: string;
  type: string;
  uid: string;
}

export interface CotQueryLookup {
  cotId?: number;
  uid?: string;
}

export interface CotQueryResult {
  command: "cot query";
  configPath: string;
  generatedAt: string;
  lookup: CotQueryLookup;
  profile: ResolvedProfile;
  rawXml: string;
  event: CotEventSummary;
}

export interface CotTargetRecord {
  callsign?: string;
  error?: string;
  lat?: number;
  lon?: number;
  time?: string;
  type?: string;
  uid: string;
}

export interface CotTargetsResult {
  command: "cot targets";
  configPath: string;
  endDate: string;
  generatedAt: string;
  limit: number;
  profile: ResolvedProfile;
  startDate: string;
  targets: CotTargetRecord[];
}

export interface CotInjectInput {
  callsign?: string;
  ce: number;
  course?: number;
  hae: number;
  how: string;
  lat: number;
  le: number;
  lon: number;
  remarks?: string;
  speed?: number;
  start?: string;
  staleSeconds: number;
  stale?: string;
  time?: string;
  type: string;
  uid: string;
}

export interface CotInjectResult {
  bytesSent: number;
  command: "cot inject";
  configPath: string;
  event: CotEventSummary;
  generatedAt: string;
  profile: ResolvedProfile;
}

export interface CotFollowEvent {
  command: "cot follow";
  configPath: string;
  event: CotEventSummary;
  generatedAt: string;
  profile: ResolvedProfile;
  sequence: number;
}

export interface UidSearchResult {
  callSign?: string;
  uid: string;
}

export interface CotRuntimeContext {
  config: LoadedConfig;
  profile: ResolvedProfile;
  timeoutMs: number;
}
