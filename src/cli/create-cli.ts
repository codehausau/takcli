import { Command, CommanderError } from "commander";

import { getCliVersion } from "../core/version.js";
import { createDefaultDeployServices } from "../deploy/services.js";
import type { DeployServices } from "../deploy/types.js";
import { createDefaultObserveServices } from "../observe/service.js";
import type { ObserveServices } from "../observe/service.js";
import { writeJson } from "./output.js";
import { createCompletionCommand, createHiddenCompletionCommand } from "./completion.js";
import { createCotCommand } from "./commands/cot.js";
import { createDeployCommand } from "./commands/deploy.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createObserveCommand } from "./commands/observe.js";
import { createProfileCommand } from "./commands/profile.js";
import { createReplayCommand } from "./commands/replay.js";
import { createStatusCommand } from "./commands/status.js";
import { createUsersCommand } from "./commands/users.js";
import { CliError, createProcessIo, writeError, writeLine, type IO } from "./runtime.js";

export interface CliServices {
  deploy: DeployServices;
  observe: ObserveServices;
}

export function createDefaultCliServices(): CliServices {
  return {
    deploy: createDefaultDeployServices(),
    observe: createDefaultObserveServices()
  };
}

export function createCli(io: IO = createProcessIo(), services: CliServices = createDefaultCliServices()): Command {
  const program = new Command();

  program
    .name("takcli")
    .description("Operator CLI for TAK workflows.")
    .showHelpAfterError()
    .version(getCliVersion(), "-V, --version", "Show the current TAKCLI version.");

  program.addCommand(createCompletionCommand(io));
  program.addCommand(createCotCommand(io));
  program.addCommand(createDeployCommand(io, services.deploy));
  program.addCommand(createDoctorCommand(io));
  program.addCommand(createObserveCommand(io, services.observe));
  program.addCommand(createStatusCommand(io));
  program.addCommand(createProfileCommand(io));
  program.addCommand(createReplayCommand(io));
  program.addCommand(createUsersCommand(io));
  program.addCommand(createHiddenCompletionCommand(program, io));
  program
    .command("version")
    .description("Show the current TAKCLI version.")
    .option("--json", "Emit JSON output")
    .action(function () {
      const version = getCliVersion();
      if ((this as Command).opts().json) {
        writeJson(io, {
          command: "version",
          node: process.version,
          version
        });
        return;
      }

      writeLine(io, version);
    });

  return program;
}

export async function runCli(
  argv: string[],
  io: IO = createProcessIo(),
  services: CliServices = createDefaultCliServices()
): Promise<number> {
  const program = createCli(io, services);
  program.exitOverride();

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      writeError(io, error.message);
      return error.exitCode;
    }

    if (error instanceof CommanderError) {
      if (error.exitCode !== 0 && error.message) {
        writeError(io, error.message);
      }
      return error.exitCode;
    }

    writeError(io, error instanceof Error ? error.message : String(error));
    return 1;
  }
}
