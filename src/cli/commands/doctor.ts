import path from "node:path";

import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import { runDoctor } from "../../tak/doctor.js";
import { runKubernetesDoctor } from "../../tak/kubernetes-doctor.js";
import type { DoctorCheck, DoctorReport } from "../../tak/types.js";
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

function summarizeDoctorOverall(report: DoctorReport): string {
  return report.ok
    ? formatStatusToken({ kind: "success", text: "HEALTHY" })
    : formatStatusToken({ kind: "error", text: "FAILED" });
}

function groupLabelForCheck(check: DoctorCheck): string {
  if (check.id === "config" || check.id === "target" || check.id === "dns") {
    return "Context";
  }

  if (check.id.endsWith("-api")) {
    return "API";
  }

  if (check.id.endsWith("-enrollment")) {
    return "Enrollment";
  }

  if (check.id.endsWith("-federation")) {
    return "Federation";
  }

  if (check.id.endsWith("-cot")) {
    return "CoT";
  }

  return "Checks";
}

function renderGroupedChecks(report: DoctorReport): Array<{ lines: string[]; title: string }> {
  const order = ["Context", "API", "Enrollment", "Federation", "CoT", "Checks"];
  const grouped = new Map<string, DoctorCheck[]>();

  for (const check of report.checks) {
    const group = groupLabelForCheck(check);
    const entries = grouped.get(group) ?? [];
    entries.push(check);
    grouped.set(group, entries);
  }

  return order
    .filter((title) => grouped.has(title))
    .map((title) => ({
      lines: renderTable(
        ["STATUS", "CHECK", "DETAIL"],
        (grouped.get(title) ?? []).map((check) => [
          formatStatusToken({ kind: check.ok ? "success" : "error", text: check.ok ? "PASS" : "FAIL" }),
          check.label,
          check.message
        ])
      ),
      title
    }));
}

export function createDoctorCommand(io: IO): Command {
  return new Command("doctor")
    .description("Run TAK server diagnostics or experimental Kubernetes preflight checks.")
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--kubernetes", "Run experimental Kubernetes preflight checks instead of TAK endpoint probes"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--kubeconfig <path>", "Override kubeconfig path for Kubernetes checks"))
    .addOption(new Option("--namespace <name>", "Kubernetes namespace to inspect"))
    .addOption(new Option("--deployment-root <path>", "Inspect a TAKCLI deployment workspace"))
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

      if (
        !rawOptions.kubernetes &&
        (rawOptions.kubeconfig !== undefined || rawOptions.namespace !== undefined || rawOptions.deploymentRoot !== undefined)
      ) {
        throw new CliError("`--kubeconfig`, `--namespace`, and `--deployment-root` require `--kubernetes`.");
      }

      const report = rawOptions.kubernetes
        ? await runKubernetesDoctor(loaded, {
            deploymentRoot: rawOptions.deploymentRoot ? path.resolve(rawOptions.deploymentRoot) : undefined,
            kubeconfig: rawOptions.kubeconfig ? path.resolve(rawOptions.kubeconfig) : undefined,
            namespace: rawOptions.namespace
          })
        : await runDoctor(
            loaded,
            resolveProfileTarget(loaded.config, {
              apiPortOverride: rawOptions.apiPort,
              cotPortOverride: rawOptions.cotPort,
              enrollmentPortOverride: rawOptions.enrollmentPort,
              federationPortOverride: rawOptions.federationPort,
              insecureSkipVerifyOverride: rawOptions.insecure ? true : undefined,
              profileName: options.profile,
              serverOverride: options.server
            }),
            timeoutMs
          );

      if (options.json) {
        writeJson(io, report);
        if (!report.ok) {
          throw new CliError("TAK doctor checks failed.", 1, report);
        }
        return;
      }

      writeCommandTitle(
        io,
        "TAK doctor",
        report.mode === "kubernetes"
          ? "Experimental Kubernetes preflight diagnostics"
          : "Connectivity and configuration diagnostics"
      );

      writeSection(
        io,
        "Target",
        report.mode === "kubernetes"
          ? [
              `Config: ${report.configPath}`,
              `Mode: kubernetes (experimental)`,
              `Kubeconfig: ${report.kubernetes.kubeconfig ?? "(default)"}`,
              `Context: ${report.kubernetes.context ?? "(unknown)"}`,
              `Namespace: ${report.kubernetes.namespace?.name ?? rawOptions.namespace ?? "(not specified)"}`,
              `Deployment workspace: ${report.kubernetes.deploymentRoot ?? "(not specified)"}`
            ]
          : [
              `Config: ${report.configPath}`,
              `Profile: ${report.profile.name ?? "(ad-hoc)"}`,
              `Server: ${report.profile.server}`,
              `Ports: api=${report.profile.ports.api}, enrollment=${report.profile.ports.enrollment}, federation=${report.profile.ports.federation}, cot=${report.profile.ports.cot}`
            ]
      );

      for (const group of renderGroupedChecks(report)) {
        writeSection(io, group.title, group.lines);
      }

      writeSection(io, "Summary", [
        `Passed: ${report.summary.passed}`,
        `Failed: ${report.summary.failed}`,
        `Overall: ${summarizeDoctorOverall(report)}`
      ]);

      if (!report.ok) {
        throw new CliError("TAK doctor checks failed.", 1, report);
      }
    });
}
