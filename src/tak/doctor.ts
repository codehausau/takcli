import type { ResolvedProfile } from "../core/profile-resolution.js";
import type { LoadedConfig } from "../core/config-store.js";
import { probeDns, probeHttp, probeTcp, probeTls } from "./probes.js";
import type { DoctorCheck, DoctorReport, EndpointStatus, StatusSummary } from "./types.js";

export async function collectStatusSummary(
  configInfo: LoadedConfig,
  profile: ResolvedProfile,
  timeoutMs: number
): Promise<StatusSummary> {
  const dns = await probeDns(profile.host, timeoutMs);
  const apiUrl = new URL(profile.url.toString());
  apiUrl.port = String(profile.ports.api);

  const endpoints: EndpointStatus[] = [];

  const apiTcp = await probeTcp(profile.host, profile.ports.api, timeoutMs);
  const apiTls =
    profile.url.protocol === "https:"
      ? await probeTls(profile.host, profile.ports.api, timeoutMs, profile.tls)
      : undefined;
  const apiHttp = await probeHttp(apiUrl, timeoutMs, profile.tls);
  endpoints.push({
    http: apiHttp,
    name: "api",
    port: profile.ports.api,
    tcp: apiTcp,
    tls: apiTls
  });

  for (const endpoint of [
    { name: "enrollment", port: profile.ports.enrollment },
    { name: "federation", port: profile.ports.federation }
  ] as const) {
    const tcp = await probeTcp(profile.host, endpoint.port, timeoutMs);
    const tls = await probeTls(profile.host, endpoint.port, timeoutMs, profile.tls);
    endpoints.push({
      name: endpoint.name,
      port: endpoint.port,
      tcp,
      tls
    });
  }

  endpoints.push({
    name: "cot",
    port: profile.ports.cot,
    tcp: await probeTcp(profile.host, profile.ports.cot, timeoutMs)
  });

  const requiredChecks = [
    dns.ok,
    ...endpoints.map((endpoint) => endpoint.tcp.ok),
    apiHttp.ok
  ];

  const ok = requiredChecks.every(Boolean);
  let overall: StatusSummary["overall"] = "healthy";
  if (!apiTcp.ok && !apiHttp.ok) {
    overall = "unreachable";
  } else if (!ok) {
    overall = "degraded";
  }

  return {
    command: "status",
    configPath: configInfo.path,
    dns,
    endpoints,
    generatedAt: new Date().toISOString(),
    ok,
    overall,
    profile
  };
}

function buildEndpointChecks(summary: StatusSummary): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      details: summary.dns.address
        ? {
            address: summary.dns.address,
            family: summary.dns.family
          }
        : undefined,
      id: "dns",
      label: "DNS resolution",
      message: summary.dns.ok
        ? `Resolved ${summary.profile.host} to ${summary.dns.address}`
        : summary.dns.error ?? `Failed to resolve ${summary.profile.host}`,
      ok: summary.dns.ok,
      severity: "error"
    }
  ];

  for (const endpoint of summary.endpoints) {
    checks.push({
      details: {
        host: summary.profile.host,
        port: endpoint.port
      },
      id: `tcp-${endpoint.name}`,
      label: `${endpoint.name} TCP`,
      message: endpoint.tcp.ok
        ? `Connected to ${summary.profile.host}:${endpoint.port}`
        : endpoint.tcp.error ?? `Could not connect to ${summary.profile.host}:${endpoint.port}`,
      ok: endpoint.tcp.ok,
      severity: "error"
    });

    if (endpoint.tls) {
      checks.push({
        details: endpoint.tls.ok
          ? {
              fingerprint256: endpoint.tls.fingerprint256,
              issuer: endpoint.tls.issuer,
              subject: endpoint.tls.subject,
              validFrom: endpoint.tls.validFrom,
              validTo: endpoint.tls.validTo
            }
          : undefined,
        id: `tls-${endpoint.name}`,
        label: `${endpoint.name} TLS`,
        message: endpoint.tls.ok
          ? `TLS handshake succeeded (${endpoint.tls.subject ?? "certificate presented"})`
          : endpoint.tls.error ?? `TLS handshake failed for ${endpoint.name}`,
        ok: endpoint.tls.ok,
        severity: "error"
      });
    }

    if (endpoint.http) {
      checks.push({
        details: endpoint.http.statusCode
          ? {
              statusCode: endpoint.http.statusCode,
              statusMessage: endpoint.http.statusMessage
            }
          : undefined,
        id: `http-${endpoint.name}`,
        label: `${endpoint.name} HTTP`,
        message: endpoint.http.ok
          ? `Received HTTP ${endpoint.http.statusCode ?? "response"} from ${endpoint.http.url}`
          : endpoint.http.error ?? `HTTP probe failed for ${endpoint.http.url}`,
        ok: endpoint.http.ok,
        severity: "error"
      });
    }
  }

  return checks;
}

export async function runDoctor(
  configInfo: LoadedConfig,
  profile: ResolvedProfile,
  timeoutMs: number
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    {
      details: {
        exists: configInfo.exists,
        path: configInfo.path
      },
      id: "config",
      label: "Config file",
      message: configInfo.exists
        ? `Loaded config from ${configInfo.path}`
        : `Using ad-hoc defaults because ${configInfo.path} does not exist`,
      ok: configInfo.exists,
      severity: configInfo.exists ? "warning" : "warning"
    },
    {
      details: {
        profile: profile.name,
        server: profile.server,
        source: profile.source
      },
      id: "target",
      label: "Target profile",
      message: profile.name
        ? `Resolved profile ${profile.name} (${profile.server})`
        : `Using one-off target ${profile.server}`,
      ok: true,
      severity: "warning"
    }
  ];

  const summary = await collectStatusSummary(configInfo, profile, timeoutMs);
  checks.push(...buildEndpointChecks(summary));

  const failed = checks.filter((check) => !check.ok && check.severity === "error").length;
  const passed = checks.filter((check) => check.ok).length;

  return {
    checks,
    command: "doctor",
    configPath: configInfo.path,
    generatedAt: new Date().toISOString(),
    ok: failed === 0,
    profile,
    summary: {
      failed,
      passed
    }
  };
}
