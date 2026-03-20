import os from "node:os";
import path from "node:path";
import process from "node:process";

import { withSpinner, writeSection, writeJson } from "../cli/output.js";
import { CliError, type IO } from "../cli/runtime.js";
import { loadConfig, saveConfig } from "../core/config-store.js";
import { configSchema, profileSchema } from "../core/schema.js";
import { prepareComposeWorkspace } from "./compose.js";
import { createDeployImages, inferImageTag } from "./images.js";
import { prepareKubernetesWorkspace } from "./kubernetes.js";
import { ensureTakServerClone, getDefaultDeploymentRoot } from "./repo.js";
import { loadDeploymentState, saveDeploymentState, type TrackedDeployment } from "./state.js";
import { checkDeployDependencies } from "./system.js";
import type {
  DeployBootstrapWebTakUser,
  DeployEnvironmentValues,
  DeployRequest,
  DeployResult,
  DeployServices,
  DeployTarget,
  DeployWizardOptions
} from "./types.js";

const DEFAULT_REPO_URL = "https://github.com/TAK-Product-Center/Server.git";
const DEFAULT_REGISTRY = "docker.io/codehausau";
const MIN_CERTIFICATE_PASSWORD_LENGTH = 6;
const MIN_WEBTAK_PASSWORD_LENGTH = 15;
const WEBTAK_PASSWORD_SPECIAL_CHARACTERS = "-_!@#$%^&*(){}[]+=~`|:;<>,./\\?";
const WEBTAK_BOOTSTRAP_USERNAME_ENV = "TAKCLI_WEBTAK_BOOTSTRAP_USERNAME";
const WEBTAK_BOOTSTRAP_PASSWORD_ENV = "TAKCLI_WEBTAK_BOOTSTRAP_PASSWORD";
const WEBTAK_BOOTSTRAP_ATTEMPTS = 5;
const WEBTAK_BOOTSTRAP_RETRY_DELAY_MS = 2_000;
const DEPLOY_PROFILE_HOST = "127.0.0.1";

function defaultDeploymentName(): string {
  return `tak-${new Date().toISOString().slice(0, 10)}`;
}

function normalizePath(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function defaultImageTagForRef(ref: string): string {
  const inferredTag = inferImageTag(ref);

  if (!inferredTag || inferredTag === "main") {
    return "latest";
  }

  return inferredTag;
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

async function resolveValidatedPromptedValue(options: {
  defaultValue?: string;
  io: IO;
  message: string;
  prompt: DeployServices["prompt"];
  secret?: boolean;
  supplied?: string;
  validate: (value: string) => void;
}): Promise<string> {
  if (options.supplied !== undefined) {
    options.validate(options.supplied);
    return options.supplied;
  }

  while (true) {
    let value = "";

    try {
      value = await options.prompt.input({
        defaultValue: options.defaultValue,
        message: options.message,
        secret: options.secret
      });
    } catch (error) {
      if (error instanceof CliError) {
        options.io.stderr(`${error.message}\n`);
        continue;
      }
      throw error;
    }

    try {
      options.validate(value);
      return value;
    } catch (error) {
      if (error instanceof CliError) {
        options.io.stderr(`${error.message}\n`);
        continue;
      }
      throw error;
    }
  }
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
        description: "Experimental support. Renders TAKCLI-managed manifests and can apply them with kubectl.",
        value: "kubernetes"
      }
    ],
    defaultValue: "docker-compose",
    message: "Choose a deployment target"
  })) as DeployTarget;
}

