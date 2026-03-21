import { spawn } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

import type { LoadedConfig } from "../core/config-store.js";
import type { TakCliConfig } from "../core/schema.js";
import type { LoadedDeploymentState, TrackedDeployment } from "../deploy/state.js";
import type { CommandExecutionResult } from "../deploy/types.js";

export type ObserveBackend = "docker-compose" | "kubernetes";
export type ObserveLogTargetName =
  | "access"
  | "api"
  | "api-console"
  | "config"
  | "config-console"
  | "database"
  | "messaging"
  | "messaging-console"
  | "plugins"
  | "retention";

type ObserveLogTargetKind = "file" | "service";

interface ObserveLogTargetDefinition {
  description: string;
  fileName?: string;
  kind: ObserveLogTargetKind;
  name: ObserveLogTargetName;
  optional?: boolean;
}

export interface ObserveCommandRunner {
  run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<CommandExecutionResult>;
  stream(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      signal?: AbortSignal;
    }
  ): AsyncIterable<string>;
}

export interface ObserveServices {
  pollIntervalMs: number;
  runner: ObserveCommandRunner;
}

export interface ObserveContext {
  config: LoadedConfig;
  deploymentState: LoadedDeploymentState;
}

export interface ObserveDeploymentSummary {
  backend: ObserveBackend;
  deploymentName: string;
  namespace?: string;
  profileNames: string[];
  source: string;
}

interface ResolvedObserveDeployment {
  backend: ObserveBackend;
  deploymentName: string;
  tracked: TrackedDeployment;
}

interface ResolvedObserveTarget {
  definition: ObserveLogTargetDefinition;
  source: string;
}

export interface ObserveLogTargetSummary {
  description: string;
  kind: ObserveLogTargetKind;
  name: ObserveLogTargetName;
  optional: boolean;
  source: string;
}

export interface ObserveListLogsResult {
  backend: ObserveBackend;
  command: "observe logs list";
  configPath: string;
  deployment: ObserveDeploymentSummary;
  targets: ObserveLogTargetSummary[];
}

export interface ObserveReadLogsResult {
  backend: ObserveBackend;
  command: "observe logs";
  configPath: string;
  deployment: ObserveDeploymentSummary;
  lines: string[];
  source: string;
  target: ObserveLogTargetName;
}

export interface ObserveLogStream {
  backend: ObserveBackend;
  configPath: string;
  deployment: ObserveDeploymentSummary;
  source: string;
  stream: AsyncIterable<string>;
  target: ObserveLogTargetName;
}

const OBSERVE_LOG_TARGETS: ObserveLogTargetDefinition[] = [
  {
    description: "TAK config microservice log",
    fileName: "takserver-config.log",
    kind: "file",
    name: "config"
  },
  {
    description: "TAK messaging process log",
    fileName: "takserver-messaging.log",
    kind: "file",
    name: "messaging"
  },
  {
    description: "TAK API process log",
    fileName: "takserver-api.log",
    kind: "file",
    name: "api"
  },
  {
    description: "JVM console output for the config process",
    fileName: "takserver-config-console.log",
    kind: "file",
    name: "config-console"
  },
  {
    description: "JVM console output for the messaging process",
    fileName: "takserver-messaging-console.log",
    kind: "file",
    name: "messaging-console"
  },
  {
    description: "JVM console output for the API process",
    fileName: "takserver-api-console.log",
    kind: "file",
    name: "api-console"
  },
  {
    description: "HTTP access log for the API process",
    fileName: "takserver-api-access.log",
    kind: "file",
    name: "access",
    optional: true
  },
  {
    description: "Plugin manager log",
    fileName: "takserver-plugins.log",
    kind: "file",
    name: "plugins",
    optional: true
  },
  {
    description: "Retention task console log",
    fileName: "takserver-retention-console.log",
    kind: "file",
    name: "retention",
    optional: true
  },
  {
    description: "Database service logs",
    kind: "service",
    name: "database",
    optional: true
  }
];

