import { describe, expect, it } from "vitest";

import { DEFAULT_PORTS, normalizeServerInput, resolveProfileTarget } from "../../src/core/profile-resolution.js";

describe("profile resolution", () => {
  it("normalizes bare host input to https", () => {
    expect(normalizeServerInput("tak.example.internal")).toBe("https://tak.example.internal");
  });

  it("resolves the current profile and derives ports", () => {
    const profile = resolveProfileTarget(
      {
        currentProfile: "local",
        profiles: {
          local: {
            auth: {},
            ports: {
              cot: 19000
            },
            server: "https://tak.example.internal",
            tls: {
              insecureSkipVerify: false
            }
          }
        },
        schemaVersion: 1
      },
      {}
    );

    expect(profile.name).toBe("local");
    expect(profile.source).toBe("current");
    expect(profile.ports.api).toBe(DEFAULT_PORTS.api);
    expect(profile.ports.cot).toBe(19000);
  });

  it("allows a one-off server override", () => {
    const profile = resolveProfileTarget(
      {
        currentProfile: "local",
        profiles: {
          local: {
            auth: {},
            ports: {},
            server: "https://tak.example.internal:8446",
            tls: {
              insecureSkipVerify: true
            }
          }
        },
        schemaVersion: 1
      },
      {
        serverOverride: "https://127.0.0.1:9443"
      }
    );

    expect(profile.server).toBe("https://127.0.0.1:9443");
    expect(profile.ports.api).toBe(9443);
    expect(profile.tls.insecureSkipVerify).toBe(true);
  });

  it("allows an ad-hoc insecure TLS override", () => {
    const profile = resolveProfileTarget(
      {
        currentProfile: "local",
        profiles: {
          local: {
            auth: {},
            ports: {},
            server: "https://tak.example.internal:8446",
            tls: {
              insecureSkipVerify: false
            }
          }
        },
        schemaVersion: 1
      },
      {
        insecureSkipVerifyOverride: true,
        serverOverride: "https://127.0.0.1:9443"
      }
    );

    expect(profile.server).toBe("https://127.0.0.1:9443");
    expect(profile.tls.insecureSkipVerify).toBe(true);
  });

  it("allows ad-hoc port overrides", () => {
    const profile = resolveProfileTarget(
      {
        currentProfile: "local",
        profiles: {
          local: {
            auth: {},
            ports: {},
            server: "https://tak.example.internal:8446",
            tls: {
              insecureSkipVerify: false
            }
          }
        },
        schemaVersion: 1
      },
      {
        apiPortOverride: 19446,
        cotPortOverride: 18089,
        enrollmentPortOverride: 18443,
        federationPortOverride: 18444,
        serverOverride: "https://127.0.0.1:9443"
      }
    );

    expect(profile.ports).toEqual({
      api: 19446,
      cot: 18089,
      enrollment: 18443,
      federation: 18444
    });
  });
});
