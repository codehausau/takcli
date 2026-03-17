import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";

import { configSchema, type TakCliConfig } from "./schema.js";

export interface LoadedConfig {
  config: TakCliConfig;
  exists: boolean;
  path: string;
}

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), ".takcli", "config.yaml");
}

export function resolveConfigPath(override?: string): string {
  return override ?? process.env.TAKCLI_CONFIG ?? getDefaultConfigPath();
}

export async function loadConfig(
  override?: string,
  options: { allowMissing?: boolean } = {}
): Promise<LoadedConfig> {
  const targetPath = resolveConfigPath(override);

  try {
    const raw = await readFile(targetPath, "utf8");
    const parsed = raw.trim() === "" ? {} : YAML.parse(raw);
    return {
      config: configSchema.parse(parsed),
      exists: true,
      path: targetPath
    };
  } catch (error) {
    const known = error as NodeJS.ErrnoException;
    if (known.code === "ENOENT" && options.allowMissing) {
      return {
        config: configSchema.parse({}),
        exists: false,
        path: targetPath
      };
    }

    throw error;
  }
}

export async function saveConfig(configPath: string, config: TakCliConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const normalized = configSchema.parse(config);
  await writeFile(configPath, YAML.stringify(normalized), "utf8");
}
