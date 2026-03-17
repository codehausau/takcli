import { Command } from "commander";

export interface IO {
  stderr: (text: string) => void;
  stdout: (text: string) => void;
}

export interface GlobalOptions {
  config?: string;
  json?: boolean;
  profile?: string;
  server?: string;
  verbose?: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function createProcessIo(): IO {
  return {
    stderr: (text: string) => process.stderr.write(text),
    stdout: (text: string) => process.stdout.write(text)
  };
}

export function getGlobalOptions(command: Command): GlobalOptions {
  const opts = command.opts();
  return {
    config: opts.config,
    json: Boolean(opts.json),
    profile: opts.profile,
    server: opts.server,
    verbose: Boolean(opts.verbose)
  };
}

export function writeError(io: IO, message: string): void {
  io.stderr(`${message}\n`);
}

export function writeLine(io: IO, message = ""): void {
  io.stdout(`${message}\n`);
}
