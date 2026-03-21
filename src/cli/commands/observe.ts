import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { loadDeploymentState } from "../../deploy/state.js";
import {
  listObserveLogs,
  openObserveLogStream,
  readObserveLogs,
  type ObserveLogTargetName,
  type ObserveServices
} from "../../observe/service.js";
import { renderTable, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, getGlobalOptions, type IO } from "../runtime.js";

function parseLineCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid line count: ${value}`);
  }
  return parsed;
}

function addObserveSharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--deployment <name>", "Use a tracked deployment by name"))
    .addOption(new Option("--lines <n>", "Number of lines to show").default("100").argParser(parseLineCount));
}

function parseObserveTarget(target: string): ObserveLogTargetName {
  return target as ObserveLogTargetName;
}

async function buildObserveContext(command: Command) {
  const options = getGlobalOptions(command);
  return {
    config: await loadConfig(options.config, { allowMissing: true }),
    deploymentState: await loadDeploymentState(options.config, { allowMissing: true }),
    global: options,
    raw: command.opts()
  };
}

function writeObserveTargetSection(
  io: IO,
  result: {
    backend: string;
    configPath: string;
    deployment: {
      deploymentName: string;
      namespace?: string;
      profileNames: string[];
      source: string;
    };
  }
): void {
  writeSection(io, "Target", [
    `Config: ${result.configPath}`,
    `Deployment: ${result.deployment.deploymentName}`,
    `Backend: ${result.backend}`,
    `Tracked profiles: ${result.deployment.profileNames.length > 0 ? result.deployment.profileNames.join(", ") : "(none)"}`,
    `Workspace: ${result.deployment.source}`,
    result.deployment.namespace ? `Namespace: ${result.deployment.namespace}` : "Namespace: (not applicable)"
  ]);
}

export function createObserveCommand(io: IO, services: ObserveServices): Command {
  const command = new Command("observe").description("Inspect TAK runtime signals such as curated logs.");
  const logsCommand = addObserveSharedOptions(
    new Command("logs")
      .description("View curated TAK logs for a tracked deployment.")
      .argument("[target]", "Curated log target to inspect, or `list` to show available targets")
      .option("--follow", "Stream appended log output")
      .action(async function (target: string | undefined) {
        const command = this as Command;
        const context = await buildObserveContext(command);
        const rawOptions = context.raw as {
          deployment?: string;
          follow?: boolean;
          lines: number;
        };

        if (!target) {
          throw new CliError("A log target is required. Try `takcli observe logs list`.");
        }

        if (target === "list") {
          const result = await listObserveLogs(
            {
              config: context.config,
              deploymentState: context.deploymentState
            },
            rawOptions.deployment
          );

          if (context.global.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI observe logs list");
          writeObserveTargetSection(io, result);
          writeSection(
            io,
            "Targets",
            renderTable(
              ["TARGET", "KIND", "REQUIRED", "SOURCE"],
              result.targets.map((entry) => [
                entry.name,
                entry.kind,
                entry.optional ? "optional" : "required",
                entry.source
              ])
            )
          );
          return;
        }

        if (context.global.json && rawOptions.follow) {
          throw new CliError("`takcli observe logs` does not support `--json` together with `--follow`.");
        }

        if (rawOptions.follow) {
          const controller = new AbortController();
          const onInterrupt = () => controller.abort();
          process.once("SIGINT", onInterrupt);

          try {
            const result = await openObserveLogStream(
              {
                config: context.config,
                deploymentState: context.deploymentState
              },
              services,
              {
                deploymentName: rawOptions.deployment,
                lines: rawOptions.lines,
                signal: controller.signal,
                target: parseObserveTarget(target)
              }
            );

            writeCommandTitle(io, "TAKCLI observe logs");
            writeObserveTargetSection(io, result);
            writeSection(io, "Log source", [`Target: ${result.target}`, `Source: ${result.source}`, "Mode: follow"]);

            for await (const chunk of result.stream) {
              io.stdout(chunk);
            }
          } finally {
            process.removeListener("SIGINT", onInterrupt);
          }
          return;
        }

        const result = await readObserveLogs(
          {
            config: context.config,
            deploymentState: context.deploymentState
          },
          services,
          {
            deploymentName: rawOptions.deployment,
            lines: rawOptions.lines,
            target: parseObserveTarget(target)
          }
        );

        if (context.global.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI observe logs");
        writeObserveTargetSection(io, result);
        writeSection(io, "Log source", [`Target: ${result.target}`, `Source: ${result.source}`, `Lines: ${result.lines.length}`]);
        if (result.lines.length === 0) {
          writeSection(io, "Output", ["(no log output)"]);
          return;
        }
        io.stdout(`${result.lines.join("\n")}\n`);
      })
  );

  command.addCommand(logsCommand);

  return command;
}
