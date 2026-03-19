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

export interface DoctorSummary {
  failed: number;
  passed: number;
}

export interface TakDoctorReport {
  checks: DoctorCheck[];
  command: "doctor";
  configPath: string;
  generatedAt: string;
  mode: "tak-server";
  ok: boolean;
  profile: ResolvedProfile;
  summary: DoctorSummary;
}

export interface KubernetesDoctorReport {
  checks: DoctorCheck[];
  command: "doctor";
  configPath: string;
  generatedAt: string;
  kubernetes: {
    context?: string;
    defaultStorageClass?: string;
    deploymentRoot?: string;
    kubeconfig?: string;
    namespace?: {
      exists: boolean;
      name: string;
    };
    readyNodes?: number;
  };
  mode: "kubernetes";
  ok: boolean;
  summary: DoctorSummary;
}

export type DoctorReport = KubernetesDoctorReport | TakDoctorReport;
