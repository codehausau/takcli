import { spawn } from "node:child_process";

interface BrowserLaunchCommand {
  args: string[];
  command: string;
}

interface BrowserRuntime {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export class BrowserOpenError extends Error {
  readonly code?: string;
  readonly openerCommand?: string;
  readonly reason: "headless" | "spawn" | "unsupported";

  public constructor(
    message: string,
    options: {
      code?: string;
      openerCommand?: string;
      reason: "headless" | "spawn" | "unsupported";
    }
  ) {
    super(message);
    this.name = "BrowserOpenError";
    this.code = options.code;
    this.openerCommand = options.openerCommand;
    this.reason = options.reason;
  }
}

function isWsl(runtime: BrowserRuntime): boolean {
  return Boolean(runtime.env.WSL_DISTRO_NAME || runtime.env.WSL_INTEROP);
}

function isGraphicalLinuxSession(runtime: BrowserRuntime): boolean {
  return Boolean(runtime.env.DISPLAY || runtime.env.WAYLAND_DISPLAY || runtime.env.MIR_SOCKET);
}

export function getBrowserLaunchCommands(
  url: string,
  runtime: BrowserRuntime = { env: process.env, platform: process.platform }
): BrowserLaunchCommand[] {
  if (runtime.platform === "darwin") {
    return [{ args: [url], command: "open" }];
  }

  if (runtime.platform === "win32") {
    return [{ args: ["/c", "start", "", url], command: "cmd" }];
  }

  if (runtime.platform === "linux" && isWsl(runtime)) {
    return [
      { args: [url], command: "wslview" },
      { args: [url], command: "xdg-open" },
      { args: ["open", url], command: "gio" },
      { args: [url], command: "sensible-browser" }
    ];
  }

  if (runtime.platform === "linux") {
    return [
      { args: [url], command: "xdg-open" },
      { args: ["open", url], command: "gio" },
      { args: [url], command: "sensible-browser" }
    ];
  }

  return [];
}

export function shouldAttemptBrowserOpen(
  runtime: BrowserRuntime = { env: process.env, platform: process.platform }
): boolean {
  if (runtime.platform !== "linux") {
    return true;
  }

  if (isWsl(runtime)) {
    return true;
  }

  return isGraphicalLinuxSession(runtime);
}

async function spawnCommand(command: BrowserLaunchCommand): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore"
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openBrowser(url: string): Promise<void> {
  const runtime: BrowserRuntime = { env: process.env, platform: process.platform };
  if (!shouldAttemptBrowserOpen(runtime)) {
    throw new BrowserOpenError("No graphical desktop session was detected.", {
      reason: "headless"
    });
  }

  const commands = getBrowserLaunchCommands(url, runtime);
  if (commands.length === 0) {
    throw new BrowserOpenError(`Automatic browser launch is not supported on platform ${runtime.platform}.`, {
      reason: "unsupported"
    });
  }

  let lastError: Error | undefined;
  for (const command of commands) {
    try {
      await spawnCommand(command);
      return;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const code = "code" in failure ? String((failure as NodeJS.ErrnoException).code ?? "") : "";
      if (code === "ENOENT") {
        lastError = failure;
        continue;
      }

      throw new BrowserOpenError(failure.message, {
        code,
        openerCommand: command.command,
        reason: "spawn"
      });
    }
  }

  throw new BrowserOpenError(lastError?.message ?? "No supported browser opener command was found.", {
    code: lastError && "code" in lastError ? String((lastError as NodeJS.ErrnoException).code ?? "") : undefined,
    openerCommand: commands[0]?.command,
    reason: "spawn"
  });
}

export function describeBrowserOpenFailure(
  error: unknown,
  url: string,
  options: { supportsNoOpenFlag?: boolean } = {}
): string {
  if (error instanceof BrowserOpenError) {
    if (error.reason === "headless") {
      return `No graphical desktop session was detected. Open ${url} manually${
        options.supportsNoOpenFlag ? " or rerun with --no-open." : "."
      }`;
    }

    if (error.reason === "unsupported") {
      return `${error.message} Open ${url} manually.`;
    }

    if (error.code === "ENOENT") {
      const opener = error.openerCommand ? ` (${error.openerCommand})` : "";
      return `No supported browser opener command was found${opener}. Open ${url} manually${
        options.supportsNoOpenFlag ? " or rerun with --no-open." : "."
      }`;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${message} Open ${url} manually${options.supportsNoOpenFlag ? " or rerun with --no-open." : "."}`;
}