class ProcessObserveRunner implements ObserveCommandRunner {
  async run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<CommandExecutionResult> {
    return await new Promise<CommandExecutionResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stderr,
          stdout
        });
      });
    });
  }

  async *stream(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      signal?: AbortSignal;
    }
  ): AsyncIterable<string> {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const queue: string[] = [];
    let done = false;
    let error: Error | undefined;
    let stderr = "";
    let wake: (() => void) | undefined;

    const notify = () => {
      const pending = wake;
      wake = undefined;
      pending?.();
    };

    const abort = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    options?.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer | string) => {
      queue.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
      notify();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", (cause) => {
      error = cause instanceof Error ? cause : new Error(String(cause));
      done = true;
      notify();
    });
    child.once("close", (code, signal) => {
      options?.signal?.removeEventListener("abort", abort);

      if (options?.signal?.aborted || signal === "SIGTERM") {
        done = true;
        notify();
        return;
      }

      if ((code ?? 0) !== 0) {
        error = new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code ?? 1}`);
      }

      done = true;
      notify();
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift() ?? "";
          continue;
        }

        if (error) {
          throw error;
        }

        if (done) {
          break;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      options?.signal?.removeEventListener("abort", abort);
      if (!done && !child.killed) {
        child.kill("SIGTERM");
      }
    }
  }
}

export function createDefaultObserveServices(): ObserveServices {
  return {
    pollIntervalMs: 500,
    runner: new ProcessObserveRunner()
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      complete(resolve);
    }, ms);

    const complete = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };

    const onAbort = () => {
      complete(() => reject(new Error("Observation canceled.")));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function listAvailableTargetNames(): string {
  return OBSERVE_LOG_TARGETS.map((target) => target.name).join(", ");
}

function getTargetDefinition(name: ObserveLogTargetName): ObserveLogTargetDefinition {
  const target = OBSERVE_LOG_TARGETS.find((entry) => entry.name === name);
  if (!target) {
    throw new Error(`Unknown log target "${name}". Available targets: ${listAvailableTargetNames()}`);
  }

  return target;
}

function summarizeDeployment(deployment: ResolvedObserveDeployment): ObserveDeploymentSummary {
  return {
    backend: deployment.backend,
    deploymentName: deployment.deploymentName,
    namespace: deployment.tracked.kubernetes?.namespace,
    profileNames: deployment.tracked.profileNames,
    source: deployment.tracked.deploymentRoot
  };
}

function resolveDeploymentByProfile(
  deployments: Record<string, TrackedDeployment>,
  currentProfile: string | undefined
): [string, TrackedDeployment] | undefined {
  if (!currentProfile) {
    return undefined;
  }

  const matches = Object.entries(deployments).filter(([, deployment]) => deployment.profileNames.includes(currentProfile));
  if (matches.length === 1) {
    return matches[0];
  }

  return undefined;
}

export function resolveObserveDeployment(
  config: TakCliConfig,
  deploymentState: LoadedDeploymentState,
  explicitDeploymentName?: string
): ResolvedObserveDeployment {
  const deployments = deploymentState.state.deployments;
  const deploymentNames = Object.keys(deployments).sort((left, right) => left.localeCompare(right));

  if (deploymentNames.length === 0) {
    throw new Error("No TAKCLI deployments are tracked. Run `takcli deploy` first or use a tracked deployment state file.");
  }

  if (explicitDeploymentName) {
    const tracked = deployments[explicitDeploymentName];
    if (!tracked) {
      throw new Error(
        `Unknown deployment "${explicitDeploymentName}". Tracked deployments: ${deploymentNames.join(", ")}`
      );
    }

    return {
      backend: tracked.target,
      deploymentName: explicitDeploymentName,
      tracked
    };
  }

  if (deploymentNames.length === 1) {
    const [deploymentName] = deploymentNames;
    return {
      backend: deployments[deploymentName].target,
      deploymentName,
      tracked: deployments[deploymentName]
    };
  }

  const profileMatch = resolveDeploymentByProfile(deployments, config.currentProfile);
  if (profileMatch) {
    return {
      backend: profileMatch[1].target,
      deploymentName: profileMatch[0],
      tracked: profileMatch[1]
    };
  }

  const currentProfile = config.currentProfile ? ` for current profile ${config.currentProfile}` : "";
  throw new Error(
    `Multiple tracked deployments are available${currentProfile}. Re-run with --deployment <name>. Tracked deployments: ${deploymentNames.join(", ")}`
  );
}

function resolveObserveTarget(
  deployment: ResolvedObserveDeployment,
  name: ObserveLogTargetName
): ResolvedObserveTarget {
  const definition = getTargetDefinition(name);

  if (definition.kind === "service") {
    if (deployment.backend === "docker-compose") {
      const composeFilePath = deployment.tracked.compose?.composeFilePath;
      if (!composeFilePath) {
        throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Docker Compose metadata.`);
      }

      return {
        definition,
        source: `docker compose service tak-database (${composeFilePath})`
      };
    }

    const namespace = deployment.tracked.kubernetes?.namespace;
    if (!namespace) {
      throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Kubernetes namespace metadata.`);
    }

    return {
      definition,
      source: `kubectl logs deployment/tak-database -n ${namespace}`
    };
  }

  if (!definition.fileName) {
    throw new Error(`Target ${definition.name} is missing a log filename definition.`);
  }

  if (deployment.backend === "docker-compose") {
    return {
      definition,
      source: path.join(deployment.tracked.logsDir, definition.fileName)
    };
  }

  return {
    definition,
    source: `/opt/tak/data/logs/${definition.fileName}`
  };
}

async function requireLocalLogFile(filePath: string, optional: boolean): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    const known = error as NodeJS.ErrnoException;
    if (known.code === "ENOENT") {
      const prefix = optional
        ? "The requested log file is not present for this deployment"
        : "The tracked deployment is missing a required TAK log file";
      throw new Error(`${prefix}: ${filePath}. Available targets: ${listAvailableTargetNames()}`);
    }

    throw error;
  }
}

function takeLastLines(text: string, lineCount: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 0 && parts.at(-1) === "") {
    parts.pop();
  }
  return parts.slice(Math.max(0, parts.length - lineCount));
}

function renderLinesChunk(lines: string[]): string {
  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n`;
}

