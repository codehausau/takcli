import { spawn } from "node:child_process";
import process from "node:process";
import { emitKeypressEvents } from "node:readline";
import readline from "node:readline/promises";

import { CliError } from "../cli/runtime.js";
import type { CommandRunner, CommandExecutionResult, DeployPrompt, DeployServices } from "./types.js";

class ProcessCommandRunner implements CommandRunner {
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
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stderr,
          stdout
        });
      });
    });
  }
}

class ReadlinePrompt implements DeployPrompt {
  async confirm(options: { defaultValue?: boolean; message: string }): Promise<boolean> {
    const hint = options.defaultValue ? "Y/n" : "y/N";
    const answer = await this.ask(`${options.message} [${hint}] `);
    if (!answer) {
      return options.defaultValue ?? false;
    }

    const normalized = answer.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes") {
      return true;
    }
    if (normalized === "n" || normalized === "no") {
      return false;
    }

    throw new CliError(`Invalid confirmation response: ${answer}`);
  }

  async input(options: { defaultValue?: string; message: string; secret?: boolean }): Promise<string> {
    const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
    const answer = await this.ask(`${options.message}${suffix}: `, options.secret);
    const trimmed = answer.trim();
    if (trimmed) {
      return trimmed;
    }
    if (options.defaultValue !== undefined) {
      return options.defaultValue;
    }

    throw new CliError(`A value is required for "${options.message}".`);
  }

  async select(options: {
    choices: Array<{ description?: string; value: string }>;
    defaultValue?: string;
    message: string;
  }): Promise<string> {
    const lines = options.choices.map((choice) =>
      choice.description ? `- ${choice.value}: ${choice.description}` : `- ${choice.value}`
    );
    process.stdout.write(`${options.message}\n${lines.join("\n")}\n`);
    const answer = await this.ask(
      `Selection${options.defaultValue ? ` [${options.defaultValue}]` : ""}: `
    );
    const value = answer.trim() || options.defaultValue;
    if (!value) {
      throw new CliError(`A selection is required for "${options.message}".`);
    }

    const matched = options.choices.find((choice) => choice.value === value);
    if (!matched) {
      throw new CliError(`Unsupported selection: ${value}`);
    }
    return matched.value;
  }

  private async ask(prompt: string, secret = false): Promise<string> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliError("Interactive deploy prompts require a TTY. Re-run with explicit deploy options.");
    }

    if (secret) {
      return await this.askSecret(prompt);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  private async askSecret(prompt: string): Promise<string> {
    const input = process.stdin;
    const output = process.stdout;

    if (!input.isTTY || !output.isTTY || !input.setRawMode) {
      throw new CliError("Secret deploy prompts require a TTY. Re-run with explicit deploy options.");
    }

    emitKeypressEvents(input);

    return await new Promise<string>((resolve, reject) => {
      const wasRaw = input.isRaw ?? false;
      let value = "";

      const cleanup = () => {
        input.off("keypress", onKeypress);
        input.setRawMode(wasRaw);
        input.pause();
        output.write("\n");
      };

      const onKeypress = (chunk: string, key: { ctrl?: boolean; meta?: boolean; name?: string; sequence?: string }) => {
        if (key.ctrl && key.name === "c") {
          cleanup();
          reject(new CliError("Deployment canceled.", 130));
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          cleanup();
          resolve(value);
          return;
        }

        if (key.name === "backspace") {
          value = value.slice(0, -1);
          return;
        }

        if (!key.ctrl && !key.meta && chunk) {
          value += chunk;
        }
      };

      output.write(prompt);
      input.setRawMode(true);
      input.resume();
      input.on("keypress", onKeypress);
    });
  }
}

export function createDefaultDeployServices(): DeployServices {
  return {
    prompt: new ReadlinePrompt(),
    runner: new ProcessCommandRunner()
  };
}
