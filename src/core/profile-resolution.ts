import { URL } from "node:url";

import type { TakCliConfig } from "./schema.js";

export const DEFAULT_PORTS = {
  api: 8446,
  cot: 8089,
  enrollment: 8443,
  federation: 8444
} as const;

export interface ResolvedProfile {
  description?: string;
  host: string;
  name?: string;
  ports: {
    api: number;
    cot: number;
    enrollment: number;
    federation: number;
  };
  server: string;
  source: "ad-hoc" | "current" | "named";
  tls: {
    caFile?: string;
    certFile?: string;
    insecureSkipVerify: boolean;
    keyFile?: string;
  };
  url: URL;
}

export function normalizeServerInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function resolveProfileTarget(
  config: TakCliConfig,
  options: {
    apiPortOverride?: number;
    cotPortOverride?: number;
    enrollmentPortOverride?: number;
    federationPortOverride?: number;
    insecureSkipVerifyOverride?: boolean;
    profileName?: string;
    serverOverride?: string;
  }
): ResolvedProfile {
  const selectedName = options.profileName ?? config.currentProfile;
  const selectedProfile = selectedName ? config.profiles[selectedName] : undefined;

  if (!selectedProfile && !options.serverOverride) {
    throw new Error(
      "No active TAK profile is configured. Use `takcli profile add <name> --server <url>` first."
    );
  }

  const normalizedServer = normalizeServerInput(options.serverOverride ?? selectedProfile!.server);
  const url = new URL(normalizedServer);

  return {
    description: selectedProfile?.description,
    host: url.hostname,
    name: selectedName,
    ports: {
      api:
        options.apiPortOverride ??
        (url.port ? Number(url.port) : selectedProfile?.ports.api ?? DEFAULT_PORTS.api),
      cot: options.cotPortOverride ?? selectedProfile?.ports.cot ?? DEFAULT_PORTS.cot,
      enrollment:
        options.enrollmentPortOverride ??
        selectedProfile?.ports.enrollment ??
        DEFAULT_PORTS.enrollment,
      federation:
        options.federationPortOverride ??
        selectedProfile?.ports.federation ??
        DEFAULT_PORTS.federation
    },
    server: normalizedServer,
    source: selectedProfile ? (options.profileName ? "named" : "current") : "ad-hoc",
    tls: {
      caFile: selectedProfile?.tls.caFile,
      certFile: selectedProfile?.tls.certFile,
      insecureSkipVerify:
        options.insecureSkipVerifyOverride ?? selectedProfile?.tls.insecureSkipVerify ?? false,
      keyFile: selectedProfile?.tls.keyFile
    },
    url
  };
}
