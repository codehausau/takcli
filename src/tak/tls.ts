import { readFileSync } from "node:fs";
import net from "node:net";

export interface TlsClientConfig {
  caFile?: string;
  certFile?: string;
  insecureSkipVerify?: boolean;
  keyFile?: string;
  keyPassphrase?: string;
}

export function ensureValidTlsPair(config: TlsClientConfig): void {
  const hasCert = Boolean(config.certFile);
  const hasKey = Boolean(config.keyFile);

  if (hasCert !== hasKey) {
    throw new Error("Both tls.certFile and tls.keyFile must be configured together.");
  }
}

export function describeTlsClientError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    /bad decrypt|bad password read|unable to get passphrase|interrupted or cancelled|maybe wrong password/i.test(
      message
    )
  ) {
    return new Error(
      "The client private key is encrypted or its passphrase is invalid. Configure tls.keyPassphrase or provide an unencrypted key file."
    );
  }

  return error instanceof Error ? error : new Error(message);
}

export function buildTlsClientOptions(host: string, config: TlsClientConfig) {
  ensureValidTlsPair(config);

  try {
    return {
      ca: config.caFile ? readFileSync(config.caFile) : undefined,
      cert: config.certFile ? readFileSync(config.certFile) : undefined,
      key: config.keyFile ? readFileSync(config.keyFile) : undefined,
      passphrase: config.keyPassphrase,
      rejectUnauthorized: !(config.insecureSkipVerify ?? false),
      servername: net.isIP(host) ? undefined : host
    };
  } catch (error) {
    throw describeTlsClientError(error);
  }
}
