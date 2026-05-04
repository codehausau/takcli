import type { ComposeImageSet } from "./types.js";

export const DEFAULT_DB_IMAGE_REPOSITORY = "postgres15-postgis3";

export function createDeployImages(registry: string, imageTag: string, dbImage?: string): ComposeImageSet {
  const prefix = registry.replace(/\/+$/, "");
  return {
    db: dbImage ?? createDefaultDbImage(registry, imageTag),
    server: `${prefix}/takserver-full:${imageTag}`
  };
}

export function createDefaultDbImage(registry: string, imageTag: string): string {
  const prefix = registry.replace(/\/+$/, "");
  return `${prefix}/${DEFAULT_DB_IMAGE_REPOSITORY}:${imageTag}`;
}

export const DEFAULT_DB_IMAGE = createDefaultDbImage("docker.io/codehausau", "latest");
