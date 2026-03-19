import os from "node:os";
import path from "node:path";

import { writeSection, writeJson } from "../cli/output.js";
import { CliError, type IO } from "../cli/runtime.js";
import {
  createComposeImages,
  inferImageTag,
  prepareComposeWorkspace
} from "./compose.js";
import { ensureTakServerClone, getDefaultDeploymentRoot } from "./repo.js";
import { checkDeployDependencies } from "./system.js";
import type {
  ComposeEnvironmentValues,
  DeployRequest,
  DeployResult,
  DeployServices,
  DeployTarget,
  DeployWizardOptions
} from "./types.js";

const DEFAULT_REPO_URL = "https://github.com/TAK-Product-Center/Server.git";
const DEFAULT_REGISTRY = "docker.io/codehausau";
const MIN_CERTIFICATE_PASSWORD_LENGTH = 6;

function defaultDeploymentName(): string {
  return `tak-${new Date().toISOString().slice(0, 10)}`;
}

function normalizePath(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

async function resolvePromptedValue(
  supplied: string | undefined,
  prompt: DeployServices["prompt"],
  message: string,
  defaultValue?: string
): Promise<string> {
  if (supplied) {
    return supplied;
  }
  return await prompt.input({ defaultValue, message });
}

async function resolveTarget(
  options: DeployWizardOptions,
  prompt: DeployServices["prompt"]
): Promise<DeployTarget> {
  if (options.target) {
    return options.target;
  }

  return (await prompt.select({
    choices: [
      {
        description: "Fully supported in v1. Clones the official repo and deploys the published unhardened compose stack.",
        value: "docker-compose"
      },
      {
        description: "Planned next. Helm support will reuse the same TAK Server clone cache.",
        value: "kubernetes"
      }
    ],
    defaultValue: "docker-compose",
    message: "Choose a deployment target"
  })) as DeployTarget;
}

async function collectComposeEnvironmentValues(
  options: DeployWizardOptions,
  prompt: DeployServices["prompt"],
  request: Pick<DeployRequest, "deploymentName">
): Promise<ComposeEnvironmentValues> {
  const normalizedName = request.deploymentName.replace(/[^A-Za-z0-9_-]+/g, "-");
  return {
    adminCertName: options.adminCertName ?? (await prompt.input({
      defaultValue: "admin",
      message: "Admin certificate name"
    })),
    adminCertPass: options.adminCertPass ?? (await prompt.input({
      message: "Admin certificate password",
      secret: true
    })),
    caName: options.caName ?? (await prompt.input({
      defaultValue: `${normalizedName}-CA`,
      message: "Certificate authority name"
    })),
    caPass: options.caPass ?? (await prompt.input({
      message: "Certificate authority password",
      secret: true
    })),
    city: options.city ?? (await prompt.input({
      defaultValue: "Unknown",
      message: "Certificate city/locality"
    })),
    organization: options.organization ?? (await prompt.input({
      defaultValue: "TAKCLI",
      message: "Certificate organization"
    })),
    organizationalUnit: options.organizationalUnit ?? (await prompt.input({
      defaultValue: "Operations",
      message: "Certificate organizational unit"
    })),
    postgresPassword: options.postgresPassword ?? (await prompt.input({
      message: "Postgres password",
      secret: true
    })),
    state: options.state ?? (await prompt.input({
      defaultValue: "Unknown",
      message: "Certificate state/province"
    })),
    takserverCertPass: options.takserverCertPass ?? (await prompt.input({
      message: "TAK Server certificate password",
      secret: true
    }))
  };
}

function validateComposeEnvironmentValues(values: ComposeEnvironmentValues): void {
  const passwordFields = [
    ["Certificate authority password", values.caPass],
    ["TAK Server certificate password", values.takserverCertPass],
    ["Admin certificate password", values.adminCertPass]
  ] as const;

  for (const [label, value] of passwordFields) {
    if (value.length < MIN_CERTIFICATE_PASSWORD_LENGTH) {
      throw new CliError(
        `${label} must be at least ${MIN_CERTIFICATE_PASSWORD_LENGTH} characters because TAK certificate tooling requires keystore passwords of that length.`
      );
    }
  }
}

function buildPlanLines(request: DeployRequest, gitCommit: string): string[] {
  const images = createComposeImages(request.registry, request.imageTag);
  return [
    `Target: ${request.target}`,
    `TAK Server repo: ${request.repoUrl}`,
    `TAK Server ref: ${request.ref}`,
    `Resolved commit: ${gitCommit}`,
    `Deployment name: ${request.deploymentName}`,
    `Deployment workspace: ${request.deploymentRoot}`,
    `Data dir: ${request.dataDir}`,
    `Logs dir: ${request.logsDir}`,
    `Certs dir: ${request.certsDir}`,
    `Server image: ${images.server}`,
    `Database image: ${images.db}`,
    request.dryRun ? "Execution: dry-run (workspace generation only)" : "Execution: docker compose up -d"
  ];
}

function ensureSupportedTarget(target: DeployTarget): void {
  if (target === "kubernetes") {
    throw new CliError("Kubernetes deploy support is planned next. Use `docker-compose` for the current deploy wizard.");
  }
}

export async function runDeployWizard(
  io: IO,
  services: DeployServices,
  options: DeployWizardOptions
): Promise<DeployResult> {
  const target = await resolveTarget(options, services.prompt);
  ensureSupportedTarget(target);

  const dependencyCheck = await checkDeployDependencies(services.runner, target);
  if (dependencyCheck.missing.length > 0) {
    const lines = dependencyCheck.missing.map((dependency) => `${dependency.name}: ${dependency.hint}`);
    writeSection(io, "Missing dependencies", lines);
    throw new CliError("Required deploy dependencies are missing.");
  }

  const ref = await resolvePromptedValue(options.ref, services.prompt, "TAK Server git ref", "main");
  const deploymentName = await resolvePromptedValue(
    options.deploymentName,
    services.prompt,
    "Deployment name",
    defaultDeploymentName()
  );
  const deploymentRoot = normalizePath(
    await resolvePromptedValue(
      options.deploymentRoot,
      services.prompt,
      "Deployment workspace path",
      path.join(getDefaultDeploymentRoot(), deploymentName)
    )
  );
  const dataDir = normalizePath(
    await resolvePromptedValue(
      options.dataDir,
      services.prompt,
      "Deployment data directory",
      path.join(deploymentRoot, "data")
    )
  );
  const logsDir = normalizePath(
    await resolvePromptedValue(options.logsDir, services.prompt, "TAK logs directory", path.join(dataDir, "logs"))
  );
  const certsDir = normalizePath(
    await resolvePromptedValue(options.certsDir, services.prompt, "TAK certs directory", path.join(dataDir, "certs"))
  );
  const registry = await resolvePromptedValue(
    options.registry,
    services.prompt,
    "Docker image registry namespace",
    DEFAULT_REGISTRY
  );
  const inferredTag = inferImageTag(ref);
  const imageTag = await resolvePromptedValue(
    options.imageTag,
    services.prompt,
    "Docker image tag",
    inferredTag ?? "latest"
  );

  const request: DeployRequest = {
    certsDir,
    cacheRoot: options.cacheRoot ? normalizePath(options.cacheRoot) : undefined,
    dataDir,
    deploymentName,
    deploymentRoot,
    dryRun: Boolean(options.dryRun),
    flavor: "unhardened",
    imageTag,
    logsDir,
    ref,
    registry,
    repoUrl: options.repoUrl ?? DEFAULT_REPO_URL,
    target,
    yes: Boolean(options.yes)
  };

  const envValues = await collectComposeEnvironmentValues(options, services.prompt, request);
  validateComposeEnvironmentValues(envValues);

  const clone = await ensureTakServerClone({
    cacheRoot: request.cacheRoot,
    ref: request.ref,
    repoUrl: request.repoUrl,
    runner: services.runner
  });

  if (!options.json) {
    writeSection(io, "Deploy plan", buildPlanLines(request, clone.gitCommit));
  }

  if (!request.yes) {
    const confirmed = await services.prompt.confirm({
      defaultValue: true,
      message: "Proceed with deployment?"
    });
    if (!confirmed) {
      throw new CliError("Deployment canceled.");
    }
  }

  const compose = await prepareComposeWorkspace({
    clonePath: clone.clonePath,
    envValues,
    gitCommit: clone.gitCommit,
    request
  });

  const steps = [
    `Cloned or reused ${request.repoUrl} at ${clone.clonePath}`,
    `Prepared deployment workspace at ${request.deploymentRoot}`,
    `Rendered ${compose.composeFilePath}`,
    `Rendered ${compose.envFilePath}`
  ];

  if (!request.dryRun) {
    const upResult = await services.runner.run(
      "docker",
      ["compose", "-f", compose.composeFilePath, "up", "-d"],
      {
        cwd: request.deploymentRoot
      }
    );
    if (upResult.exitCode !== 0) {
      throw new CliError(`docker compose up failed: ${upResult.stderr || upResult.stdout}`);
    }
    steps.push(`Started docker compose deployment from ${compose.composeFilePath}`);
  } else {
    steps.push("Skipped docker compose up because --dry-run was requested");
  }

  const result: DeployResult = {
    clonePath: clone.clonePath,
    compose,
    deploymentName: request.deploymentName,
    dryRun: request.dryRun,
    gitCommit: clone.gitCommit,
    imageTag: request.imageTag,
    registry: request.registry,
    steps,
    target: request.target
  };

  if (options.json) {
    writeJson(io, {
      command: "deploy",
      ...result
    });
  } else {
    writeSection(io, "Deployment complete", [
      `Deployment: ${result.deploymentName}`,
      `Workspace: ${compose.workspacePath}`,
      `Compose file: ${compose.composeFilePath}`,
      `Images: ${compose.images.server} and ${compose.images.db}`,
      request.dryRun ? "Docker Compose was not started." : "Docker Compose stack started."
    ]);
  }

  return result;
}
