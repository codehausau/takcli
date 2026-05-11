import process from "node:process";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { emitKeypressEvents } from "node:readline";

import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { describeBrowserOpenFailure, openBrowser } from "../../map/browser.js";
import { parseMapLaunchMode, resolveMapLaunchSettings } from "../../map/launch-mode.js";
import { launchMapServer } from "../../map/service.js";
import { loadReplayDataset } from "../../replay/geojson.js";
import { interpolateReplayDataset } from "../../replay/interpolation.js";
import { createReplayRunner, describeReplayTarget, resolveReplayStartIndex } from "../../replay/service.js";
import { createReplayTelemetryPublisher } from "../../replay/telemetry.js";
import type { ReplayProgressSnapshot, ReplaySourceOption, ReplayTimeMode } from "../../replay/types.js";
import { color, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, type IO } from "../runtime.js";

const SUPPORTED_REPLAY_SOURCES: ReplaySourceOption[] = ["auto", "geojson-vessel-tracks"];
const SUPPORTED_TIME_MODES: ReplayTimeMode[] = ["source", "live"];
const SEEK_STEP_MS = 60 * 60 * 1000;

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }

  return parsed;
}

function parseRequiredPort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }

  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parsePositiveNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseTimeout(value: string): number {
  return parsePositiveInteger(value, "timeout");
}

function parseDurationMs(value: string, label: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  const parsed = Math.round(amount * multiplier);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseReplaySource(value: string): ReplaySourceOption {
  if (SUPPORTED_REPLAY_SOURCES.includes(value as ReplaySourceOption)) {
    return value as ReplaySourceOption;
  }

  throw new CliError(`Unsupported replay source: ${value}`);
}

function parseTimeMode(value: string): ReplayTimeMode {
  if (SUPPORTED_TIME_MODES.includes(value as ReplayTimeMode)) {
    return value as ReplayTimeMode;
  }

  throw new CliError(`Unsupported replay time mode: ${value}`);
}

function canUseInteractiveControls(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stdin.setRawMode);
}

function renderProgress(snapshot: ReplayProgressSnapshot): string {
  const state =
    snapshot.state === "running" && snapshot.paused
      ? "paused"
      : snapshot.state;
  const time = snapshot.effectiveSourceTime ?? snapshot.trackPoint?.sourceTime ?? "-";
  const uid = snapshot.trackPoint?.uid ?? "-";
  const loop = snapshot.loopCount ? `${snapshot.currentLoop}/${snapshot.loopCount}` : `${snapshot.currentLoop}`;
  return `Replay ${state} | sent=${snapshot.sentEvents} | loop=${loop} | source-time=${time} | uid=${uid}`;
}

function setupInteractiveControls(
  io: IO,
  runner: ReturnType<typeof createReplayRunner>,
  render: () => void
): () => void {
  const input = process.stdin;
  const output = process.stdout;

  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    return () => {};
  }

  emitKeypressEvents(input);
  const wasRaw = input.isRaw ?? false;

  const onKeypress = (chunk: string, key: { ctrl?: boolean; meta?: boolean; name?: string }) => {
    if (key.ctrl && key.name === "c") {
      runner.stop();
      return;
    }

    if (key.name === "q") {
      runner.stop();
      return;
    }

    if (key.name === "space") {
      runner.togglePause();
      render();
      return;
    }

    if (key.name === "left" || chunk === "[") {
      runner.seekBySourceMs(-SEEK_STEP_MS);
      render();
      return;
    }

    if (key.name === "right" || chunk === "]") {
      runner.seekBySourceMs(SEEK_STEP_MS);
      render();
      return;
    }

    if (key.name === "r") {
      runner.restart();
      render();
    }
  };

  output.write("\x1b[?25l");
  input.setRawMode(true);
  input.resume();
  input.on("keypress", onKeypress);
  io.stdout(
    `${color.dim("Controls: space pause/resume, r restart, [ or left rewind 1h, ] or right forward 1h, q quit.")}\n`
  );

  return () => {
    input.off("keypress", onKeypress);
    input.setRawMode(wasRaw);
    input.pause();
    output.write("\x1b[?25h");
  };
}

function addSharedTakOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--api-port <port>", "Override API port for this command").argParser(parseRequiredPort))
    .addOption(new Option("--cot-port <port>", "Override CoT port for this command").argParser(parseRequiredPort))
    .addOption(new Option("--enrollment-port <port>", "Override enrollment port for this command").argParser(parseRequiredPort))
    .addOption(new Option("--federation-port <port>", "Override federation port for this command").argParser(parseRequiredPort))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--timeout <ms>", "Timeout in milliseconds").default("5000"))
    .addOption(new Option("--verbose", "Enable verbose output"));
}

async function discoverReplayPathFromWorkingTree(): Promise<string | undefined> {
  const searchRoots = [process.cwd(), path.join(process.cwd(), "data")];
  const candidates = new Set<string>();

  for (const root of searchRoots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (extension !== ".geojson" && extension !== ".json") {
          continue;
        }

        candidates.add(path.join(root, entry.name));
      }
    } catch {
      // Ignore missing or unreadable roots while searching for a convenient default.
    }
  }

  if (candidates.size === 1) {
    return [...candidates][0];
  }

  return undefined;
}

async function resolveReplayPath(pathArgument: string | undefined, fileOption: string | undefined): Promise<string> {
  const explicit = pathArgument?.trim() || fileOption?.trim();
  if (explicit) {
    return explicit;
  }

  const discovered = await discoverReplayPathFromWorkingTree();
  if (discovered) {
    return discovered;
  }

  throw new CliError(
    "No replay source was provided. Use `takcli start replay <path>` or `takcli start replay --file <path>`."
  );
}

