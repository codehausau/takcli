import { Command, Option } from "commander";

import { loadConfig } from "../../core/config-store.js";
import { resolveProfileTarget } from "../../core/profile-resolution.js";
import {
  addTakUserGroups,
  createTakUser,
  deleteTakUser,
  getTakGroupMembers,
  getTakUserGroups,
  listTakGroupNames,
  listTakUsers,
  removeTakUserGroups,
  resetTakUserPassword,
  setTakUserGroups,
  type TakGroupMembers,
  type TakUserGroupMembership
} from "../../tak/users/service.js";
import { renderTable, writeCommandTitle, writeJson, writeSection } from "../output.js";
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

function collectValues(value: string, previous: string[] = []): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CliError("Group names cannot be empty.");
  }

  return [...previous, trimmed];
}

function addSharedOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", "Override the config file path"))
    .addOption(new Option("--json", "Emit JSON output"))
    .addOption(new Option("--profile <name>", "Use a named TAK profile"))
    .addOption(new Option("--server <url>", "Override the server target for this command"))
    .addOption(new Option("--api-port <port>", "Override API port for this command").argParser(parsePort))
    .addOption(new Option("--insecure", "Skip TLS verification for this command"))
    .addOption(new Option("--auth-user <username>", "Use HTTP basic auth with this admin username"))
    .addOption(new Option("--auth-password <password>", "Use HTTP basic auth with this admin password"))
    .addOption(new Option("--auth-token <token>", "Use a bearer token for this command"))
    .addOption(new Option("--timeout <ms>", "Timeout in milliseconds").default("5000"))
    .addOption(new Option("--verbose", "Enable verbose output"));
}

function addGroupOptions(command: Command): Command {
  return command
    .option("--group <name>", "Assign both IN and OUT access for a group", collectValues, [])
    .option("--in-group <name>", "Assign IN-only access for a group", collectValues, [])
    .option("--out-group <name>", "Assign OUT-only access for a group", collectValues, []);
}

async function buildRuntimeContext(command: Command, options: ReturnType<typeof getGlobalOptions>) {
  const rawOptions = command.opts();
  const config = await loadConfig(options.config, { allowMissing: true });

  return {
    config,
    profile: resolveProfileTarget(config.config, {
      apiPortOverride: rawOptions.apiPort as number | undefined,
      authPasswordOverride: rawOptions.authPassword as string | undefined,
      authTokenOverride: rawOptions.authToken as string | undefined,
      authUsernameOverride: rawOptions.authUser as string | undefined,
      insecureSkipVerifyOverride: rawOptions.insecure ? true : undefined,
      profileName: options.profile,
      serverOverride: options.server
    }),
    timeoutMs: parseTimeout(rawOptions.timeout as string)
  };
}

function hasAnyGroupSelection(rawOptions: {
  group?: string[];
  inGroup?: string[];
  outGroup?: string[];
}): boolean {
  return (rawOptions.group?.length ?? 0) + (rawOptions.inGroup?.length ?? 0) + (rawOptions.outGroup?.length ?? 0) > 0;
}

function renderMembershipTable(user: TakUserGroupMembership): string[] {
  const rows = [
    ...user.groupList.map((group) => [group, "IN+OUT"]),
    ...user.groupListIN.map((group) => [group, "IN"]),
    ...user.groupListOUT.map((group) => [group, "OUT"])
  ];

  if (rows.length === 0) {
    return ["No group membership configured."];
  }

  rows.sort((left, right) => {
    const groupComparison = left[0].localeCompare(right[0]);
    return groupComparison !== 0 ? groupComparison : left[1].localeCompare(right[1]);
  });

  return renderTable(["GROUP", "ACCESS"], rows);
}

function renderGroupMembersTable(group: TakGroupMembers): string[] {
  const rows = [
    ...group.usersInGroupList.map((username) => [username, "IN+OUT"]),
    ...group.usersInGroupListIN.map((username) => [username, "IN"]),
    ...group.usersInGroupListOUT.map((username) => [username, "OUT"])
  ];

  if (rows.length === 0) {
    return ["No users are assigned to this group."];
  }

  rows.sort((left, right) => {
    const userComparison = left[0].localeCompare(right[0]);
    return userComparison !== 0 ? userComparison : left[1].localeCompare(right[1]);
  });

  return renderTable(["USERNAME", "ACCESS"], rows);
}