async function readLocalLogLines(filePath: string, lineCount: number): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  return takeLastLines(content, lineCount);
}

async function *followLocalLogFile(
  filePath: string,
  lineCount: number,
  pollIntervalMs: number,
  signal?: AbortSignal
): AsyncIterable<string> {
  const initialContent = await readFile(filePath, "utf8");
  let previous = Buffer.from(initialContent, "utf8");
  const initialChunk = renderLinesChunk(takeLastLines(initialContent, lineCount));
  if (initialChunk) {
    yield initialChunk;
  }

  while (!signal?.aborted) {
    try {
      await sleep(pollIntervalMs, signal);
    } catch {
      break;
    }

    if (signal?.aborted) {
      break;
    }

    const current = await readFile(filePath);
    if (current.length < previous.length) {
      previous = Buffer.alloc(0);
    }

    if (current.length > previous.length) {
      yield current.subarray(previous.length).toString("utf8");
      previous = current;
    }
  }
}

function buildComposeDatabaseArgs(composeFilePath: string, lineCount: number, follow: boolean): string[] {
  const args = ["compose", "-f", composeFilePath, "logs", "--no-color", "--tail", String(lineCount)];
  if (follow) {
    args.push("-f");
  }
  args.push("tak-database");
  return args;
}

function buildKubernetesFileCommand(filePath: string, lineCount: number, follow: boolean): string {
  const safePath = filePath.replace(/'/g, "'\"'\"'");
  const followFlag = follow ? "-F " : "";
  return `if [ -f '${safePath}' ]; then tail -n ${lineCount} ${followFlag}'${safePath}'; else exit 44; fi`;
}

async function runKubernetesFileCommand(
  runner: ObserveCommandRunner,
  namespace: string,
  filePath: string,
  lineCount: number
): Promise<CommandExecutionResult> {
  return await runner.run("kubectl", [
    "exec",
    "deployment/takserver",
    "-n",
    namespace,
    "--",
    "sh",
    "-lc",
    buildKubernetesFileCommand(filePath, lineCount, false)
  ]);
}

