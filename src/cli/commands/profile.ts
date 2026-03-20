import { Command, Option } from "commander";

import { loadConfig, saveConfig } from "../../core/config-store.js";
import { normalizeServerInput } from "../../core/profile-resolution.js";
import { configSchema, profileSchema } from "../../core/schema.js";
import { renderTable, writeCommandTitle, writeJson, writeSection } from "../output.js";
import { CliError, getGlobalOptions, type IO } from "../runtime.js";

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }
  return parsed;
}

function addSharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--verbose", "Enable verbose output"));
}

export function createProfileCommand(io: IO): Command {
  const command = new Command("profile").description("Manage TAK server profiles.");

  command.addCommand(
    addSharedOptions(
      new Command("list")
      .description("List configured TAK profiles.")
      .action(async function () {
        const options = getGlobalOptions(this as Command);
        const loaded = await loadConfig(options.config, { allowMissing: true });
        const names = Object.keys(loaded.config.profiles).sort();
        const profiles = names.map((name) => ({
          current: loaded.config.currentProfile === name,
          name,
          server: loaded.config.profiles[name].server
        }));

        if (options.json) {
          writeJson(io, {
            command: "profile list",
            configPath: loaded.path,
            currentProfile: loaded.config.currentProfile,
            profiles
          });
          return;
        }

        writeCommandTitle(io, "TAKCLI profile list");

        if (profiles.length === 0) {
          writeSection(io, "Profiles", [`No profiles found in ${loaded.path}`]);
          return;
        }

        writeSection(
          io,
          "Profiles",
          renderTable(
            ["CURRENT", "NAME", "SERVER"],
            profiles.map((profile) => [profile.current ? "*" : "", profile.name, profile.server])
          )
        );
      })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("show")
      .description("Show a TAK profile.")
      .argument("[name]", "Profile name. Defaults to the current profile.")
      .action(async function (name?: string) {
        const options = getGlobalOptions(this as Command);
        const loaded = await loadConfig(options.config, { allowMissing: true });
        const target = name ?? loaded.config.currentProfile;

        if (!target) {
          throw new CliError("No current profile is configured.");
        }

        const profile = loaded.config.profiles[target];
        if (!profile) {
          throw new CliError(`Profile not found: ${target}`);
        }

        const result = {
          command: "profile show",
          configPath: loaded.path,
          currentProfile: loaded.config.currentProfile,
          name: target,
          profile
        };

        if (options.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI profile show");

        writeSection(io, `Profile ${target}`, [
          `Server: ${profile.server}`,
          `Description: ${profile.description ?? "-"}`,
          `TLS insecure skip verify: ${profile.tls.insecureSkipVerify ? "true" : "false"}`,
          `Ports: api=${profile.ports.api ?? "-"}, enrollment=${profile.ports.enrollment ?? "-"}, federation=${profile.ports.federation ?? "-"}, cot=${profile.ports.cot ?? "-"}`
        ]);
      })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("add")
      .description("Add or update a TAK profile.")
      .argument("<name>", "Profile name")
      .requiredOption("--server <url>", "TAK server base URL or host")
      .option("--description <text>", "Profile description")
      .option("--api-port <port>", "Override API port", parsePort)
      .option("--enrollment-port <port>", "Override enrollment port", parsePort)
      .option("--federation-port <port>", "Override federation port", parsePort)
      .option("--cot-port <port>", "Override CoT port", parsePort)
      .option("--insecure", "Skip TLS verification")
      .option("--set-current", "Set this profile as the active profile")
      .action(async function (name: string) {
        const cmd = this as Command;
        const options = getGlobalOptions(cmd);
        const loaded = await loadConfig(options.config, { allowMissing: true });
        const raw = cmd.opts();

        const profile = profileSchema.parse({
          description: raw.description,
          ports: {
            api: raw.apiPort,
            cot: raw.cotPort,
            enrollment: raw.enrollmentPort,
            federation: raw.federationPort
          },
          server: normalizeServerInput(raw.server),
          tls: {
            insecureSkipVerify: Boolean(raw.insecure)
          }
        });

        const nextConfig = configSchema.parse({
          ...loaded.config,
          currentProfile: raw.setCurrent ? name : loaded.config.currentProfile,
          profiles: {
            ...loaded.config.profiles,
            [name]: profile
          }
        });

        await saveConfig(loaded.path, nextConfig);

        const result = {
          command: "profile add",
          configPath: loaded.path,
          currentProfile: nextConfig.currentProfile,
          name,
          profile
        };

        if (options.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI profile add");

        writeSection(io, `Saved profile ${name}`, [
          `Config: ${loaded.path}`,
          `Server: ${profile.server}`,
          `Current profile: ${nextConfig.currentProfile ?? "-"}`
        ]);
      })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("use")
      .description("Set the active TAK profile.")
      .argument("<name>", "Profile name")
      .action(async function (name: string) {
        const options = getGlobalOptions(this as Command);
        const loaded = await loadConfig(options.config, { allowMissing: true });
        if (!loaded.config.profiles[name]) {
          throw new CliError(`Profile not found: ${name}`);
        }

        const nextConfig = configSchema.parse({
          ...loaded.config,
          currentProfile: name
        });
        await saveConfig(loaded.path, nextConfig);

        const result = {
          command: "profile use",
          configPath: loaded.path,
          currentProfile: name
        };

        if (options.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI profile use");

        writeSection(io, `Current profile`, [`Active profile set to ${name}`]);
      })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("remove")
      .description("Remove a TAK profile.")
      .argument("<name>", "Profile name")
      .action(async function (name: string) {
        const options = getGlobalOptions(this as Command);
        const loaded = await loadConfig(options.config, { allowMissing: true });
        if (!loaded.config.profiles[name]) {
          throw new CliError(`Profile not found: ${name}`);
        }

        const profiles = { ...loaded.config.profiles };
        delete profiles[name];
        const nextConfig = configSchema.parse({
          ...loaded.config,
          currentProfile: loaded.config.currentProfile === name ? undefined : loaded.config.currentProfile,
          profiles
        });
        await saveConfig(loaded.path, nextConfig);

        const result = {
          command: "profile remove",
          configPath: loaded.path,
          currentProfile: nextConfig.currentProfile,
          removed: name
        };

        if (options.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI profile remove");

        writeSection(io, `Removed profile ${name}`, [
          `Config: ${loaded.path}`,
          `Current profile: ${nextConfig.currentProfile ?? "-"}`
        ]);
      })
    )
  );

  return command;
}
