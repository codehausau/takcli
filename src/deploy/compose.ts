import path from "node:path";
import { cp, mkdir, writeFile } from "node:fs/promises";

import YAML from "yaml";

import { CliError } from "../cli/runtime.js";
import { createDeployImages } from "./images.js";
import type {
  ComposeImageSet,
  DeployEnvironmentValues,
  ComposeWorkspace,
  DeployRequest
} from "./types.js";

const FULL_COMPOSE_RELATIVE_PATH = path.join("src", "takserver-core", "docker", "full");

export function renderComposeEnvFile(values: DeployEnvironmentValues): string {
  const lines = [
    ["POSTGRES_PASSWORD", values.postgresPassword],
    ["CA_NAME", values.caName],
    ["CA_PASS", values.caPass],
    ["STATE", values.state],
    ["CITY", values.city],
    ["ORGANIZATION", values.organization],
    ["ORGANIZATIONAL_UNIT", values.organizationalUnit],
    ["TAKSERVER_CERT_PASS", values.takserverCertPass],
    ["ADMIN_CERT_NAME", values.adminCertName],
    ["ADMIN_CERT_PASS", values.adminCertPass],
    ["POSTGRES_DB", "cot"],
    ["POSTGRES_USER", "martiuser"],
    ["POSTGRES_HOST", "tak-database"],
    ["POSTGRES_PORT", "5432"],
    ["POSTGRES_URL", "jdbc:postgresql://tak-database:5432/cot"]
  ];

  return `${lines.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function renderTakCliComposeYaml(images: ComposeImageSet, request: DeployRequest): string {
  const dbDataDir = path.join(request.deploymentRoot, "postgresql");
  const document = {
    version: "3.4",
    services: {
      takserver: {
        image: images.server,
        env_file: ["./.env"],
        volumes: [
          `${request.dataDir}:/opt/tak/data`,
          `${request.logsDir}:/opt/tak/data/logs`,
          `${request.certsDir}:/opt/tak/data/certs`
        ],
        stop_grace_period: "30s",
        networks: ["taknet"],
        ports: ["8089:8089", "8443:8443", "8444:8444", "8446:8446", "9000:9000", "9001:9001"],
        depends_on: ["tak-database"]
      },
      "tak-database": {
        image: images.db,
        env_file: ["./.env"],
        stop_grace_period: "30s",
        networks: ["taknet"],
        ports: ["5432:5432"],
        volumes: [`${dbDataDir}:/var/lib/postgresql/data`]
      }
    },
    networks: {
      taknet: null
    }
  };

  return YAML.stringify(document);
}

export async function prepareComposeWorkspace(options: {
  clonePath: string;
  envValues: DeployEnvironmentValues;
  gitCommit: string;
  request: DeployRequest;
}): Promise<ComposeWorkspace> {
  const upstreamSourcePath = path.join(options.clonePath, FULL_COMPOSE_RELATIVE_PATH);
  const requiredFiles = [
    path.join(upstreamSourcePath, "docker-compose.yml"),
    path.join(upstreamSourcePath, "EDIT_ME.env")
  ];

  for (const filePath of requiredFiles) {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
    } catch {
      // nothing
    }
  }

  await cp(
    upstreamSourcePath,
    path.join(options.request.deploymentRoot, "upstream", "full"),
    { recursive: true }
  ).catch((error: unknown) => {
    throw new CliError(
      `Unable to locate Docker Compose assets in the TAK Server clone at ${upstreamSourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  await mkdir(options.request.deploymentRoot, { recursive: true });
  await mkdir(options.request.dataDir, { recursive: true });
  await mkdir(options.request.logsDir, { recursive: true });
  await mkdir(options.request.certsDir, { recursive: true });
  const dbDataDir = path.join(options.request.deploymentRoot, "postgresql");
  await mkdir(dbDataDir, { recursive: true });

  const images = createDeployImages(options.request.registry, options.request.imageTag);
  const composeFilePath = path.join(options.request.deploymentRoot, "docker-compose.yml");
  const envFilePath = path.join(options.request.deploymentRoot, ".env");
  const deploymentMetadataPath = path.join(options.request.deploymentRoot, "takcli-deployment.yaml");

  await writeFile(composeFilePath, renderTakCliComposeYaml(images, options.request), "utf8");
  await writeFile(envFilePath, renderComposeEnvFile(options.envValues), { encoding: "utf8", mode: 0o600 });
  await writeFile(
    deploymentMetadataPath,
    YAML.stringify({
      deploymentName: options.request.deploymentName,
      flavor: options.request.flavor,
      gitCommit: options.gitCommit,
      ref: options.request.ref,
      registry: options.request.registry,
      repoUrl: options.request.repoUrl,
      target: options.request.target,
      workspace: {
        certsDir: options.request.certsDir,
        dataDir: options.request.dataDir,
        dbDataDir,
        logsDir: options.request.logsDir,
        root: options.request.deploymentRoot
      }
    }),
    "utf8"
  );

  return {
    composeFilePath,
    dbDataDir,
    deploymentMetadataPath,
    envFilePath,
    images,
    upstreamSourcePath,
    workspacePath: options.request.deploymentRoot
  };
}
