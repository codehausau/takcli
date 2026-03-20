import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { collectCotTargets, followCot, getDefaultCotTargetDateRange, injectCot, queryCot } from "../../tak/cot/service.js";
import { formatCotSummaryLine } from "../../tak/cot/xml.js";
import { renderTable, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, getGlobalOptions, type IO } from "../runtime.js";

function parseInteger(value: string, label: string, minimum = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseLatitude(value: string): number {
  const parsed = parseFiniteNumber(value, "latitude");
  if (parsed < -90 || parsed > 90) {
    throw new CliError(`Latitude out of range: ${value}`);
  }

  return parsed;
}

function parseLongitude(value: string): number {
  const parsed = parseFiniteNumber(value, "longitude");
  if (parsed < -180 || parsed > 180) {
    throw new CliError(`Longitude out of range: ${value}`);
  }

  return parsed;
}

function parseTimeout(value: string): number {
  return parseInteger(value, "timeout", 1);
}

function assertNoRawJsonConflict(raw: { raw?: boolean }, json: boolean): void {
  if (raw.raw && json) {
    throw new CliError("`--raw` and `--json` cannot be used together.");
  }
}

function assertValidDateOnly(value: string, flagName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError(`Invalid ${flagName}: ${value}. Expected YYYY-MM-DD.`);
  }

  return value;
}

function addSharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--timeout <ms>", "Timeout in milliseconds").default("5000"))
    .addOption(new Option("--verbose", "Enable verbose output"));
}

function buildRuntimeContext(command: Command, options: ReturnType<typeof getGlobalOptions>) {
  const rawOptions = command.opts();

  return loadConfig(options.config, { allowMissing: true }).then((config) => ({
    config,
    profile: resolveProfileTarget(config.config, {
      insecureSkipVerifyOverride: rawOptions.insecure ? true : undefined,
      profileName: options.profile,
      serverOverride: options.server
    }),
    timeoutMs: parseTimeout(rawOptions.timeout)
  }));
}

