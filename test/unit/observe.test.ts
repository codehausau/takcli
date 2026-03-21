import { describe, expect, it } from "vitest";

import type { LoadedConfig } from "../../src/core/config-store.js";
import type { LoadedDeploymentState, TrackedDeployment } from "../../src/deploy/state.js";
import { listObserveLogs, resolveObserveDeployment } from "../../src/observe/service.js";

function createTrackedDeployment(
  name: string,
  overrides: Partial<TrackedDeployment> = {}
): TrackedDeployment {
  const target = overrides.target ?? "docker-compose";

  return {
    certsDir: `/tmp/${name}/certs`,
    createdAt: "2026-03-20T00:00:00.000Z",
    dataDir: `/tmp/${name}/data`,
    deploymentRoot: `/tmp/${name}/workspace`,
    gitCommit: "deadbeef",
    imageTag: "latest",
    logsDir: `/tmp/${name}/logs`,
    profileNames: [],
    ref: "main",
    registry: "docker.io/codehausau",
    repoUrl: "https://github.com/TAK-Product-Center/Server.git",
    target,
    ...(target === "docker-compose"
      ? {
          compose: {
            composeFilePath: `/tmp/${name}/workspace/docker-compose.yml`,
            envFilePath: `/tmp/${name}/workspace/.env`
          }
        }
      : {}),
    ...(target === "kubernetes"
      ? {
          kubernetes: {
            manifestPath: `/tmp/${name}/workspace/tak.yml`,
            namespace: name
          }
        }
      : {}),
    ...overrides
  };
}

function createLoadedConfig(currentProfile?: string): LoadedConfig {
  return {
    config: {
      currentProfile,
      profiles: {},
      schemaVersion: 1
    },
    exists: true,
    path: "/tmp/takcli/config.yaml"
  };
}

function createLoadedDeploymentState(deployments: Record<string, TrackedDeployment>): LoadedDeploymentState {
  return {
    exists: true,
    path: "/tmp/takcli/deployments.yaml",
    state: {
      deployments,
      schemaVersion: 1
    }
  };
}

describe("observe service", () => {
  it("prefers an explicitly requested deployment", () => {
    const deploymentState = createLoadedDeploymentState({
      alpha: createTrackedDeployment("alpha", { profileNames: ["active"] }),
      beta: createTrackedDeployment("beta")
    });

    const resolved = resolveObserveDeployment(createLoadedConfig("active").config, deploymentState, "beta");

    expect(resolved.deploymentName).toBe("beta");
    expect(resolved.backend).toBe("docker-compose");
  });

  it("uses the only tracked deployment when there is just one", () => {
    const deploymentState = createLoadedDeploymentState({
      solo: createTrackedDeployment("solo")
    });

    const resolved = resolveObserveDeployment(createLoadedConfig().config, deploymentState);

    expect(resolved.deploymentName).toBe("solo");
  });

  it("uses the active profile to disambiguate tracked deployments", () => {
    const deploymentState = createLoadedDeploymentState({
      compose: createTrackedDeployment("compose", { profileNames: ["blue"] }),
      cluster: createTrackedDeployment("cluster", {
        profileNames: ["green"],
        target: "kubernetes",
        kubernetes: {
          manifestPath: "/tmp/cluster/workspace/tak.yml",
          namespace: "cluster"
        }
      })
    });

    const resolved = resolveObserveDeployment(createLoadedConfig("green").config, deploymentState);

    expect(resolved.deploymentName).toBe("cluster");
    expect(resolved.backend).toBe("kubernetes");
  });

  it("fails when multiple tracked deployments are ambiguous", () => {
    const deploymentState = createLoadedDeploymentState({
      alpha: createTrackedDeployment("alpha"),
      beta: createTrackedDeployment("beta")
    });

    expect(() => resolveObserveDeployment(createLoadedConfig().config, deploymentState)).toThrow(
      "Re-run with --deployment <name>"
    );
  });

  it("lists curated target mappings for docker compose deployments", async () => {
    const result = await listObserveLogs(
      {
        config: createLoadedConfig(),
        deploymentState: createLoadedDeploymentState({
          demo: createTrackedDeployment("demo")
        })
      },
      undefined
    );

    const apiTarget = result.targets.find((target) => target.name === "api");
    const databaseTarget = result.targets.find((target) => target.name === "database");

    expect(apiTarget).toMatchObject({
      kind: "file",
      optional: false,
      source: "/tmp/demo/logs/takserver-api.log"
    });
    expect(databaseTarget).toMatchObject({
      kind: "service",
      optional: true,
      source: "docker compose service tak-database (/tmp/demo/workspace/docker-compose.yml)"
    });
  });

  it("lists curated target mappings for kubernetes deployments", async () => {
    const result = await listObserveLogs(
      {
        config: createLoadedConfig(),
        deploymentState: createLoadedDeploymentState({
          cluster: createTrackedDeployment("cluster", {
            target: "kubernetes",
            kubernetes: {
              manifestPath: "/tmp/cluster/workspace/tak.yml",
              namespace: "tak-demo"
            }
          })
        })
      },
      undefined
    );

    const messagingTarget = result.targets.find((target) => target.name === "messaging");
    const databaseTarget = result.targets.find((target) => target.name === "database");

    expect(messagingTarget).toMatchObject({
      kind: "file",
      source: "/opt/tak/data/logs/takserver-messaging.log"
    });
    expect(databaseTarget).toMatchObject({
      kind: "service",
      source: "kubectl logs deployment/tak-database -n tak-demo"
    });
  });
});
