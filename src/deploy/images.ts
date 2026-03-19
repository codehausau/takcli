import type { ComposeImageSet } from "./types.js";

const DEFAULT_DB_IMAGE = "postgis/postgis:15-3.3";

export function inferImageTag(ref: string): string | undefined {
  if (ref === "main") {
    return "latest";
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref) ? ref : undefined;
}

export function createDeployImages(registry: string, imageTag: string): ComposeImageSet {
  const prefix = registry.replace(/\/+$/, "");
  return {
    db: DEFAULT_DB_IMAGE,
    server: `${prefix}/takserver-full:${imageTag}`
  };
}
