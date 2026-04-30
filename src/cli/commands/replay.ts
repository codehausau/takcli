import process from "node:process";
import { emitKeypressEvents } from "node:readline";

import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { loadReplayDataset } from "../../replay/geojson.js";
import { createReplayRunner, describeReplayTarget, resolveReplayStartIndex } from "../../replay/service.js";
import type { ReplayDatasetSummary, ReplayProgressSnapshot, ReplaySourceOption } from "../../replay/types.js";
import { color, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, getGlobalOptions, type IO } from "../runtime.js";

const SUPPORTED_REPLAY_SOURCES: ReplaySourceOption[] = ["auto", "geojson-vessel-tracks"];
const SEEK_STEP_MS = 60 * 60 * 1000;

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

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }

  return parsed;
}

function parseReplaySource(value: string): ReplaySourceOption {
  if (SUPPORTED_REPLAY_SOURCES.includes(value as ReplaySourceOption)) {
    return value as ReplaySourceOption;
  }

  throw new CliError(`Unsupported replay source: ${value}`);
}

function addReplaySharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--cot-port <port>", "Override CoT port for this command").argParser(parsePort))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--timeout <ms>", "Timeout in milliseconds").default("5000"))
    .addOption(new Option("--verbose", "Enable verbose output"));
}

async function buildReplayContext(command: Command) {
  const options = getGlobalOptions(command);
  const rawOptions = command.opts();
  const config = await loadConfig(options.config, { allowMissing: true });

  return {
    config,
    options,
    resolveProfile: () =>
      resolveProfileTarget(config.config, {
        cotPortOverride: rawOptions.cotPort as number | undefined,
        insecureSkipVerifyOverride: rawOptions.insecure ? true : undefined,
        profileName: options.profile,
        serverOverride: options.server
      }),
    rawOptions,
    timeoutMs: parseTimeout(rawOptions.timeout as string)
  };
}

function describeDataset(dataset: ReplayDatasetSummary, startIndex: number, rawOptions: Record<string, unknown>): string[] {
  const startTrackPoint = dataset.trackPoints[startIndex]!;

  return [
    `Source: ${dataset.detectedSource}`,
    `File: ${dataset.filePath}`,
    `Features: ${dataset.totalFeatures}`,
    `Track points: ${dataset.trackPoints.length}`,
    `Skipped features: ${dataset.skippedFeatures}`,
    `Range: ${dataset.startTime} to ${dataset.endTime} UTC`,
    `Start from: ${startTrackPoint.sourceTime}`,
    `Replay speed: ${rawOptions.speed}x`,
    `Max events: ${rawOptions.maxEvents ?? "(unbounded)"}`
  ];
}

function canUseInteractiveControls(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stdin.setRawMode);
}

