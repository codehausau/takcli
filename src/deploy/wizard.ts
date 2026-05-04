import { createPrivateKey } from "node:crypto";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { withSpinner, writeCommandTitle, writeSection, writeJson } from "../cli/output.js";
import { CliError, type IO } from "../cli/runtime.js";
import { loadConfig, saveConfig } from "../core/config-store.js";
import { configSchema, profileSchema } from "../core/schema.js";
import { prepareComposeWorkspace } from "./compose.js";
import { createDefaultDbImage, createDeployImages } from "./images.js";
import { prepareKubernetesWorkspace } from "./kubernetes.js";
import { getDefaultDeploymentRoot } from "./repo.js";
import { loadDeploymentState, saveDeploymentState, type TrackedDeployment } from "./state.js";
import { checkDeployDependencies } from "./system.js";
import type {
  DeployAdsbOptions,
  DeployBootstrapWebTakUser,
  DeployEnvironmentValues,
  DeployRequest,
  DeployResult,
  DeployServices,
  DeployTarget,
  DeployWizardOptions
} from "./types.js";

const DEFAULT_REGISTRY = "docker.io/codehausau";
const MIN_CERTIFICATE_PASSWORD_LENGTH = 6;
const MIN_WEBTAK_PASSWORD_LENGTH = 15;
const WEBTAK_PASSWORD_SPECIAL_CHARACTERS = "-_!@#$%^&*(){}[]+=~`|:;<>,./\\?";
const WEBTAK_BOOTSTRAP_USERNAME_ENV = "TAKCLI_WEBTAK_BOOTSTRAP_USERNAME";
const WEBTAK_BOOTSTRAP_PASSWORD_ENV = "TAKCLI_WEBTAK_BOOTSTRAP_PASSWORD";
const WEBTAK_BOOTSTRAP_ATTEMPTS = 5;
const WEBTAK_BOOTSTRAP_RETRY_DELAY_MS = 2_000;
const DEPLOY_PROFILE_HOST = "127.0.0.1";
const DEFAULT_ADSB_FEED_URL = "https://opendata.adsb.fi/api/v2/mil";
const DEFAULT_ADSB_AREA_DISTANCE_NM = 25;
const MAX_ADSB_AREA_DISTANCE_NM = 250;

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