async function collectDeploymentEnvironmentValues(
  io: IO,
  options: DeployWizardOptions,
  prompt: DeployServices["prompt"],
  request: Pick<DeployRequest, "deploymentName">
): Promise<DeployEnvironmentValues> {
  const normalizedName = request.deploymentName.replace(/[^A-Za-z0-9_-]+/g, "-");
  return {
    adminCertName: options.adminCertName ?? (await prompt.input({
      defaultValue: "admin",
      message: "Admin certificate name"
    })),
    adminCertPass: await resolveValidatedPromptedValue({
      io,
      message: "Admin certificate password",
      prompt,
      secret: true,
      supplied: options.adminCertPass,
      validate: (value) => {
        if (value.length < MIN_CERTIFICATE_PASSWORD_LENGTH) {
          throw new CliError(
            `Admin certificate password must be at least ${MIN_CERTIFICATE_PASSWORD_LENGTH} characters because TAK certificate tooling requires keystore passwords of that length.`
          );
        }
      }
    }),
    caName: options.caName ?? (await prompt.input({
      defaultValue: `${normalizedName}-CA`,
      message: "Certificate authority name"
    })),
    caPass: await resolveValidatedPromptedValue({
      io,
      message: "Certificate authority password",
      prompt,
      secret: true,
      supplied: options.caPass,
      validate: (value) => {
        if (value.length < MIN_CERTIFICATE_PASSWORD_LENGTH) {
          throw new CliError(
            `Certificate authority password must be at least ${MIN_CERTIFICATE_PASSWORD_LENGTH} characters because TAK certificate tooling requires keystore passwords of that length.`
          );
        }
      }
    }),
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
    postgresPassword: await resolveValidatedPromptedValue({
      io,
      message: "Postgres password",
      prompt,
      secret: true,
      supplied: options.postgresPassword,
      validate: () => {
        // No additional password policy beyond requiring a value.
      }
    }),
    state: options.state ?? (await prompt.input({
      defaultValue: "Unknown",
      message: "Certificate state/province"
    })),
    takserverCertPass: await resolveValidatedPromptedValue({
      io,
      message: "TAK Server certificate password",
      prompt,
      secret: true,
      supplied: options.takserverCertPass,
      validate: (value) => {
        if (value.length < MIN_CERTIFICATE_PASSWORD_LENGTH) {
          throw new CliError(
            `TAK Server certificate password must be at least ${MIN_CERTIFICATE_PASSWORD_LENGTH} characters because TAK certificate tooling requires keystore passwords of that length.`
          );
        }
      }
    })
  };
}

