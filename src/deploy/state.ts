import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import YAML from "yaml";
import { z } from "zod";

import { resolveConfigPath } from "../core/config-store.js";

const trackedDeploymentSchema = z.object({
  certsDir: z.string(),
  createdAt: z.string(),
  dataDir: z.string(),
  deploymentRoot: z.string(),
  gitCommit: z.string(),
  imageTag: z.string(),
  logsDir: z.string(),
  profileNames: z.array(z.string()).default([]),
  ref: z.string(),
  registry: z.string(),
  repoUrl: z.string(),
  target: z.enum(["docker-compose", "kubernetes"]),
  compose: z
    .object({
      composeFilePath: z.string(),
      envFilePath: z.string()
    })
    .optional(),
  kubernetes: z
    .object({
      manifestPath: z.string(),
      namespace: z.string()
    })
    .optional()
});

const deploymentStateSchema = z.object({
  deployments: z.record(z.string(), trackedDeploymentSchema).default({}),
  schemaVersion: z.literal(1).default(1)
});

export type TrackedDeployment = z.infer<typeof trackedDeploymentSchema>;
export type DeploymentState = z.infer<typeof deploymentStateSchema>;

export interface LoadedDeploymentState {
  exists: boolean;
  path: string;
  state: DeploymentState;
}

export function getDefaultDeploymentStatePath(configOverride?: string): string {
  return path.join(path.dirname(resolveConfigPath(configOverride)), "deployments.yaml");
}

export async function loadDeploymentState(
  configOverride?: string,
  options: { allowMissing?: boolean } = {}
): Promise<LoadedDeploymentState> {
  const targetPath = getDefaultDeploymentStatePath(configOverride);

  try {
    const raw = await readFile(targetPath, "utf8");
    const parsed = raw.trim() === "" ? {} : YAML.parse(raw);
    return {
      exists: true,
      path: targetPath,
      state: deploymentStateSchema.parse(parsed)
    };
  } catch (error) {
    const known = error as NodeJS.ErrnoException;
    if (known.code === "ENOENT" && options.allowMissing) {
      return {
        exists: false,
        path: targetPath,
        state: deploymentStateSchema.parse({})
      };
    }

    throw error;
  }
}

export async function saveDeploymentState(statePath: string, state: DeploymentState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, YAML.stringify(deploymentStateSchema.parse(state)), "utf8");
}