function streamKubernetesFileCommand(
  runner: ObserveCommandRunner,
  namespace: string,
  filePath: string,
  lineCount: number,
  signal?: AbortSignal
): AsyncIterable<string> {
  return runner.stream(
    "kubectl",
    [
      "exec",
      "deployment/takserver",
      "-n",
      namespace,
      "--",
      "sh",
      "-lc",
      buildKubernetesFileCommand(filePath, lineCount, true)
    ],
    { signal }
  );
}

function buildKubernetesServerLogsArgs(namespace: string, lineCount: number, follow: boolean): string[] {
  const args = ["logs", "deployment/takserver", "-n", namespace, "--tail", String(lineCount)];
  if (follow) {
    args.push("-f");
  }
  return args;
}

function buildKubernetesServerLogsSource(namespace: string, target: ObserveLogTargetName): string {
  return `kubectl logs deployment/takserver -n ${namespace} (fallback for ${target})`;
}

function assertSuccessfulCommand(result: CommandExecutionResult, missingMessage?: string): CommandExecutionResult {
  if (result.exitCode === 44 && missingMessage) {
    throw new Error(missingMessage);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed with exit code ${result.exitCode}`);
  }
  return result;
}

export async function listObserveLogs(
  context: ObserveContext,
  explicitDeploymentName: string | undefined
): Promise<ObserveListLogsResult> {
  const deployment = resolveObserveDeployment(context.config.config, context.deploymentState, explicitDeploymentName);
  const targets = OBSERVE_LOG_TARGETS.map((target) => ({
    description: target.description,
    kind: target.kind,
    name: target.name,
    optional: Boolean(target.optional),
    source: resolveObserveTarget(deployment, target.name).source
  }));

  return {
    backend: deployment.backend,
    command: "observe logs list",
    configPath: context.config.path,
    deployment: summarizeDeployment(deployment),
    targets
  };
}

export async function readObserveLogs(
  context: ObserveContext,
  services: ObserveServices,
  options: {
    deploymentName?: string;
    lines: number;
    target: ObserveLogTargetName;
  }
): Promise<ObserveReadLogsResult> {
  const deployment = resolveObserveDeployment(context.config.config, context.deploymentState, options.deploymentName);
  const target = resolveObserveTarget(deployment, options.target);

  if (target.definition.kind === "file") {
    if (deployment.backend === "docker-compose") {
      await requireLocalLogFile(target.source, Boolean(target.definition.optional));
      const lines = await readLocalLogLines(target.source, options.lines);
      return {
        backend: deployment.backend,
        command: "observe logs",
        configPath: context.config.path,
        deployment: summarizeDeployment(deployment),
        lines,
        source: target.source,
        target: target.definition.name
      };
    }

    const namespace = deployment.tracked.kubernetes?.namespace;
    if (!namespace) {
      throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Kubernetes namespace metadata.`);
    }

    const result = await runKubernetesFileCommand(services.runner, namespace, target.source, options.lines);

    if (result.exitCode === 44) {
      const fallback = assertSuccessfulCommand(
        await services.runner.run("kubectl", buildKubernetesServerLogsArgs(namespace, options.lines, false))
      );

      return {
        backend: deployment.backend,
        command: "observe logs",
        configPath: context.config.path,
        deployment: summarizeDeployment(deployment),
        lines: takeLastLines(fallback.stdout, options.lines),
        source: buildKubernetesServerLogsSource(namespace, target.definition.name),
        target: target.definition.name
      };
    }

    assertSuccessfulCommand(result);

    return {
      backend: deployment.backend,
      command: "observe logs",
      configPath: context.config.path,
      deployment: summarizeDeployment(deployment),
      lines: takeLastLines(result.stdout, options.lines),
      source: `takserver:${target.source}`,
      target: target.definition.name
    };
  }

  if (deployment.backend === "docker-compose") {
    const composeFilePath = deployment.tracked.compose?.composeFilePath;
    if (!composeFilePath) {
      throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Docker Compose metadata.`);
    }

    const result = assertSuccessfulCommand(
      await services.runner.run("docker", buildComposeDatabaseArgs(composeFilePath, options.lines, false))
    );
    return {
      backend: deployment.backend,
      command: "observe logs",
      configPath: context.config.path,
      deployment: summarizeDeployment(deployment),
      lines: takeLastLines(result.stdout, options.lines),
      source: target.source,
      target: target.definition.name
    };
  }

  const namespace = deployment.tracked.kubernetes?.namespace;
  if (!namespace) {
    throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Kubernetes namespace metadata.`);
  }

  const result = assertSuccessfulCommand(
    await services.runner.run("kubectl", ["logs", "deployment/tak-database", "-n", namespace, "--tail", String(options.lines)])
  );

  return {
    backend: deployment.backend,
    command: "observe logs",
    configPath: context.config.path,
    deployment: summarizeDeployment(deployment),
    lines: takeLastLines(result.stdout, options.lines),
    source: target.source,
    target: target.definition.name
  };
}

