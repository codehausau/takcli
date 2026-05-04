import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { describeBrowserOpenFailure, openBrowser } from "../../map/browser.js";
import { parseMapLaunchMode, resolveMapLaunchSettings, type MapLaunchMode } from "../../map/launch-mode.js";
import { launchMapServer, maybeLoadReplayDataset } from "../../map/service.js";
import type { ReplaySourceOption } from "../../replay/types.js";
import { writeCommandTitle, writeSection } from "../output.js";
import { CliError, type IO } from "../runtime.js";

const SUPPORTED_REPLAY_SOURCES: ReplaySourceOption[] = ["auto", "geojson-vessel-tracks"];

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }

  return parsed;
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`Invalid timeout: ${value}`);
  }

  return parsed;
}

function parseReplaySource(value: string): ReplaySourceOption {
  if (SUPPORTED_REPLAY_SOURCES.includes(value as ReplaySourceOption)) {
    return value as ReplaySourceOption;
  }

  throw new CliError(`Unsupported replay source: ${value}`);
}

export function createMapCommand(io: IO): Command {
  return new Command("map")
    .description("Launch a TAK map console with live controls and an optional secondary local replay overlay.")
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--api-port <port>", "Override API port for this command").argParser(parsePort))
    .addOption(new Option("--cot-port <port>", "Override CoT port for this command").argParser(parsePort))
    .addOption(new Option("--enrollment-port <port>", "Override enrollment port for this command").argParser(parsePort))
    .addOption(new Option("--federation-port <port>", "Override federation port for this command").argParser(parsePort))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--timeout <ms>", "Timeout in milliseconds").default("5000"))
    .addOption(new Option("--mode <mode>", "Map launch mode: local or web").default("local").argParser(parseMapLaunchMode))
    .addOption(new Option("--host <address>", "Host address for the local UI server").default("127.0.0.1"))
    .addOption(new Option("--port <port>", "Port for the local UI server (0 for an ephemeral port)").default("3000").argParser(parsePort))
    .addOption(new Option("--open", "Open the UI in the default browser after launch"))
    .addOption(new Option("--title <text>", "Custom title shown in the UI").default("TAKCLI Map"))
    .addOption(new Option("--logo-label <text>", "Placeholder label shown in the company logo slot").default("Your Logo"))
    .addOption(new Option("--replay-file <path-or-url>", "Load a replay dataset overlay into the UI"))
    .addOption(
      new Option("--replay-source <source>", "Replay source type")
        .default("auto")
        .argParser(parseReplaySource)
    )
    .action(async function () {
      const command = this as Command;
      const options = command.opts<{
        apiPort?: number;
        config?: string;
        cotPort?: number;
        enrollmentPort?: number;
        federationPort?: number;
        host: string;
        insecure?: boolean;
        logoLabel: string;
        mode: MapLaunchMode;
        open?: boolean;
        port: number;
        profile?: string;
        replayFile?: string;
        replaySource: ReplaySourceOption;
        server?: string;
        timeout: string;
        title: string;
      }>();
      const launchSettings = resolveMapLaunchSettings({
        defaultOpen: Boolean(options.open),
        host: options.host,
        hostValueSource: command.getOptionValueSource("host"),
        mode: options.mode,
        openValueSource: command.getOptionValueSource("open")
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
      const replayDataset = await maybeLoadReplayDataset(options.replayFile, options.replaySource);
      const server = await launchMapServer({
        config,
        host: launchSettings.host,
        logoLabel: options.logoLabel,
        port: options.port,
        profile,
        replayDataset,
        timeoutMs,
        title: options.title
      });

      const handleSignal = () => {
        void server.close();
      };

      process.once("SIGINT", handleSignal);
      process.once("SIGTERM", handleSignal);
      try {
        writeCommandTitle(io, "TAKCLI map", "Browser UI for TAK status, CoT controls, and overlays");
        writeSection(io, "Session", [
          `Mode: ${options.mode}`,
          `Profile: ${profile.name ?? "(ad-hoc)"}`,
          `Server: ${profile.server}`,
          `UI: ${server.url}`,
          `Replay: ${replayDataset ? `${replayDataset.filePath} (local overlay, secondary)` : "none"}`,
          "Stop: Ctrl+C"
        ]);

        if (launchSettings.open) {
          try {
            await openBrowser(server.url);
          } catch (error) {
            io.stderr(
              `The map UI launched, but opening the browser failed: ${describeBrowserOpenFailure(error, server.url)}\n`
            );
          }
        }

        await server.waitForClose();
      } finally {
        process.off("SIGINT", handleSignal);
        process.off("SIGTERM", handleSignal);
      }
    });
}
