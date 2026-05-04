import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadConfig, saveConfig } from "../../src/core/config-store.js";

describe("config store", () => {
  it("loads a missing config as defaults when allowed", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-config-"));
    const configPath = path.join(baseDir, "config.yaml");

    const loaded = await loadConfig(configPath, { allowMissing: true });

    expect(loaded.exists).toBe(false);
    expect(loaded.path).toBe(configPath);
    expect(loaded.config.currentProfile).toBeUndefined();
    expect(loaded.config.profiles).toEqual({});
  });

  it("round-trips config data", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-config-"));
    const configPath = path.join(baseDir, "config.yaml");

    await saveConfig(configPath, {
      currentProfile: "local",
      profiles: {
        local: {
          auth: {},
          description: "Local TAK",
          ports: {
            api: 8446,
            cot: 8089,
            enrollment: 8443,
            federation: 8444
          },
          server: "https://127.0.0.1:8446",
          tls: {
            certFile: "/tmp/admin.pem",
            insecureSkipVerify: true,
            keyFile: "/tmp/admin.key",
            keyPassphrase: "change-me"
          }
        }
      },
      schemaVersion: 1
    });

    const loaded = await loadConfig(configPath);
    expect(loaded.exists).toBe(true);
    expect(loaded.config.currentProfile).toBe("local");
    expect(loaded.config.profiles.local.server).toBe("https://127.0.0.1:8446");
    expect(loaded.config.profiles.local.tls.keyPassphrase).toBe("change-me");
  });
});