export function createStartCommand(io: IO): Command {
  const command = new Command("start").description("Start operator workflows for map viewing and replay injection.");

  command.addCommand(
    addSharedTakOptions(
      new Command("map")
        .description("Start the TAK map UI and automatically follow live CoT from TAK.")
        .addOption(new Option("--mode <mode>", "Map launch mode: local or web").default("local").argParser(parseMapLaunchMode))
        .addOption(new Option("--host <address>", "Host address for the local UI server").default("127.0.0.1"))
        .addOption(new Option("--port <port>", "Port for the local UI server (0 for an ephemeral port)").default("3000").argParser(parsePort))
        .addOption(new Option("--no-open", "Do not open the UI in the default browser after launch"))
        .addOption(new Option("--title <text>", "Custom title shown in the UI").default("TAKCLI Map"))
        .addOption(new Option("--logo-label <text>", "Placeholder label shown in the company logo slot").default("Your Logo"))
        .action(async function () {
          const runtime = this as Command;
          const options = runtime.opts<{
            apiPort?: number;
            config?: string;
            cotPort?: number;
            enrollmentPort?: number;
            federationPort?: number;
            host: string;
            insecure?: boolean;
            logoLabel: string;
            mode: "local" | "web";
            open: boolean;
            port: number;
            profile?: string;
            server?: string;
            timeout: string;
            title: string;
          }>();
          const launchSettings = resolveMapLaunchSettings({
            defaultOpen: options.open,
            host: options.host,
            hostValueSource: runtime.getOptionValueSource("host"),
            mode: options.mode,
            openValueSource: runtime.getOptionValueSource("open")
          });
          const timeoutMs = parseTimeout(options.timeout);
          const config = await loadConfig(options.config, { allowMissing: true });
          const profile = resolveProfileTarget(config.config, {
            apiPortOverride: options.apiPort,
            cotPortOverride: options.cotPort,
            enrollmentPortOverride: options.enrollmentPort,
            federationPortOverride: options.federationPort,
            insecureSkipVerifyOverride: options.insecure ? true : undefined,
            profileName: options.profile,
            serverOverride: options.server
          });
          const server = await launchMapServer({
            autoStartLive: true,
            config,
            host: launchSettings.host,
            logoLabel: options.logoLabel,
            port: options.port,
            profile,
            timeoutMs,
            title: options.title
          });

          const handleSignal = () => {
            void server.close();
          };

          process.once("SIGINT", handleSignal);
          process.once("SIGTERM", handleSignal);

          try {
            writeCommandTitle(io, "TAKCLI start map", "Live TAK CoT map workflow");
            writeSection(io, "Session", [
              `Mode: ${options.mode}`,
              `Profile: ${profile.name ?? "(ad-hoc)"}`,
              `Server: ${profile.server}`,
              `UI: ${server.url}`,
              "Live CoT follow: enabled",
              "Replay mode: TAK-fed live stream (primary)",
              "Stop: Ctrl+C"
            ]);

            if (launchSettings.open) {
              try {
                await openBrowser(server.url);
              } catch (error) {
                io.stderr(
                  `The map UI launched, but opening the browser failed: ${
                    describeBrowserOpenFailure(error, server.url, { supportsNoOpenFlag: true })
                  }\n`
                );
              }
            }

            await server.waitForClose();
          } finally {
            process.off("SIGINT", handleSignal);
            process.off("SIGTERM", handleSignal);
          }
        })
    )
  );

  command.addCommand(
    addSharedTakOptions(
      new Command("replay")
        .description("Start replay injection into TAK so live CoT consumers can follow the tracks.")
        .argument("[path]", "Path or URL to the replay input file")
        .addOption(new Option("--file <path-or-url>", "Path or URL to the replay input file"))
        .addOption(
          new Option("--source <source>", "Replay source type")
            .default("auto")
            .argParser(parseReplaySource)
        )
        .addOption(new Option("--start-from <time>", "Use start, end, or an ISO-8601 source timestamp").default("start"))
        .addOption(new Option("--speed <factor>", "Replay speed multiplier").default("3600").argParser((value) => parsePositiveNumber(value, "speed")))
        .addOption(new Option("--loop", "Restart from the selected start point after the final event"))
        .addOption(new Option("--loop-count <n>", "Run exactly N replay passes").argParser((value) => parsePositiveInteger(value, "loop-count")))
        .addOption(new Option("--loop-delay <duration>", "Delay between replay passes, e.g. 500ms, 10s, 2m").default("0s").argParser((value) => parseDurationMs(value, "loop-delay")))
        .addOption(new Option("--time-mode <mode>", "Source time metadata mode").default("source").argParser(parseTimeMode))
        .addOption(new Option("--interpolate <duration>", "Generate synthetic in-between points at this source-time interval, e.g. 30s, 1m").argParser((value) => parseDurationMs(value, "interpolate")))
        .addOption(new Option("--max-events <n>", "Stop after replaying N events").argParser((value) => parsePositiveInteger(value, "max-events")))
        .addOption(new Option("--stale-seconds <seconds>", "CoT stale window in seconds").default("300").argParser((value) => parsePositiveInteger(value, "stale-seconds")))
        .addOption(new Option("--cot-type <type>", "CoT type to emit").default("a-u-S-X-M"))
        .addOption(new Option("--how <value>", "CoT how value").default("m-g"))
        .action(async function (pathArgument: string | undefined) {
          const runtime = this as Command;
          const options = runtime.opts<{
            config?: string;
            cotPort?: number;
            cotType: string;
            file?: string;
            how: string;
            insecure?: boolean;
            interpolate?: number;
            json?: boolean;
            loop?: boolean;
            loopCount?: number;
            loopDelay: number;
            maxEvents?: number;
            profile?: string;
            server?: string;
            source: ReplaySourceOption;
            speed: number;
            staleSeconds: number;
            startFrom: string;
            timeMode: ReplayTimeMode;
            timeout: string;
          }>();
          const timeoutMs = parseTimeout(options.timeout);
          const replayPath = await resolveReplayPath(pathArgument, options.file);
          const config = await loadConfig(options.config, { allowMissing: true });
          const profile = resolveProfileTarget(config.config, {
            cotPortOverride: options.cotPort,
            insecureSkipVerifyOverride: options.insecure ? true : undefined,
            profileName: options.profile,
            serverOverride: options.server
          });
          const loadedDataset = await loadReplayDataset(replayPath, options.source);
          const dataset = options.interpolate
            ? interpolateReplayDataset(loadedDataset, options.interpolate)
            : loadedDataset;
          const startIndex = resolveReplayStartIndex(dataset, options.startFrom);
          const interactive = !options.json && canUseInteractiveControls();
          let lastRendered = "";
          const telemetry = createReplayTelemetryPublisher({
            dataset,
            maxEvents: options.maxEvents,
            profile,
            speed: options.speed,
            startFromTime: dataset.trackPoints[startIndex]!.sourceTime
          });
          await telemetry.initialize();

          const runner = createReplayRunner(dataset, {
            cotType: options.cotType,
            how: options.how,
            loop: Boolean(options.loop || options.loopCount),
            loopCount: options.loopCount,
            loopDelayMs: options.loopDelay,
            maxEvents: options.maxEvents,
            onStateChange: (snapshot) => {
              void telemetry.onStateChange(snapshot);
              if (!interactive) {
                return;
              }

              const line = renderProgress(snapshot);
              if (line === lastRendered) {
                return;
              }

              process.stdout.write(`\r\x1b[2K${line}`);
              lastRendered = line;
            },
            profile,
            speed: options.speed,
            staleSeconds: options.staleSeconds,
            startIndex,
            timeMode: options.timeMode,
            timeoutMs
          });

          if (!options.json) {
            writeCommandTitle(io, "TAKCLI start replay", "Inject replay CoT into TAK for live consumers");
            writeSection(io, "Target", describeReplayTarget(profile));
            writeSection(io, "Dataset", [
              `Source: ${dataset.detectedSource}`,
              `File: ${dataset.filePath}`,
              `Track points: ${dataset.trackPoints.length}`,
              `Interpolation: ${
                dataset.interpolation
                  ? `every ${dataset.interpolation.intervalMs}ms (${dataset.interpolation.generatedTrackPoints} generated from ${dataset.interpolation.originalTrackPoints} original)`
                  : "disabled"
              }`,
              `Range: ${dataset.startTime} to ${dataset.endTime} UTC`,
              `Start from: ${dataset.trackPoints[startIndex]!.sourceTime}`,
              `Replay speed: ${options.speed}x`,
              `Loop: ${options.loop || options.loopCount ? `enabled (${options.loopCount ?? "unbounded"})` : "disabled"}`,
              `Loop delay: ${options.loopDelay}ms`,
              `Time mode: ${options.timeMode}`,
              `Max events: ${options.maxEvents ?? "(unbounded)"}`
            ]);
            writeSection(io, "Execution", [
              "Mode: inject into TAK CoT stream",
              interactive ? "Interactive controls: enabled" : "Interactive controls: unavailable without a TTY",
              "Stop: Ctrl+C"
            ]);
          }

          const teardownControls = interactive ? setupInteractiveControls(io, runner, () => {
            const line = renderProgress(runner.getSnapshot());
            if (line === lastRendered) {
              return;
            }

            process.stdout.write(`\r\x1b[2K${line}`);
            lastRendered = line;
          }) : () => {};
          const onInterrupt = () => runner.stop();
          process.once("SIGINT", onInterrupt);

          try {
            const result = await runner.run();
            await telemetry.onRunCompleted(result);
            if (interactive) {
              process.stdout.write("\r\x1b[2K");
            }

            if (options.json) {
              writeJson(io, result);
              return;
            }

            writeSection(io, "Replay summary", [
              `State: ${result.state}`,
              `Sent events: ${result.sentEvents}`,
              `Start from: ${result.startFromTime}`,
              `Last source time: ${result.finalTrackPointTime ?? "-"}`,
              `Replay speed: ${result.speed}x`,
              `Loop: ${result.loop ? `enabled (${result.loopCount ?? "unbounded"})` : "disabled"}`,
              `Time mode: ${result.timeMode}`
            ]);
          } catch (error) {
            await telemetry.onRunFailed();
            throw error;
          } finally {
            teardownControls();
            if (interactive) {
              process.stdout.write("\r\x1b[2K");
            }
            process.removeListener("SIGINT", onInterrupt);
          }
        })
    )
  );

  return command;
}
