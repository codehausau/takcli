import { readFileSync } from "node:fs";

let cachedVersion: string | undefined;

export function getCliVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageJsonPath = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  cachedVersion = packageJson.version ?? "0.0.0";
  return cachedVersion;
}
