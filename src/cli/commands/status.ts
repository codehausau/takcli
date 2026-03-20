import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { collectStatusSummary } from "../../tak/doctor.js";
import { formatStatusToken, renderTable, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, getGlobalOptions, type IO } from "../runtime.js";

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`Invalid timeout: ${value}`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }
  return parsed;
}

export function createStatusCommand(io: IO): Command {
  return new Command("status")
    .description("Show a lightweight TAK server status summary.")
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--api-port <port>", "Override API port for this command").argParser(parsePort))
    .addOption(
      new Option("--enrollment-port <port>", "Override enrollment port for this command").argParser(
        parsePort
      )
    )
    .addOption(
      new Option("--federation-port <port>", "Override federation port for this command").argParser(
        parsePort
      )
    )
    .addOption(new Option("--cot-port <port>", "Override CoT port for this command").argParser(parsePort))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--timeout <ms>", "Probe timeout in milliseconds").default("5000"))
    .addOption(new Option("--verbose", "Enable verbose output"))
    .action(async function () {
      const command = this as Command;
      const options = getGlobalOptions(command);
      const rawOptions = command.opts();
      const timeoutMs = parseTimeout(command.opts().timeout);
      const loaded = await loadConfig(options.config, { allowMissing: true });
      const profile = resolveProfileTarget(loaded.config, {
        apiPortOverride: rawOptions.apiPort,
        cotPortOverride: rawOptions.cotPort,
        enrollmentPortOverride: rawOptions.enrollmentPort,
        federationPortOverride: rawOptions.federationPort,
        insecureSkipVerifyOverride: rawOptions.insecure ? true : undefined,
        profileName: options.profile,
        serverOverride: options.server
      });

      const summary = await collectStatusSummary(loaded, profile, timeoutMs);

      if (options.json) {
        writeJson(io, summary);
        if (!summary.ok) {
          throw new CliError("TAK status is degraded.", 1, summary);
        }
        return;
      }

      writeCommandTitle(io, "TAK status", "Lightweight endpoint reachability summary");

      writeSection(io, "Target", [
        `Config: ${summary.configPath}`,
        `Profile: ${summary.profile.name ?? "(ad-hoc)"}`,
        `Server: ${summary.profile.server}`,
        `DNS: ${summary.dns.ok ? summary.dns.address : summary.dns.error ?? "unresolved"}`
      ]);

      writeSection(
        io,
        "Endpoints",
        renderTable(
          ["ENDPOINT", "PORT", "TCP", "TLS", "HTTP"],
          summary.endpoints.map((endpoint) => [
            endpoint.name,
            String(endpoint.port),
            endpoint.tcp.ok
              ? formatStatusToken({ kind: "success", text: "OK" })
              : formatStatusToken({ kind: "error", text: "FAIL" }),
            endpoint.tls
              ? endpoint.tls.ok
                ? formatStatusToken({ kind: "success", text: "OK" })
                : formatStatusToken({ kind: "error", text: "FAIL" })
              : "-",
            endpoint.http
              ? endpoint.http.ok
                ? formatStatusToken({
                    kind: "success",
                    text: String(endpoint.http.statusCode ?? "OK")
                  })
                : formatStatusToken({ kind: "error", text: "FAIL" })
              : "-"
          ])
        )
      );

      writeSection(io, "Summary", [
        `Overall: ${
          summary.overall === "healthy"
            ? formatStatusToken({ kind: "success", text: "HEALTHY" })
            : summary.overall === "degraded"
              ? formatStatusToken({ kind: "warning", text: "DEGRADED" })
              : formatStatusToken({ kind: "error", text: "UNREACHABLE" })
        }`
      ]);

      if (!summary.ok) {
        throw new CliError("TAK status is degraded.", 1, summary);
      }
    });
}