function renderProgress(snapshot: ReplayProgressSnapshot): string {
  const state =
    snapshot.state === "running" && snapshot.paused
      ? "paused"
      : snapshot.state;
  const time = snapshot.trackPoint?.sourceTime ?? "-";
  const uid = snapshot.trackPoint?.uid ?? "-";
  return `Replay ${state} | sent=${snapshot.sentEvents} | source-time=${time} | uid=${uid}`;
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

    if (key.name === "return" || key.name === "enter") {
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

export function createReplayCommand(io: IO): Command {
  const command = new Command("replay").description("Replay historical track data into TAK via CoT.");

  command.addCommand(
    addReplaySharedOptions(
      new Command("file")
        .description("Replay a local file into TAK.")
        .argument("<path>", "Path to the replay input file")
        .addOption(
          new Option("--source <source>", "Replay source type")
            .default("auto")
            .argParser(parseReplaySource)
        )
        .addOption(new Option("--start-from <time>", "Use start, end, or an ISO-8601 source timestamp").default("start"))
        .addOption(new Option("--speed <factor>", "Replay speed multiplier").default("3600").argParser((value) => parsePositiveNumber(value, "speed")))
        .addOption(new Option("--max-events <n>", "Stop after replaying N events").argParser((value) => parsePositiveInteger(value, "max-events")))
        .addOption(new Option("--stale-seconds <seconds>", "CoT stale window in seconds").default("300").argParser((value) => parsePositiveInteger(value, "stale-seconds")))
        .addOption(new Option("--cot-type <type>", "CoT type to emit").default("a-u-S-X-M"))
        .addOption(new Option("--how <value>", "CoT how value").default("m-g"))
        .addOption(new Option("--describe", "Inspect the replay file and exit without sending CoT"))
        .action(async function (pathArgument: string) {
          const command = this as Command;
          const context = await buildReplayContext(command);
          const rawOptions = context.rawOptions as {
            cotType: string;
            describe?: boolean;
            how: string;
            maxEvents?: number;
            source: ReplaySourceOption;
            speed: number;
            staleSeconds: number;
            startFrom: string;
          };

          const dataset = await loadReplayDataset(pathArgument, rawOptions.source);
          const startIndex = resolveReplayStartIndex(dataset, rawOptions.startFrom);
          const describeProfile = rawOptions.describe
            ? (() => {
                try {
                  return context.resolveProfile();
                } catch {
                  return undefined;
                }
              })()
            : context.resolveProfile();

          if (context.options.json) {
            if (rawOptions.describe) {
              writeJson(io, {
                command: "replay file",
                dataset: {
                  detectedSource: dataset.detectedSource,
                  endTime: dataset.endTime,
                  filePath: dataset.filePath,
                  skippedFeatures: dataset.skippedFeatures,
                  startTime: dataset.startTime,
                  totalFeatures: dataset.totalFeatures,
                  trackPoints: dataset.trackPoints.length
                },
                profile: describeProfile,
                selectedStartTime: dataset.trackPoints[startIndex]!.sourceTime
              });
              return;
            }
          } else {
            writeCommandTitle(io, "TAKCLI replay file");
            if (describeProfile) {
              writeSection(io, "Target", describeReplayTarget(describeProfile));
            }
            writeSection(io, "Dataset", describeDataset(dataset, startIndex, rawOptions as unknown as Record<string, unknown>));
          }

          if (rawOptions.describe) {
            if (!context.options.json) {
              writeSection(io, "Replay", ["Describe-only mode. No CoT was sent."]);
            }
            return;
          }

          const replayProfile = describeProfile ?? context.resolveProfile();

          const interactive = !context.options.json && canUseInteractiveControls();
          let lastRendered = "";
          const renderStatus = (snapshot?: ReplayProgressSnapshot) => {
            if (!interactive) {
              return;
            }

            const line = renderProgress(snapshot ?? runner.getSnapshot());
            if (line === lastRendered) {
              return;
            }

            process.stdout.write(`\r\x1b[2K${line}`);
            lastRendered = line;
          };

          const runner = createReplayRunner(dataset, {
            cotType: rawOptions.cotType,
            how: rawOptions.how,
            maxEvents: rawOptions.maxEvents,
            onStateChange: (snapshot) => renderStatus(snapshot),
            profile: replayProfile,
            speed: rawOptions.speed,
            staleSeconds: rawOptions.staleSeconds,
            startIndex,
            timeoutMs: context.timeoutMs
          });

          if (!context.options.json) {
            writeSection(io, "Execution", [
              "Foreground: yes",
              interactive ? "Interactive controls: enabled" : "Interactive controls: unavailable without a TTY",
              `Selected start time: ${dataset.trackPoints[startIndex]!.sourceTime}`
            ]);
          }

          const teardownControls = interactive ? setupInteractiveControls(io, runner, () => renderStatus()) : () => {};
          const onInterrupt = () => runner.stop();
          process.once("SIGINT", onInterrupt);

          try {
            const result = await runner.run();
            if (interactive) {
              process.stdout.write("\r\x1b[2K");
            }

            if (context.options.json) {
              writeJson(io, result);
              return;
            }

            writeSection(io, "Replay summary", [
              `State: ${result.state}`,
              `Sent events: ${result.sentEvents}`,
              `Start from: ${result.startFromTime}`,
              `Last source time: ${result.finalTrackPointTime ?? "-"}`,
              `Replay speed: ${result.speed}x`
            ]);
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
