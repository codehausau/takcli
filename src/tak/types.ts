import type { ResolvedProfile } from "../core/profile-resolution.js";

export interface DnsProbeResult {
  address?: string;
  durationMs: number;
  error?: string;
  family?: number;
  ok: boolean;
}

export interface TcpProbeResult {
  durationMs: number;
  error?: string;
  host: string;
  ok: boolean;
  port: number;
}

export interface TlsProbeResult {
  durationMs: number;
  error?: string;
  fingerprint256?: string;
  issuer?: string;
  ok: boolean;
  subject?: string;
  validFrom?: string;
  validTo?: string;
}

export interface HttpProbeResult {
  durationMs: number;
  error?: string;
  ok: boolean;
  statusCode?: number;
  statusMessage?: string;
  url: string;
}

export interface EndpointStatus {
  http?: HttpProbeResult;
  name: "api" | "cot" | "enrollment" | "federation";
  port: number;
  tcp: TcpProbeResult;
  tls?: TlsProbeResult;
}

export interface StatusSummary {
  command: "status";
  configPath: string;
  dns: DnsProbeResult;
  endpoints: EndpointStatus[];
  generatedAt: string;
  ok: boolean;
  overall: "degraded" | "healthy" | "unreachable";
  profile: ResolvedProfile;
}

export interface DoctorCheck {
  details?: Record<string, unknown>;
  id: string;
  label: string;
  message: string;
  ok: boolean;
  severity: "error" | "warning";
}

export interface DoctorReport {
  checks: DoctorCheck[];
  command: "doctor";
  configPath: string;
  generatedAt: string;
  ok: boolean;
  profile: ResolvedProfile;
  summary: {
    failed: number;
    passed: number;
  };
}
