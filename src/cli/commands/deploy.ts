import { Command, Option } from "commander";

import { runDeployWizard } from "../../deploy/wizard.js";
import type { DeployServices } from "../../deploy/types.js";
import { CliError, type IO } from "../runtime.js";

function addSharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(
      new Option("--target <target>", "Deployment target").choices(["docker-compose", "kubernetes"])
    )
    .option("--ref <ref>", "TAK Server git ref")
    .option("--name <name>", "Deployment name")
    .option("--deployment-root <path>", "Deployment workspace path")
    .option("--data-dir <path>", "Deployment data directory")
    .option("--logs-dir <path>", "TAK logs directory")
    .option("--certs-dir <path>", "TAK certs directory")
    .option("--cache-root <path>", "TAK Server clone cache path")
    .option("--registry <namespace>", "Image registry namespace")
    .option("--image-tag <tag>", "Image tag to deploy")
    .option("--repo-url <url>", "TAK Server repository to clone")
    .option("--postgres-password <password>", "Postgres password")
    .option("--ca-name <name>", "Certificate authority name")
    .option("--ca-pass <password>", "Certificate authority password")
    .option("--state <value>", "Certificate state or province")
    .option("--city <value>", "Certificate city or locality")
    .option("--organization <value>", "Certificate organization")
    .option("--organizational-unit <value>", "Certificate organizational unit")
    .option("--takserver-cert-pass <password>", "TAK Server certificate password")
    .option("--admin-cert-name <name>", "Admin certificate name")
    .option("--admin-cert-pass <password>", "Admin certificate password")
    .option("--dry-run", "Prepare the workspace but do not start docker compose")
    .option("--yes", "Skip the final confirmation prompt");
}

export function createDeployCommand(io: IO, services: DeployServices): Command {
  return addSharedOptions(new Command("deploy"))
    .description("Walk through a TAK Server deployment and execute a published Docker Compose rollout.")
    .action(async function () {
      const options = (this as Command).opts();
      try {
        await runDeployWizard(io, services, {
          adminCertName: options.adminCertName,
          adminCertPass: options.adminCertPass,
          cacheRoot: options.cacheRoot,
          caName: options.caName,
          caPass: options.caPass,
          certsDir: options.certsDir,
          city: options.city,
          dataDir: options.dataDir,
          deploymentName: options.name,
          deploymentRoot: options.deploymentRoot,
          dryRun: Boolean(options.dryRun),
          imageTag: options.imageTag,
          json: Boolean(options.json),
          logsDir: options.logsDir,
          organization: options.organization,
          organizationalUnit: options.organizationalUnit,
          postgresPassword: options.postgresPassword,
          ref: options.ref,
          registry: options.registry,
          repoUrl: options.repoUrl,
          state: options.state,
          takserverCertPass: options.takserverCertPass,
          target: options.target,
          yes: Boolean(options.yes)
        });
      } catch (error) {
        if (error instanceof CliError) {
          throw error;
        }
        throw new CliError(error instanceof Error ? error.message : String(error));
      }
    });
}
