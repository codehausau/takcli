import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import YAML from "yaml";

import type { LoadedConfig } from "../core/config-store.js";
import type {
  DoctorCheck,
  KubernetesDoctorReport
} from "./types.js";

const execFileAsync = promisify(execFile);

interface CommandExecutionResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface KubernetesDoctorOptions {
  deploymentRoot?: string;
  kubeconfig?: string;
  namespace?: string;
}

export interface KubernetesDoctorRunner {
  run(
    command: string,
    args: string[],
    options?: {
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<CommandExecutionResult>;
}

interface KubernetesResourceList<T> {
  items?: T[];
}

interface KubernetesNode {
  metadata?: {
    name?: string;
  };
  status?: {
    conditions?: Array<{
      status?: string;
      type?: string;
    }>;
  };
}

interface KubernetesStorageClass {
  metadata?: {
    annotations?: Record<string, string>;
    name?: string;
  };
}

interface DeploymentMetadata {
  kubernetes?: {
    manifestPath?: string;
    namespace?: string;
  };
  target?: string;
}

function createCheck(
  id: string,
  label: string,
  ok: boolean,
  message: string,
  severity: DoctorCheck["severity"],
  details?: Record<string, unknown>
): DoctorCheck {
  return {
    details,
    id,
    label,
    message,
    ok,
    severity
  };
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function isDefaultStorageClass(storageClass: KubernetesStorageClass): boolean {
  const annotations = storageClass.metadata?.annotations ?? {};
  return (
    annotations["storageclass.kubernetes.io/is-default-class"] === "true" ||
    annotations["storageclass.beta.kubernetes.io/is-default-class"] === "true"
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createDefaultRunner(): KubernetesDoctorRunner {
  return {
    async run(command, args, options) {
      try {
        const result = await execFileAsync(command, args, {
          env: options?.env ?? process.env
        });
        return {
          exitCode: 0,
          stderr: result.stderr ?? "",
          stdout: result.stdout ?? ""
        };
      } catch (error) {
        const failure = error as {
          code?: number | string;
          stderr?: string;
          stdout?: string;
        };
        return {
          exitCode: typeof failure.code === "number" ? failure.code : 1,
          stderr: failure.stderr ?? "",
          stdout: failure.stdout ?? ""
        };
      }
    }
  };
}

export async function runKubernetesDoctor(
  configInfo: LoadedConfig,
  options: KubernetesDoctorOptions,
  runner: KubernetesDoctorRunner = createDefaultRunner()
): Promise<KubernetesDoctorReport> {
  const checks: DoctorCheck[] = [];
  const kubernetes: KubernetesDoctorReport["kubernetes"] = {};
  const commandEnv = options.kubeconfig ? { ...process.env, KUBECONFIG: options.kubeconfig } : undefined;

  let namespace = options.namespace;

  if (options.kubeconfig) {
    kubernetes.kubeconfig = options.kubeconfig;
    checks.push(createCheck(
      "kubeconfig",
      "Kubeconfig",
      await pathExists(options.kubeconfig),
      (await pathExists(options.kubeconfig))
        ? `Using kubeconfig ${options.kubeconfig}`
        : `Kubeconfig ${options.kubeconfig} does not exist`,
      "error",
      { path: options.kubeconfig }
    ));
  }

  if (options.deploymentRoot) {
    kubernetes.deploymentRoot = options.deploymentRoot;
    const metadataPath = path.join(options.deploymentRoot, "takcli-deployment.yaml");
    const fallbackManifestPath = path.join(options.deploymentRoot, "kubernetes.yaml");
    const rootExists = await pathExists(options.deploymentRoot);
    checks.push(createCheck(
      "deployment-root",
      "Deployment workspace",
      rootExists,
      rootExists
        ? `Found deployment workspace at ${options.deploymentRoot}`
        : `Deployment workspace ${options.deploymentRoot} does not exist`,
      "error",
      { path: options.deploymentRoot }
    ));

    let metadata: DeploymentMetadata | undefined;
    if (rootExists) {
      const metadataExists = await pathExists(metadataPath);
      checks.push(createCheck(
        "deployment-metadata",
        "Deployment metadata",
        metadataExists,
        metadataExists
          ? `Found deployment metadata at ${metadataPath}`
          : `Deployment metadata ${metadataPath} does not exist`,
        "error",
        { path: metadataPath }
      ));

      if (metadataExists) {
        try {
          metadata = YAML.parse(await readFile(metadataPath, "utf8")) as DeploymentMetadata;
          const targetIsKubernetes = metadata?.target === "kubernetes";
          checks.push(createCheck(
            "deployment-target",
            "Deployment target",
            targetIsKubernetes,
            targetIsKubernetes
              ? "Deployment metadata targets Kubernetes"
              : `Deployment metadata target is ${metadata?.target ?? "unknown"}, not kubernetes`,
            "error",
            { target: metadata?.target }
          ));
          namespace = namespace ?? metadata?.kubernetes?.namespace;
        } catch (error) {
          checks.push(createCheck(
            "deployment-metadata-parse",
            "Deployment metadata parse",
            false,
            `Unable to parse ${metadataPath}: ${error instanceof Error ? error.message : String(error)}`,
            "error"
          ));
        }
      }
    }

    const manifestPath = metadata?.kubernetes?.manifestPath ?? fallbackManifestPath;
    const manifestExists = await pathExists(manifestPath);
    checks.push(createCheck(
      "manifest",
      "Kubernetes manifest",
      manifestExists,
      manifestExists
        ? `Found Kubernetes manifest at ${manifestPath}`
        : `Kubernetes manifest ${manifestPath} does not exist`,
      "error",
      { path: manifestPath }
    ));
  }

  const clientVersion = await runner.run("kubectl", ["version", "--client=true", "-o", "json"], {
    env: commandEnv
  });
  const clientInfo = parseJson<{ clientVersion?: { gitVersion?: string } }>(clientVersion.stdout);
  checks.push(createCheck(
    "kubectl",
    "kubectl",
    clientVersion.exitCode === 0,
    clientVersion.exitCode === 0
      ? `kubectl is available (${clientInfo?.clientVersion?.gitVersion ?? "version detected"})`
      : clientVersion.stderr || clientVersion.stdout || "kubectl is not available",
    "error"
  ));

  const contextResult = await runner.run("kubectl", ["config", "current-context"], { env: commandEnv });
  const context = contextResult.exitCode === 0 ? contextResult.stdout.trim() : undefined;
  kubernetes.context = context || undefined;
  checks.push(createCheck(
    "context",
    "Kubernetes context",
    contextResult.exitCode === 0 && Boolean(context),
    contextResult.exitCode === 0 && context
      ? `Using Kubernetes context ${context}`
      : contextResult.stderr || contextResult.stdout || "Unable to resolve the current Kubernetes context",
    "error",
    context ? { context } : undefined
  ));

  const nodesResult = await runner.run("kubectl", ["get", "nodes", "-o", "json"], { env: commandEnv });
  let readyNodes = 0;
  if (nodesResult.exitCode === 0) {
    const parsed = parseJson<KubernetesResourceList<KubernetesNode>>(nodesResult.stdout);
    const items = parsed?.items ?? [];
    readyNodes = items.filter((node) =>
      node.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")
    ).length;

    checks.push(createCheck(
      "cluster",
      "Cluster access",
      true,
      `Connected to the Kubernetes API and listed ${items.length} node${items.length === 1 ? "" : "s"}`,
      "error",
      { nodes: items.map((node) => node.metadata?.name).filter(Boolean) }
    ));
  } else {
    checks.push(createCheck(
      "cluster",
      "Cluster access",
      false,
      nodesResult.stderr || nodesResult.stdout || "Unable to reach the Kubernetes API",
      "error"
    ));
  }

  kubernetes.readyNodes = readyNodes;
  checks.push(createCheck(
    "nodes-ready",
    "Ready nodes",
    readyNodes > 0,
    readyNodes > 0
      ? `${readyNodes} Kubernetes node${readyNodes === 1 ? "" : "s"} reported Ready`
      : "No Ready Kubernetes nodes were found",
    "error",
    { readyNodes }
  ));

  const storageClassResult = await runner.run("kubectl", ["get", "storageclass", "-o", "json"], { env: commandEnv });
  if (storageClassResult.exitCode === 0) {
    const parsed = parseJson<KubernetesResourceList<KubernetesStorageClass>>(storageClassResult.stdout);
    const defaultStorageClass = (parsed?.items ?? []).find(isDefaultStorageClass)?.metadata?.name;
    kubernetes.defaultStorageClass = defaultStorageClass;
    checks.push(createCheck(
      "storage-class",
      "Default StorageClass",
      Boolean(defaultStorageClass),
      defaultStorageClass
        ? `Default StorageClass is ${defaultStorageClass}`
        : "No default StorageClass was found; current TAKCLI Kubernetes manifests rely on PVCs without storageClassName",
      "error",
      defaultStorageClass ? { storageClass: defaultStorageClass } : undefined
    ));
  } else {
    checks.push(createCheck(
      "storage-class",
      "Default StorageClass",
      false,
      storageClassResult.stderr || storageClassResult.stdout || "Unable to inspect StorageClasses",
      "error"
    ));
  }

  if (namespace) {
    const namespaceResult = await runner.run("kubectl", ["get", "namespace", namespace, "-o", "json"], {
      env: commandEnv
    });
    const exists = namespaceResult.exitCode === 0;
    kubernetes.namespace = {
      exists,
      name: namespace
    };
    checks.push(createCheck(
      "namespace",
      "Namespace",
      exists,
      exists
        ? `Namespace ${namespace} already exists`
        : `Namespace ${namespace} does not exist yet; it will be created when the manifests are applied`,
      "warning",
      { namespace }
    ));
  }

  const failed = checks.filter((check) => !check.ok && check.severity === "error").length;
  const passed = checks.filter((check) => check.ok).length;

  return {
    checks,
    command: "doctor",
    configPath: configInfo.path,
    generatedAt: new Date().toISOString(),
    kubernetes,
    mode: "kubernetes",
    ok: failed === 0,
    summary: {
      failed,
      passed
    }
  };
}