function validateDeployEnvironmentValues(values: DeployEnvironmentValues): void {
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

function isValidWebTakPassword(password: string): boolean {
  return (
    password.length >= MIN_WEBTAK_PASSWORD_LENGTH &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    [...password].some((character) => WEBTAK_PASSWORD_SPECIAL_CHARACTERS.includes(character))
  );
}

function validateBootstrapWebTakUser(user: DeployBootstrapWebTakUser): void {
  if (!user.username.trim()) {
    throw new CliError("Initial WebTAK username cannot be empty.");
  }

  if (/\s/.test(user.username)) {
    throw new CliError("Initial WebTAK username cannot contain whitespace.");
  }

  if (!isValidWebTakPassword(user.password)) {
    throw new CliError(
      `Initial WebTAK password must be at least ${MIN_WEBTAK_PASSWORD_LENGTH} characters and include uppercase, lowercase, numeric, and special characters from ${WEBTAK_PASSWORD_SPECIAL_CHARACTERS}.`
    );
  }
}

async function resolveBootstrapWebTakUser(
  io: IO,
  options: DeployWizardOptions,
  prompt: DeployServices["prompt"],
  target: DeployTarget
): Promise<DeployBootstrapWebTakUser | undefined> {
  if (target !== "docker-compose") {
    return undefined;
  }

  if (options.webtakUsername || options.webtakPassword) {
    const username = options.webtakUsername ?? (await prompt.input({
      defaultValue: "admin",
      message: "Initial WebTAK username"
    }));
    const password = await resolveValidatedPromptedValue({
      io,
      message: "Initial WebTAK password",
      prompt,
      secret: true,
      supplied: options.webtakPassword,
      validate: (value) => {
        validateBootstrapWebTakUser({
          password: value,
          username
        });
      }
    });

    return {
      password,
      username
    };
  }

  if (options.yes) {
    return undefined;
  }

  const shouldCreate = await prompt.confirm({
    defaultValue: true,
    message: "Create an initial WebTAK username/password for the 8446 login?"
  });

  if (!shouldCreate) {
    return undefined;
  }

  return {
    username: await prompt.input({
      defaultValue: "admin",
      message: "Initial WebTAK username"
    }),
    password: ""
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function bootstrapComposeWebTakUser(
  runner: DeployServices["runner"],
  request: DeployRequest,
  composeFilePath: string
): Promise<void> {
  if (!request.webtakUser) {
    return;
  }

  let failureMessage = "";

  for (let attempt = 1; attempt <= WEBTAK_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    const result = await runner.run(
      "docker",
      [
        "compose",
        "-f",
        composeFilePath,
        "exec",
        "-T",
        "-e",
        WEBTAK_BOOTSTRAP_USERNAME_ENV,
        "-e",
        WEBTAK_BOOTSTRAP_PASSWORD_ENV,
        "takserver",
        "bash",
        "-lc",
        `cd /opt/tak && java -jar utils/UserManager.jar usermod -A -p "$${WEBTAK_BOOTSTRAP_PASSWORD_ENV}" "$${WEBTAK_BOOTSTRAP_USERNAME_ENV}"`
      ],
      {
        cwd: request.deploymentRoot,
        env: {
          ...process.env,
          [WEBTAK_BOOTSTRAP_PASSWORD_ENV]: request.webtakUser.password,
          [WEBTAK_BOOTSTRAP_USERNAME_ENV]: request.webtakUser.username
        }
      }
    );

    if (result.exitCode === 0) {
      return;
    }

    failureMessage = result.stderr || result.stdout || "Unknown docker compose exec error";

    if (attempt < WEBTAK_BOOTSTRAP_ATTEMPTS) {
      await delay(WEBTAK_BOOTSTRAP_RETRY_DELAY_MS);
    }
  }

  throw new CliError(`Initial WebTAK user bootstrap failed: ${failureMessage}`);
}

async function maybeRegisterComposeProfiles(
  io: IO,
  prompt: DeployServices["prompt"],
  options: DeployWizardOptions,
  envValues: DeployEnvironmentValues,
  request: DeployRequest
): Promise<string[]> {
  if (request.yes) {
    return [];
  }

  const shouldAddProfiles = await prompt.confirm({
    defaultValue: true,
    message: "Add this deployment to TAKCLI profiles?"
  });

  if (!shouldAddProfiles) {
    return [];
  }

  const loaded = await loadConfig(options.configPath, { allowMissing: true });
  const nextProfiles = { ...loaded.config.profiles };
  const savedNames: string[] = [];

  const defaultProfileName = request.deploymentName;
  nextProfiles[defaultProfileName] = profileSchema.parse({
    description: `Local compose deployment ${request.deploymentName}`,
    ports: {
      api: 8446,
      cot: 8089,
      enrollment: 8443,
      federation: 8444
    },
    server: `https://${DEPLOY_PROFILE_HOST}:8446`,
    tls: {
      insecureSkipVerify: true
    }
  });
  savedNames.push(defaultProfileName);

  const adminProfileName = `${request.deploymentName}-admin`;
  const adminCertFile = path.join(request.certsDir, "files", `${envValues.adminCertName}.pem`);
  const adminKeyFile = path.join(request.certsDir, "files", `${envValues.adminCertName}.key`);
  const adminCaFile = path.join(request.certsDir, "files", "root-ca.pem");
  nextProfiles[adminProfileName] = profileSchema.parse({
    description: `Local compose admin profile for ${request.deploymentName}`,
    ports: {
      api: 8443,
      cot: 8089,
      enrollment: 8443,
      federation: 8444
    },
    server: `https://${DEPLOY_PROFILE_HOST}:8443`,
    tls: {
      caFile: adminCaFile,
      certFile: adminCertFile,
      insecureSkipVerify: true,
      keyFile: adminKeyFile
    }
  });
  savedNames.push(adminProfileName);

  const setCurrent = await prompt.confirm({
    defaultValue: true,
    message: `Set ${defaultProfileName} as the current TAKCLI profile?`
  });

  const nextConfig = configSchema.parse({
    ...loaded.config,
    currentProfile: setCurrent ? defaultProfileName : loaded.config.currentProfile,
    profiles: nextProfiles
  });
  await saveConfig(loaded.path, nextConfig);

  io.stdout(
    `Saved TAKCLI profiles to ${loaded.path}: ${savedNames.join(", ")}${setCurrent ? ` (current: ${defaultProfileName})` : ""}\n`
  );

  return savedNames;
}

async function saveTrackedDeployment(
  configPath: string | undefined,
  deploymentName: string,
  deployment: TrackedDeployment
): Promise<string> {
  const loaded = await loadDeploymentState(configPath, { allowMissing: true });
  const nextState = {
    ...loaded.state,
    deployments: {
      ...loaded.state.deployments,
      [deploymentName]: deployment
    }
  };
  await saveDeploymentState(loaded.path, nextState);
  return loaded.path;
}

async function runWithDeploymentFeedback<T>(
  io: IO,
  label: string,
  enabled: boolean,
  action: () => Promise<T>
): Promise<T> {
  if (!enabled) {
    return await action();
  }

  return await withSpinner(io, label, action);
}

function buildPlanLines(request: DeployRequest, gitCommit: string): string[] {
  const images = createDeployImages(request.registry, request.imageTag);
  const executionLine = request.dryRun
    ? "Execution: dry-run (workspace generation only)"
    : request.target === "docker-compose"
      ? "Execution: docker compose up -d"
      : "Execution: kubectl apply -f kubernetes.yaml (experimental)";

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
    request.webtakUser ? `Initial WebTAK user: ${request.webtakUser.username}` : "Initial WebTAK user: skipped",
    executionLine
  ];
}

export async function runDeployWizard(
  io: IO,
  services: DeployServices,
  options: DeployWizardOptions
): Promise<DeployResult> {
  const target = await resolveTarget(options, services.prompt);
  if (target !== "docker-compose" && (options.webtakUsername || options.webtakPassword)) {
    throw new CliError("Initial WebTAK user bootstrap is currently only supported for docker-compose deployments.");
  }

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
  const imageTag = await resolvePromptedValue(
    options.imageTag,
    services.prompt,
    "Docker image tag",
    defaultImageTagForRef(ref)
  );
  let webtakUser = await resolveBootstrapWebTakUser(io, options, services.prompt, target);
  if (webtakUser && webtakUser.password === "") {
    const webtakUsername = webtakUser.username;
    webtakUser = {
      ...webtakUser,
      password: await resolveValidatedPromptedValue({
        io,
        message: "Initial WebTAK password",
        prompt: services.prompt,
        secret: true,
        validate: (value) => {
          validateBootstrapWebTakUser({
            password: value,
            username: webtakUsername
          });
        }
      })
    };
  }

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
    webtakUser,
    yes: Boolean(options.yes)
  };

  const envValues = await collectDeploymentEnvironmentValues(io, options, services.prompt, request);
  validateDeployEnvironmentValues(envValues);
  if (request.webtakUser) {
    validateBootstrapWebTakUser(request.webtakUser);
  }

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

  const steps = [`Cloned or reused ${request.repoUrl} at ${clone.clonePath}`];
  const result: DeployResult = {
    clonePath: clone.clonePath,
    deploymentName: request.deploymentName,
    dryRun: request.dryRun,
    gitCommit: clone.gitCommit,
    imageTag: request.imageTag,
    registry: request.registry,
    steps,
    target: request.target
  };

  if (request.target === "docker-compose") {
    const compose = await prepareComposeWorkspace({
      clonePath: clone.clonePath,
      envValues,
      gitCommit: clone.gitCommit,
      request
    });

    result.compose = compose;
    steps.push(
      `Prepared deployment workspace at ${request.deploymentRoot}`,
      `Rendered ${compose.composeFilePath}`,
      `Rendered ${compose.envFilePath}`
    );

    if (!request.dryRun) {
      const upResult = await runWithDeploymentFeedback(
        io,
        "Starting Docker Compose deployment",
        !options.json,
        async () =>
          await services.runner.run(
          "docker",
          ["compose", "-f", compose.composeFilePath, "up", "-d"],
          {
            cwd: request.deploymentRoot
          }
        )
      );
      if (upResult.exitCode !== 0) {
        throw new CliError(`docker compose up failed: ${upResult.stderr || upResult.stdout}`);
      }
      steps.push(`Started docker compose deployment from ${compose.composeFilePath}`);

      if (request.webtakUser) {
        await runWithDeploymentFeedback(
          io,
          `Creating initial WebTAK user ${request.webtakUser.username}`,
          !options.json,
          async () => await bootstrapComposeWebTakUser(services.runner, request, compose.composeFilePath)
        );
        steps.push(`Created initial WebTAK user ${request.webtakUser.username} for the 8446 login`);
      }

      const savedProfiles = await maybeRegisterComposeProfiles(io, services.prompt, options, envValues, request);
      for (const profileName of savedProfiles) {
        steps.push(`Saved TAKCLI profile ${profileName}`);
      }

      result.statePath = await saveTrackedDeployment(options.configPath, request.deploymentName, {
        certsDir: request.certsDir,
        compose: {
          composeFilePath: compose.composeFilePath,
          envFilePath: compose.envFilePath
        },
        createdAt: new Date().toISOString(),
        dataDir: request.dataDir,
        deploymentRoot: request.deploymentRoot,
        gitCommit: clone.gitCommit,
        imageTag: request.imageTag,
        logsDir: request.logsDir,
        profileNames: savedProfiles,
        ref: request.ref,
        registry: request.registry,
        repoUrl: request.repoUrl,
        target: request.target
      });
      steps.push(`Tracked deployment in ${result.statePath}`);
    } else {
      steps.push("Skipped docker compose up because --dry-run was requested");
    }
  } else {
    const kubernetes = await prepareKubernetesWorkspace({
      clonePath: clone.clonePath,
      envValues,
      gitCommit: clone.gitCommit,
      request
    });

    result.kubernetes = kubernetes;
    steps.push(
      `Prepared deployment workspace at ${request.deploymentRoot}`,
      `Rendered ${kubernetes.manifestPath}`
    );

    if (!request.dryRun) {
      const applyResult = await runWithDeploymentFeedback(
        io,
        "Applying Kubernetes manifests",
        !options.json,
        async () =>
          await services.runner.run(
          "kubectl",
          ["apply", "-f", kubernetes.manifestPath],
          {
            cwd: request.deploymentRoot
          }
        )
      );
      if (applyResult.exitCode !== 0) {
        throw new CliError(`kubectl apply failed: ${applyResult.stderr || applyResult.stdout}`);
      }
      steps.push(`Applied Kubernetes manifests from ${kubernetes.manifestPath}`);

      result.statePath = await saveTrackedDeployment(options.configPath, request.deploymentName, {
        certsDir: request.certsDir,
        createdAt: new Date().toISOString(),
        dataDir: request.dataDir,
        deploymentRoot: request.deploymentRoot,
        gitCommit: clone.gitCommit,
        imageTag: request.imageTag,
        kubernetes: {
          manifestPath: kubernetes.manifestPath,
          namespace: kubernetes.namespace
        },
        logsDir: request.logsDir,
        profileNames: [],
        ref: request.ref,
        registry: request.registry,
        repoUrl: request.repoUrl,
        target: request.target
      });
      steps.push(`Tracked deployment in ${result.statePath}`);
    } else {
      steps.push("Skipped kubectl apply because --dry-run was requested");
    }
  }

  if (options.json) {
    writeJson(io, {
      command: "deploy",
      ...result
    });
  } else if (result.compose) {
    writeSection(io, "Deployment complete", [
      `Deployment: ${result.deploymentName}`,
      `Workspace: ${result.compose.workspacePath}`,
      `Compose file: ${result.compose.composeFilePath}`,
      `Images: ${result.compose.images.server} and ${result.compose.images.db}`,
      result.statePath ? `State file: ${result.statePath}` : "State file: not tracked",
      request.dryRun ? "Docker Compose was not started." : "Docker Compose stack started."
    ]);
  } else if (result.kubernetes) {
    writeSection(io, "Deployment complete", [
      `Deployment: ${result.deploymentName}`,
      `Workspace: ${result.kubernetes.workspacePath}`,
      `Manifest: ${result.kubernetes.manifestPath}`,
      `Namespace: ${result.kubernetes.namespace}`,
      `Images: ${result.kubernetes.images.server} and ${result.kubernetes.images.db}`,
      result.statePath ? `State file: ${result.statePath}` : "State file: not tracked",
      "Kubernetes support is experimental.",
      request.dryRun ? "Kubernetes manifests were not applied." : "Kubernetes manifests applied."
    ]);
  }

  return result;
}