export async function openObserveLogStream(
  context: ObserveContext,
  services: ObserveServices,
  options: {
    deploymentName?: string;
    lines: number;
    signal?: AbortSignal;
    target: ObserveLogTargetName;
  }
): Promise<ObserveLogStream> {
  const deployment = resolveObserveDeployment(context.config.config, context.deploymentState, options.deploymentName);
  const target = resolveObserveTarget(deployment, options.target);

  if (target.definition.kind === "file") {
    if (deployment.backend === "docker-compose") {
      await requireLocalLogFile(target.source, Boolean(target.definition.optional));
      return {
        backend: deployment.backend,
        configPath: context.config.path,
        deployment: summarizeDeployment(deployment),
        source: target.source,
        stream: followLocalLogFile(target.source, options.lines, services.pollIntervalMs, options.signal),
        target: target.definition.name
      };
    }

    const namespace = deployment.tracked.kubernetes?.namespace;
    if (!namespace) {
      throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Kubernetes namespace metadata.`);
    }

    const preflight = await runKubernetesFileCommand(services.runner, namespace, target.source, 1);
    if (preflight.exitCode === 44) {
      return {
        backend: deployment.backend,
        configPath: context.config.path,
        deployment: summarizeDeployment(deployment),
        source: buildKubernetesServerLogsSource(namespace, target.definition.name),
        stream: services.runner.stream("kubectl", buildKubernetesServerLogsArgs(namespace, options.lines, true), {
          signal: options.signal
        }),
        target: target.definition.name
      };
    }

    assertSuccessfulCommand(preflight);

    return {
      backend: deployment.backend,
      configPath: context.config.path,
      deployment: summarizeDeployment(deployment),
      source: `takserver:${target.source}`,
      stream: streamKubernetesFileCommand(services.runner, namespace, target.source, options.lines, options.signal),
      target: target.definition.name
    };
  }

  if (deployment.backend === "docker-compose") {
    const composeFilePath = deployment.tracked.compose?.composeFilePath;
    if (!composeFilePath) {
      throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Docker Compose metadata.`);
    }

    return {
      backend: deployment.backend,
      configPath: context.config.path,
      deployment: summarizeDeployment(deployment),
      source: target.source,
      stream: services.runner.stream("docker", buildComposeDatabaseArgs(composeFilePath, options.lines, true), {
        signal: options.signal
      }),
      target: target.definition.name
    };
  }

  const namespace = deployment.tracked.kubernetes?.namespace;
  if (!namespace) {
    throw new Error(`Deployment ${deployment.deploymentName} does not have tracked Kubernetes namespace metadata.`);
  }

  return {
    backend: deployment.backend,
    configPath: context.config.path,
    deployment: summarizeDeployment(deployment),
    source: target.source,
    stream: services.runner.stream(
      "kubectl",
      ["logs", "deployment/tak-database", "-n", namespace, "--tail", String(options.lines), "-f"],
      {
        signal: options.signal
      }
    ),
    target: target.definition.name
  };
}
