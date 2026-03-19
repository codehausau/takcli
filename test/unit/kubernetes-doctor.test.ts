import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runKubernetesDoctor, type KubernetesDoctorRunner } from "../../src/tak/kubernetes-doctor.js";

function createLoadedConfig() {
  return {
    config: {
      currentProfile: undefined,
      profiles: {},
      schemaVersion: 1 as const
    },
    exists: false,
    path: path.join(os.tmpdir(), "takcli-doctor-config.yaml")
  };
}

class StubRunner implements KubernetesDoctorRunner {
  constructor(private readonly handlers: Record<string, { exitCode: number; stderr: string; stdout: string }>) {}

  async run(command: string, args: string[]) {
    return this.handlers[[command, ...args].join(" ")] ?? {
      exitCode: 1,
      stderr: "unexpected command",
      stdout: ""
    };
  }
}

describe("kubernetes doctor", () => {
  it("reports a healthy kubernetes preflight", async () => {
    const report = await runKubernetesDoctor(
      createLoadedConfig(),
      { namespace: "tak-demo" },
      new StubRunner({
        "kubectl version --client=true -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ clientVersion: { gitVersion: "v1.30.0" } })
        },
        "kubectl config current-context": {
          exitCode: 0,
          stderr: "",
          stdout: "k3s-test\n"
        },
        "kubectl get nodes -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            items: [
              {
                metadata: { name: "node-1" },
                status: {
                  conditions: [{ type: "Ready", status: "True" }]
                }
              }
            ]
          })
        },
        "kubectl get storageclass -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            items: [
              {
                metadata: {
                  annotations: {
                    "storageclass.kubernetes.io/is-default-class": "true"
                  },
                  name: "local-path"
                }
              }
            ]
          })
        },
        "kubectl get namespace tak-demo -o json": {
          exitCode: 0,
          stderr: "",
          stdout: "{}"
        }
      })
    );

    expect(report.mode).toBe("kubernetes");
    expect(report.ok).toBe(true);
    expect(report.kubernetes.context).toBe("k3s-test");
    expect(report.kubernetes.defaultStorageClass).toBe("local-path");
    expect(report.kubernetes.readyNodes).toBe(1);
    expect(report.summary.failed).toBe(0);
  });

  it("fails when no default storage class is available", async () => {
    const report = await runKubernetesDoctor(
      createLoadedConfig(),
      {},
      new StubRunner({
        "kubectl version --client=true -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ clientVersion: { gitVersion: "v1.30.0" } })
        },
        "kubectl config current-context": {
          exitCode: 0,
          stderr: "",
          stdout: "k3s-test\n"
        },
        "kubectl get nodes -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            items: [
              {
                metadata: { name: "node-1" },
                status: {
                  conditions: [{ type: "Ready", status: "True" }]
                }
              }
            ]
          })
        },
        "kubectl get storageclass -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ items: [] })
        }
      })
    );

    expect(report.ok).toBe(false);
    expect(report.summary.failed).toBe(1);
    expect(report.checks.find((check) => check.id === "storage-class")?.message).toContain("No default StorageClass");
  });

  it("infers namespace and manifest information from a deployment workspace", async () => {
    const deploymentRoot = path.join(os.tmpdir(), `takcli-k8s-doctor-${Date.now()}`);
    await mkdir(deploymentRoot, { recursive: true });
    const manifestPath = path.join(deploymentRoot, "rendered.yaml");
    await writeFile(manifestPath, "apiVersion: v1\nkind: Namespace\n", "utf8");
    await writeFile(
      path.join(deploymentRoot, "takcli-deployment.yaml"),
      [
        "target: kubernetes",
        "kubernetes:",
        `  namespace: tak-workspace`,
        `  manifestPath: ${manifestPath}`
      ].join("\n"),
      "utf8"
    );

    const report = await runKubernetesDoctor(
      createLoadedConfig(),
      { deploymentRoot },
      new StubRunner({
        "kubectl version --client=true -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ clientVersion: { gitVersion: "v1.30.0" } })
        },
        "kubectl config current-context": {
          exitCode: 0,
          stderr: "",
          stdout: "k3s-test\n"
        },
        "kubectl get nodes -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            items: [
              {
                metadata: { name: "node-1" },
                status: {
                  conditions: [{ type: "Ready", status: "True" }]
                }
              }
            ]
          })
        },
        "kubectl get storageclass -o json": {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            items: [
              {
                metadata: {
                  annotations: {
                    "storageclass.kubernetes.io/is-default-class": "true"
                  },
                  name: "local-path"
                }
              }
            ]
          })
        },
        "kubectl get namespace tak-workspace -o json": {
          exitCode: 1,
          stderr: "NotFound",
          stdout: ""
        }
      })
    );

    expect(report.ok).toBe(true);
    expect(report.kubernetes.namespace).toEqual({ exists: false, name: "tak-workspace" });
    expect(report.checks.find((check) => check.id === "manifest")?.ok).toBe(true);
  });
});
