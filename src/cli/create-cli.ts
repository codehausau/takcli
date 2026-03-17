import { Command, CommanderError } from "commander";

import { getCliVersion } from "../core/version.js";
import { writeJson } from "./output.js";
import { createCompletionCommand, createHiddenCompletionCommand } from "./completion.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createProfileCommand } from "./commands/profile.js";
import { createStatusCommand } from "./commands/status.js";
import { CliError, createProcessIo, writeError, writeLine, type IO } from "./runtime.js";

export function createCli(io: IO = createProcessIo()): Command {
  const program = new Command();

  program
    .name("takcli")
    .description("Operator CLI for TAK workflows.")
    .showHelpAfterError()
    .version(getCliVersion(), "-V, --version", "Show the current TAKCLI version.");

  program.addCommand(createCompletionCommand(io));
  program.addCommand(createDoctorCommand(io));
  program.addCommand(createStatusCommand(io));
  program.addCommand(createProfileCommand(io));
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

export async function runCli(argv: string[], io: IO = createProcessIo()): Promise<number> {
  const program = createCli(io);
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