async function resolveAdsbOptions(
  io: IO,
  options: DeployWizardOptions,
  prompt: DeployServices["prompt"],
  target: DeployTarget
): Promise<DeployAdsbOptions | undefined> {
  const adsbOptionSupplied = Boolean(
    options.withAdsb || options.adsbFeedUrl || options.adsbSource || options.adsbLat || options.adsbLon || options.adsbDistNm
  );

  if (target !== "docker-compose") {
    if (!adsbOptionSupplied) {
      return undefined;
    }
    throw new CliError("The ADS-B gateway add-on is currently only supported for docker-compose deployments.");
  }

  let shouldEnable = adsbOptionSupplied;
  if (!shouldEnable) {
    if (options.yes) {
      return undefined;
    }

    shouldEnable = await prompt.confirm({
      defaultValue: false,
      message: "Enable the ADS-B gateway sidecar?"
    });
  }

  if (!shouldEnable) {
    return undefined;
  }

  const source =
    options.adsbSource ??
    (options.adsbFeedUrl
      ? "mil"
      : ((await prompt.select({
          choices: [
            {
              description: "Use the adsb.fi public military aircraft endpoint.",
              value: "mil"
            },
            {
              description: "Use the adsb.fi public geographic v3 lat/lon/dist endpoint.",
              value: "geo"
            }
          ],
          defaultValue: "mil",
          message: "Choose an ADS-B source profile"
        })) as DeployAdsbOptions["source"]));

  if (options.adsbFeedUrl) {
    return {
      feedUrl: options.adsbFeedUrl,
      source
    };
  }

  if (source === "mil") {
    return {
      feedUrl: DEFAULT_ADSB_FEED_URL,
      source
    };
  }

  const parseNumber = (value: string, label: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new CliError(`${label} must be a valid number.`);
    }
    return parsed;
  };

  const lat = parseNumber(
    await resolveValidatedPromptedValue({
      io,
      message: "ADS-B latitude",
      prompt,
      supplied: options.adsbLat,
      validate: (value) => {
        if (!value.trim()) {
          throw new CliError("ADS-B latitude is required when --adsb-source geo is selected.");
        }
        const parsed = parseNumber(value, "ADS-B latitude");
        if (parsed < -90 || parsed > 90) {
          throw new CliError("ADS-B latitude must be between -90 and 90.");
        }
      }
    }),
    "ADS-B latitude"
  );
  const lon = parseNumber(
    await resolveValidatedPromptedValue({
      io,
      message: "ADS-B longitude",
      prompt,
      supplied: options.adsbLon,
      validate: (value) => {
        if (!value.trim()) {
          throw new CliError("ADS-B longitude is required when --adsb-source geo is selected.");
        }
        const parsed = parseNumber(value, "ADS-B longitude");
        if (parsed < -180 || parsed > 180) {
          throw new CliError("ADS-B longitude must be between -180 and 180.");
        }
      }
    }),
    "ADS-B longitude"
  );
  const distNm = parseNumber(
    await resolveValidatedPromptedValue({
      defaultValue: String(DEFAULT_ADSB_AREA_DISTANCE_NM),
      io,
      message: "ADS-B distance",
      prompt,
      supplied: options.adsbDistNm,
      validate: (value) => {
        if (!value.trim()) {
          throw new CliError("ADS-B distance is required when --adsb-source geo is selected.");
        }
        const parsed = parseNumber(value, "ADS-B distance");
        if (parsed <= 0 || parsed > MAX_ADSB_AREA_DISTANCE_NM) {
          throw new CliError(`ADS-B distance must be greater than 0 and no more than ${MAX_ADSB_AREA_DISTANCE_NM} NM.`);
        }
      }
    }),
    "ADS-B distance"
  );

  return {
    area: {
      distNm,
      lat,
      lon
    },
    feedUrl: `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${distNm}`,
    source
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
  const forceSaveProfiles = Boolean(options.saveProfiles);

  if (request.yes && !forceSaveProfiles) {
    return [];
  }

  const shouldAddProfiles = forceSaveProfiles
    ? true
    : await prompt.confirm({
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
  const adminKeyFile = await ensureComposeAdminProfileKey({
    adminCertName: envValues.adminCertName,
    certsDir: request.certsDir,
    passphrase: envValues.adminCertPass
  });
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

  const setCurrent = forceSaveProfiles
    ? true
    : await prompt.confirm({
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

async function ensureComposeAdminProfileKey(options: {
  adminCertName: string;
  certsDir: string;
  passphrase: string;
}): Promise<string> {
  const unencryptedKeyFile = path.join(options.certsDir, "files", `${options.adminCertName}.unencrypted.key`);
  const encryptedKeyFile = path.join(options.certsDir, "files", `${options.adminCertName}.key`);
  const transientErrorCodes = new Set(["EACCES", "ENOENT", "EPERM"]);

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await access(unencryptedKeyFile);
      return unencryptedKeyFile;
    } catch {
      // Convert the encrypted key below.
    }

    try {
      const encryptedKey = await readFile(encryptedKeyFile, "utf8");
      const privateKey = createPrivateKey({
        format: "pem",
        key: encryptedKey,
        passphrase: options.passphrase
      });
      const unencryptedKey = privateKey.export({
        format: "pem",
        type: "pkcs8"
      });

      await writeFile(unencryptedKeyFile, unencryptedKey, { mode: 0o600 });
      await chmod(unencryptedKeyFile, 0o600);

      return unencryptedKeyFile;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (attempt < 10 && code && transientErrorCodes.has(code)) {
        await delay(500);
        continue;
      }
      throw error;
    }
  }

  return unencryptedKeyFile;
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

function buildPlanLines(request: DeployRequest): string[] {
  const images = createDeployImages(request.registry, request.imageTag, request.dbImage);
  const executionLine = request.dryRun
    ? "Execution: dry-run (workspace generation only)"
    : request.target === "docker-compose"
      ? "Execution: docker compose up -d"
      : "Execution: kubectl apply -f kubernetes.yaml (experimental)";
  const adsbLine = request.adsb
    ? request.adsb.source === "geo" && request.adsb.area
      ? `ADS-B gateway: enabled (geo ${request.adsb.area.lat}, ${request.adsb.area.lon} within ${request.adsb.area.distNm} NM)`
      : "ADS-B gateway: enabled (mil)"
    : "ADS-B gateway: skipped";

  return [
    `Target: ${request.target}`,
    "Deploy source: TAKCLI-managed deployment templates",
    `Deployment name: ${request.deploymentName}`,
    `Deployment workspace: ${request.deploymentRoot}`,
    `Data dir: ${request.dataDir}`,
    `Logs dir: ${request.logsDir}`,
    `Certs dir: ${request.certsDir}`,
    `Server image: ${images.server}`,
    `Database image: ${images.db}`,
    adsbLine,
    request.adsb ? `ADS-B feed URL: ${request.adsb.feedUrl}` : undefined,
    request.webtakUser ? `Initial WebTAK user: ${request.webtakUser.username}` : "Initial WebTAK user: skipped",
    executionLine
  ].filter((line): line is string => Boolean(line));
}

export async function runDeployWizard(
  io: IO,
  services: DeployServices,
  options: DeployWizardOptions
): Promise<DeployResult> {
  if (!options.json) {
    writeCommandTitle(io, "TAKCLI deploy", "Interactive TAK Server deployment wizard");
  }

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
  const adsb = await resolveAdsbOptions(io, options, services.prompt, target);

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
    "latest"
  );
  const dbImage = options.dbImage ?? createDefaultDbImage(registry, imageTag);
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
    adsb,
    certsDir,
    dataDir,
    dbImage,
    deploymentName,
    deploymentRoot,
    dryRun: Boolean(options.dryRun),
    flavor: "unhardened",
    imageTag,
    logsDir,
    registry,
    target,
    webtakUser,
    yes: Boolean(options.yes)
  };

  const envValues = await collectDeploymentEnvironmentValues(io, options, services.prompt, request);
  validateDeployEnvironmentValues(envValues);
  if (request.webtakUser) {
    validateBootstrapWebTakUser(request.webtakUser);
  }

  if (!options.json) {
    writeSection(io, "Deploy plan", buildPlanLines(request));
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

  const steps = ["Skipped upstream TAK Server clone; using TAKCLI-managed deployment templates"];
  const result: DeployResult = {
    deploymentName: request.deploymentName,
    dryRun: request.dryRun,
    imageTag: request.imageTag,
    registry: request.registry,
    steps,
    target: request.target
  };

  if (request.target === "docker-compose") {
    const compose = await prepareComposeWorkspace({
      envValues,
      request
    });

    result.compose = compose;
    steps.push(
      `Prepared deployment workspace at ${request.deploymentRoot}`,
      `Rendered ${compose.composeFilePath}`,
      `Rendered ${compose.envFilePath}`
    );
    if (request.adsb) {
      steps.push(`Rendered ADS-B gateway assets in ${path.join(request.deploymentRoot, "ads-b")}`);
    }

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
        addons: request.adsb ? ["ads-b"] : [],
        certsDir: request.certsDir,
        compose: {
          composeFilePath: compose.composeFilePath,
          envFilePath: compose.envFilePath
        },
        createdAt: new Date().toISOString(),
        dataDir: request.dataDir,
        deploymentRoot: request.deploymentRoot,
        imageTag: request.imageTag,
        logsDir: request.logsDir,
        profileNames: savedProfiles,
        registry: request.registry,
        target: request.target
      });
      steps.push(`Tracked deployment in ${result.statePath}`);
    } else {
      steps.push("Skipped docker compose up because --dry-run was requested");
    }
  } else {
    const kubernetes = await prepareKubernetesWorkspace({
      envValues,
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
        addons: [],
        certsDir: request.certsDir,
        createdAt: new Date().toISOString(),
        dataDir: request.dataDir,
        deploymentRoot: request.deploymentRoot,
        imageTag: request.imageTag,
        kubernetes: {
          manifestPath: kubernetes.manifestPath,
          namespace: kubernetes.namespace
        },
        logsDir: request.logsDir,
        profileNames: [],
        registry: request.registry,
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
      request.adsb ? "ADS-B gateway: enabled" : "ADS-B gateway: disabled",
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