function writeTargetSection(
  io: IO,
  result: {
    configPath: string;
    profile: {
      name?: string;
      server: string;
    };
  }
): void {
  writeSection(io, "Target", [
    `Config: ${result.configPath}`,
    `Profile: ${result.profile.name ?? "(ad-hoc)"}`,
    `Server: ${result.profile.server}`
  ]);
}

export function createUsersCommand(io: IO): Command {
  const command = new Command("users").description("Manage TAK file-based users and group membership.");

  command.addCommand(
    addSharedOptions(
      new Command("list").description("List TAK file-auth users.").action(async function () {
        const options = getGlobalOptions(this as Command);
        const context = await buildRuntimeContext(this as Command, options);
        const result = await listTakUsers(context);

        if (options.json) {
          writeJson(io, result);
          return;
        }

        writeCommandTitle(io, "TAKCLI users list");
        writeTargetSection(io, result);
        writeSection(
          io,
          "Users",
          result.users.length === 0
            ? ["No TAK users found."]
            : renderTable(["USERNAME"], result.users.map((user) => [user.username]))
        );
      })
    )
  );

  command.addCommand(
    addGroupOptions(
      addSharedOptions(
        new Command("create")
          .description("Create a TAK file-auth user.")
          .argument("<username>", "Username to create")
          .requiredOption("--password <password>", "Password for the new user")
          .action(async function (username: string) {
            const command = this as Command;
            const options = getGlobalOptions(command);
            const rawOptions = command.opts();
            const context = await buildRuntimeContext(command, options);
            const result = await createTakUser(context, {
              groupList: rawOptions.group as string[],
              groupListIN: rawOptions.inGroup as string[],
              groupListOUT: rawOptions.outGroup as string[],
              password: rawOptions.password as string,
              username
            });

            if (options.json) {
              writeJson(io, result);
              return;
            }

            writeCommandTitle(io, "TAKCLI users create");
            writeTargetSection(io, result);
            writeSection(io, `Created ${result.user.username}`, renderMembershipTable(result.user));
          })
      )
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("reset-password")
        .description("Reset the password for a TAK file-auth user.")
        .argument("<username>", "Username to update")
        .requiredOption("--password <password>", "New password")
        .action(async function (username: string) {
          const command = this as Command;
          const options = getGlobalOptions(command);
          const rawOptions = command.opts();
          const context = await buildRuntimeContext(command, options);
          const result = await resetTakUserPassword(context, username, rawOptions.password as string);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI users reset-password");
          writeTargetSection(io, result);
          writeSection(io, "Password reset", [`Updated password for ${result.username}`]);
        })
    )
  );

  command.addCommand(
    addSharedOptions(
      new Command("delete")
        .description("Delete a TAK file-auth user.")
        .argument("<username>", "Username to delete")
        .action(async function (username: string) {
          const options = getGlobalOptions(this as Command);
          const context = await buildRuntimeContext(this as Command, options);
          const result = await deleteTakUser(context, username);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI users delete");
          writeTargetSection(io, result);
          writeSection(io, "Deleted", [`Removed ${result.deleted}`]);
        })
    )
  );

  const groupsCommand = new Command("groups").description("Inspect and update TAK user group membership.");

  groupsCommand.addCommand(
    addSharedOptions(
      new Command("show")
        .description("Show group membership for a TAK user.")
        .argument("<username>", "Username to inspect")
        .action(async function (username: string) {
          const options = getGlobalOptions(this as Command);
          const context = await buildRuntimeContext(this as Command, options);
          const result = await getTakUserGroups(context, username);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI users groups show");
          writeTargetSection(io, result);
          writeSection(io, `Membership for ${result.user.username}`, renderMembershipTable(result.user));
        })
    )
  );

  groupsCommand.addCommand(
    addSharedOptions(
      new Command("members")
        .description("Show users assigned to a TAK group.")
        .argument("<group>", "Group name to inspect")
        .action(async function (groupname: string) {
          const options = getGlobalOptions(this as Command);
          const context = await buildRuntimeContext(this as Command, options);
          const result = await getTakGroupMembers(context, groupname);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI users groups members");
          writeTargetSection(io, result);
          writeSection(io, `Members of ${result.group.groupname}`, renderGroupMembersTable(result.group));
        })
    )
  );

  groupsCommand.addCommand(
    addSharedOptions(
      new Command("list")
        .description("List TAK group names.")
        .action(async function () {
          const options = getGlobalOptions(this as Command);
          const context = await buildRuntimeContext(this as Command, options);
          const result = await listTakGroupNames(context);

          if (options.json) {
            writeJson(io, result);
            return;
          }

          writeCommandTitle(io, "TAKCLI users groups list");
          writeTargetSection(io, result);
          writeSection(
            io,
            "Groups",
            result.groups.length === 0
              ? ["No TAK groups found."]
              : renderTable(["GROUP"], result.groups.map((group) => [group.groupname]))
          );
        })
    )
  );

  groupsCommand.addCommand(
    addGroupOptions(
      addSharedOptions(
        new Command("set")
          .description("Replace a user's group membership.")
          .argument("<username>", "Username to update")
          .option("--clear", "Remove all assigned groups before applying new membership")
          .action(async function (username: string) {
            const command = this as Command;
            const options = getGlobalOptions(command);
            const rawOptions = command.opts();

            if (!rawOptions.clear && !hasAnyGroupSelection(rawOptions)) {
              throw new CliError("Provide at least one group option or use `--clear`.");
            }

            const context = await buildRuntimeContext(command, options);
            const result = await setTakUserGroups(context, {
              groupList: rawOptions.group as string[],
              groupListIN: rawOptions.inGroup as string[],
              groupListOUT: rawOptions.outGroup as string[],
              username
            });

            if (options.json) {
              writeJson(io, result);
              return;
            }

            writeCommandTitle(io, "TAKCLI users groups set");
            writeTargetSection(io, result);
            writeSection(io, `Membership for ${result.user.username}`, renderMembershipTable(result.user));
          })
      )
    )
  );

  groupsCommand.addCommand(
    addGroupOptions(
      addSharedOptions(
        new Command("add")
          .description("Add groups to a user's existing membership.")
          .argument("<username>", "Username to update")
          .action(async function (username: string) {
            const command = this as Command;
            const options = getGlobalOptions(command);
            const rawOptions = command.opts();

            if (!hasAnyGroupSelection(rawOptions)) {
              throw new CliError("Provide at least one of `--group`, `--in-group`, or `--out-group`.");
            }

            const context = await buildRuntimeContext(command, options);
            const result = await addTakUserGroups(context, {
              groupList: rawOptions.group as string[],
              groupListIN: rawOptions.inGroup as string[],
              groupListOUT: rawOptions.outGroup as string[],
              username
            });

            if (options.json) {
              writeJson(io, result);
              return;
            }

            writeCommandTitle(io, "TAKCLI users groups add");
            writeTargetSection(io, result);
            writeSection(io, `Membership for ${result.user.username}`, renderMembershipTable(result.user));
          })
      )
    )
  );

  groupsCommand.addCommand(
    addGroupOptions(
      addSharedOptions(
        new Command("remove")
          .description("Remove groups from a user's existing membership.")
          .argument("<username>", "Username to update")
          .action(async function (username: string) {
            const command = this as Command;
            const options = getGlobalOptions(command);
            const rawOptions = command.opts();

            if (!hasAnyGroupSelection(rawOptions)) {
              throw new CliError("Provide at least one of `--group`, `--in-group`, or `--out-group`.");
            }

            const context = await buildRuntimeContext(command, options);
            const result = await removeTakUserGroups(context, {
              groupList: rawOptions.group as string[],
              groupListIN: rawOptions.inGroup as string[],
              groupListOUT: rawOptions.outGroup as string[],
              username
            });

            if (options.json) {
              writeJson(io, result);
              return;
            }

            writeCommandTitle(io, "TAKCLI users groups remove");
            writeTargetSection(io, result);
            writeSection(io, `Membership for ${result.user.username}`, renderMembershipTable(result.user));
          })
      )
    )
  );

  command.addCommand(groupsCommand);
  return command;
}