export function createCotCommand(io: IO): Command {
  const command = new Command("cot").description("Query, inspect, and stream Cursor-on-Target data.");

  command.addCommand(
    addSharedOptions(
      new Command("query")
        .description("Query the latest CoT event by UID or CoT ID.")
        .option("--uid <uid>", "Query by UID")
        .option("--cot-id <id>", "Query by CoT ID", (value) => parseInteger(value, "cot-id", 1))
        .option("--raw", "Emit raw CoT XML")
        .action(async function () {
          const command = this as Command;
          const options = getGlobalOptions(command);
          const rawOptions = command.opts();
          assertNoRawJsonConflict(rawOptions, options.json ?? false);

          if (Boolean(rawOptions.uid) === Boolean(rawOptions.cotId)) {
            throw new CliError("Use exactly one of `--uid` or `--cot-id`.");
          }

          const context = await buildRuntimeContext(command, options);
          const result = await queryCot(context, {
            cotId: rawOptions.cotId as number | undefined,
            uid: rawOptions.uid as string | undefined
          });

          if (options.json) {
            writeJson(io, result);
            return;
          }

          if (rawOptions.raw) {
            io.stdout(`${result.rawXml}\n`);
            return;
          }

          writeCommandTitle(io, "TAKCLI CoT query");

          writeSection(io, "Target", [
            `Config: ${result.configPath}`,
            `Profile: ${result.profile.name ?? "(ad-hoc)"}`,
            `Server: ${result.profile.server}`
          ]);
          writeSection(io, "CoT Event", [
            `UID: ${result.event.uid}`,
            `Callsign: ${result.event.callsign ?? "-"}`,
            `Type: ${result.event.type}`,
            `How: ${result.event.how}`,
            `Time: ${result.event.time ?? "-"}`,
            `Point: ${result.event.point.lat}, ${result.event.point.lon} (hae=${result.event.point.hae}, ce=${result.event.point.ce}, le=${result.event.point.le})`,
            `Remarks: ${result.event.remarks ?? "-"}`
          ]);
        })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("targets")
        .description("List recent CoT targets discovered from TAK.")
        .option("--start-date <yyyy-mm-dd>", "Start date in UTC")
        .option("--end-date <yyyy-mm-dd>", "End date in UTC")
        .option("--limit <n>", "Maximum number of targets to print", (value) =>
          parseInteger(value, "limit", 1)
        )
        .action(async function () {
          const command = this as Command;
          const options = getGlobalOptions(command);
          const rawOptions = command.opts();
          const context = await buildRuntimeContext(command, options);
          const range = getDefaultCotTargetDateRange();
          const startDate = rawOptions.startDate
            ? assertValidDateOnly(rawOptions.startDate as string, "start-date")
            : range.startDate;
          const endDate = rawOptions.endDate
            ? assertValidDateOnly(rawOptions.endDate as string, "end-date")
            : range.endDate;
          const limit = (rawOptions.limit as number | undefined) ?? 50;
          const result = await collectCotTargets(context, startDate, endDate, limit);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI CoT targets");

          writeSection(io, "Target", [
            `Config: ${result.configPath}`,
            `Profile: ${result.profile.name ?? "(ad-hoc)"}`,
            `Server: ${result.profile.server}`,
            `Range: ${result.startDate} to ${result.endDate} UTC`
          ]);

          if (result.targets.length === 0) {
            writeSection(io, "Targets", ["No CoT targets found for the requested date window."]);
            return;
          }

          writeSection(
            io,
            "Targets",
            renderTable(
              ["UID", "CALLSIGN", "TYPE", "TIME", "LAT", "LON"],
              result.targets.map((target) => [
                target.uid,
                target.callsign ?? "-",
                target.type ?? "-",
                target.time ?? "-",
                target.lat !== undefined ? String(target.lat) : "-",
                target.lon !== undefined ? String(target.lon) : "-"
              ])
            )
          );
        })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("inject")
        .description("Generate and inject a CoT event over the live CoT TLS stream.")
        .requiredOption("--uid <uid>", "CoT UID")
        .requiredOption("--type <type>", "CoT type")
        .requiredOption("--lat <lat>", "Latitude", parseLatitude)
        .requiredOption("--lon <lon>", "Longitude", parseLongitude)
        .option("--callsign <text>", "Callsign for the generated event")
        .addOption(new Option("--how <value>", "How value").default("m-g"))
        .option("--remarks <text>", "Remarks detail")
        .option("--stale-seconds <n>", "Seconds until the event becomes stale", (value: string) =>
          parseInteger(value, "stale-seconds", 1)
        )
        .option("--hae <m>", "Height above ellipsoid", (value: string) => parseFiniteNumber(value, "hae"))
        .option("--ce <m>", "Circular error", (value: string) => parseFiniteNumber(value, "ce"))
        .option("--le <m>", "Linear error", (value: string) => parseFiniteNumber(value, "le"))
        .action(async function (this: Command) {
          const options = getGlobalOptions(this);
          const rawOptions = this.opts();
          const context = await buildRuntimeContext(this, options);
          const result = await injectCot(context, {
            callsign: rawOptions.callsign as string | undefined,
            ce: (rawOptions.ce as number | undefined) ?? 9999999,
            hae: (rawOptions.hae as number | undefined) ?? 0,
            how: rawOptions.how as string,
            lat: rawOptions.lat as number,
            le: (rawOptions.le as number | undefined) ?? 9999999,
            lon: rawOptions.lon as number,
            remarks: rawOptions.remarks as string | undefined,
            staleSeconds: (rawOptions.staleSeconds as number | undefined) ?? 300,
            type: rawOptions.type as string,
            uid: rawOptions.uid as string
          });

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI CoT inject");

          writeSection(io, "Injected CoT", [
            `Profile: ${result.profile.name ?? "(ad-hoc)"}`,
            `Server: ${result.profile.server}`,
            `UID: ${result.event.uid}`,
            `Type: ${result.event.type}`,
            `Callsign: ${result.event.callsign ?? "-"}`,
            `Point: ${result.event.point.lat}, ${result.event.point.lon}`,
            `Bytes sent: ${result.bytesSent}`
          ]);
        })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("follow")
        .description("Follow the live CoT stream over the configured TLS port.")
        .option("--limit <n>", "Stop after printing N events", (value) => parseInteger(value, "limit", 1))
        .option("--raw", "Emit raw CoT XML frames")
        .action(async function () {
          const command = this as Command;
          const options = getGlobalOptions(command);
          const rawOptions = command.opts();
          assertNoRawJsonConflict(rawOptions, options.json ?? false);
          const context = await buildRuntimeContext(command, options);
          const controller = new AbortController();
          const onInterrupt = () => controller.abort();

          process.once("SIGINT", onInterrupt);

          try {
            if (!options.json && !rawOptions.raw) {
              writeCommandTitle(io, "TAKCLI CoT follow");
            }

            await followCot(context, {
              limit: rawOptions.limit as number | undefined,
              onEvent: (event) => {
                if (options.json) {
                  io.stdout(`${JSON.stringify(event)}\n`);
                  return;
                }

                if (rawOptions.raw) {
                  io.stdout(`${event.event.rawXml}\n`);
                  return;
                }

                io.stdout(`${formatCotSummaryLine(event.event)}\n`);
              },
              signal: controller.signal
            });
          } finally {
            process.removeListener("SIGINT", onInterrupt);
          }
        })
    )
  );

  return command;
}
