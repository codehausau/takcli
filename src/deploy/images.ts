import type { ComposeImageSet } from "./types.js";

export const DEFAULT_DB_IMAGE = "kartoza/postgis:15-3.4";

export function inferImageTag(ref: string): string | undefined {
  if (ref === "main") {
    return "latest";
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref) ? ref : undefined;
}

export function createDeployImages(registry: string, imageTag: string, dbImage = DEFAULT_DB_IMAGE): ComposeImageSet {
  const prefix = registry.replace(/\/+$/, "");
  return {
    db: dbImage,
    server: `${prefix}/takserver-full:${imageTag}`
  };
}
