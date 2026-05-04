import { URL } from "node:url";

import type { TakCliConfig } from "./schema.js";

export const DEFAULT_PORTS = {
  api: 8446,
  cot: 8089,
  enrollment: 8443,
  federation: 8444
} as const;

export interface ResolvedProfile {
  auth: {
    password?: string;
    token?: string;
    username?: string;
  };
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
    keyPassphrase?: string;
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

function resolveHttpsPort(
  explicitOverride: number | undefined,
  profilePort: number | undefined,
  url: URL,
  fallback: number
): number {
  if (explicitOverride !== undefined) {
    return explicitOverride;
  }

  if (profilePort !== undefined) {
    return profilePort;
  }

  if (url.port) {
    return Number(url.port);
  }

  return fallback;
}

export function resolveProfileTarget(
  config: TakCliConfig,
  options: {
    apiPortOverride?: number;
    authPasswordOverride?: string;
    authTokenOverride?: string;
    authUsernameOverride?: string;
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
    auth: {
      password: options.authPasswordOverride ?? selectedProfile?.auth.password,
      token: options.authTokenOverride ?? selectedProfile?.auth.token,
      username: options.authUsernameOverride ?? selectedProfile?.auth.username
    },
    description: selectedProfile?.description,
    host: url.hostname,
    name: selectedName,
    ports: {
      api: resolveHttpsPort(options.apiPortOverride, selectedProfile?.ports.api, url, DEFAULT_PORTS.api),
      cot: options.cotPortOverride ?? selectedProfile?.ports.cot ?? DEFAULT_PORTS.cot,
      enrollment: resolveHttpsPort(
        options.enrollmentPortOverride,
        selectedProfile?.ports.enrollment,
        url,
        DEFAULT_PORTS.enrollment
      ),
      federation: resolveHttpsPort(
        options.federationPortOverride,
        selectedProfile?.ports.federation,
        url,
        DEFAULT_PORTS.federation
      )
    },
    server: normalizedServer,
    source: selectedProfile ? (options.profileName ? "named" : "current") : "ad-hoc",
    tls: {
      caFile: selectedProfile?.tls.caFile,
      certFile: selectedProfile?.tls.certFile,
      insecureSkipVerify:
        options.insecureSkipVerifyOverride ?? selectedProfile?.tls.insecureSkipVerify ?? false,
      keyFile: selectedProfile?.tls.keyFile,
      keyPassphrase: selectedProfile?.tls.keyPassphrase
    },
    url
  };
}
