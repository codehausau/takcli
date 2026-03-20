import https from "node:https";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/index.js";

function createMemoryIo() {
  let stderr = "";
  let stdout = "";

  return {
    io: {
      stderr: (text: string) => {
        stderr += text;
      },
      stdout: (text: string) => {
        stdout += text;
      }
    },
    readStderr: () => stderr,
    readStdout: () => stdout
  };
}

interface MockUserRecord {
  groupList: string[];
  groupListIN: string[];
  groupListOUT: string[];
  password: string;
}

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
});

function collectGroupNames(users: Map<string, MockUserRecord>): string[] {
  const groups = new Set<string>();

  for (const user of users.values()) {
    for (const group of [...user.groupList, ...user.groupListIN, ...user.groupListOUT]) {
      groups.add(group);
    }
  }

  return [...groups].sort((left, right) => left.localeCompare(right));
}

function readRequestBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

describe("users command integration", () => {
  it("manages TAK users and groups through the file-user-management API", async () => {
    const users = new Map<string, MockUserRecord>([
      [
        "bob",
        {
          groupList: ["__ANON__"],
          groupListIN: [],
          groupListOUT: [],
          password: "ignored"
        }
      ]
    ]);
    const seenAuthorizationHeaders: string[] = [];
    const expectedAuthorization = `Basic ${Buffer.from("admin:secret", "utf8").toString("base64")}`;
    const certs = selfsigned.generate(
      [
        {
          name: "commonName",
          value: "127.0.0.1"
        }
      ],
      {
        days: 365,
        keySize: 2048
      }
    );

    const server = https.createServer(
      {
        cert: certs.cert,
        key: certs.private
      },
      async (request, response) => {
        const url = new URL(request.url ?? "/", "https://127.0.0.1");
        const authorization = request.headers.authorization;

        if (url.pathname.startsWith("/user-management/api")) {
          seenAuthorizationHeaders.push(authorization ?? "");
          if (authorization !== expectedAuthorization) {
            response.writeHead(401, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "Unauthorized" }));
            return;
          }
        }

        if (request.method === "GET" && url.pathname === "/user-management/api/list-users") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify([...users.keys()].sort().map((username) => ({ username }))));
          return;
        }

        if (request.method === "GET" && url.pathname === "/user-management/api/list-groupnames") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(collectGroupNames(users).map((groupname) => ({ groupname }))));
          return;
        }

        if (request.method === "GET" && url.pathname.startsWith("/user-management/api/get-groups-for-user/")) {
          const username = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          const user = users.get(username);

          if (!user) {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "User not found!" }));
            return;
          }

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              groupList: user.groupList,
              groupListIN: user.groupListIN,
              groupListOUT: user.groupListOUT,
              username
            })
          );
          return;
        }

        if (request.method === "GET" && url.pathname.startsWith("/user-management/api/users-in-group/")) {
          const groupname = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          const both: string[] = [];
          const inOnly: string[] = [];
          const outOnly: string[] = [];

          for (const [username, user] of users.entries()) {
            if (user.groupList.includes(groupname)) {
              both.push(username);
            }
            if (user.groupListIN.includes(groupname)) {
              inOnly.push(username);
            }
            if (user.groupListOUT.includes(groupname)) {
              outOnly.push(username);
            }
          }

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              groupname,
              usersInGroupList: both.sort(),
              usersInGroupListIN: inOnly.sort(),
              usersInGroupListOUT: outOnly.sort()
            })
          );
          return;
        }

        if (request.method === "POST" && url.pathname === "/user-management/api/new-user") {
          const body = JSON.parse(await readRequestBody(request)) as {
            groupList?: string[];
            groupListIN?: string[];
            groupListOUT?: string[];
            password: string;
            username: string;
          };

          users.set(body.username, {
            groupList: body.groupList ?? [],
            groupListIN: body.groupListIN ?? [],
            groupListOUT: body.groupListOUT ?? [],
            password: body.password
          });

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("");
          return;
        }

        if (request.method === "PUT" && url.pathname === "/user-management/api/change-user-password") {
          const body = JSON.parse(await readRequestBody(request)) as { password: string; username: string };
          const user = users.get(body.username);

          if (!user) {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "User not found!" }));
            return;
          }

          user.password = body.password;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("");
          return;
        }

        if (request.method === "PUT" && url.pathname === "/user-management/api/update-groups") {
          const body = JSON.parse(await readRequestBody(request)) as {
            groupList?: string[];
            groupListIN?: string[];
            groupListOUT?: string[];
            username: string;
          };
          const user = users.get(body.username);

          if (!user) {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "User not found!" }));
            return;
          }

          user.groupList = body.groupList ?? [];
          user.groupListIN = body.groupListIN ?? [];
          user.groupListOUT = body.groupListOUT ?? [];
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("");
          return;
        }

        if (request.method === "DELETE" && url.pathname.startsWith("/user-management/api/delete-user/")) {
          const username = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          users.delete(username);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("");
          return;
        }

        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: `Unhandled route: ${request.method} ${url.pathname}` }));
      }
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected a bound address.");
    }

    const baseDir = await mkdtemp(path.join(os.tmpdir(), "takcli-users-"));
    const configPath = path.join(baseDir, "config.yaml");
    const addProfileIo = createMemoryIo();

    let exitCode = await runCli(
      [
        "profile",
        "add",
        "local",
        "--server",
        `https://127.0.0.1:${address.port}`,
        "--api-port",
        String(address.port),
        "--insecure",
        "--auth-user",
        "admin",
        "--auth-password",
        "secret",
        "--set-current",
        "--config",
        configPath
      ],
      addProfileIo.io
    );

    expect(exitCode).toBe(0);

    const listIo = createMemoryIo();
    exitCode = await runCli(["users", "list", "--config", configPath, "--json"], listIo.io);
    expect(exitCode).toBe(0);
    expect(JSON.parse(listIo.readStdout())).toMatchObject({
      users: [{ username: "bob" }]
    });

    const createIo = createMemoryIo();
    exitCode = await runCli(
      [
        "users",
        "create",
        "alice",
        "--password",
        "Ch@ngeM3whenyoucan",
        "--group",
        "Blue",
        "--in-group",
        "Red",
        "--out-group",
        "Green",
        "--config",
        configPath,
        "--json"
      ],
      createIo.io
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(createIo.readStdout())).toMatchObject({
      user: {
        groupList: ["Blue"],
        groupListIN: ["Red"],
        groupListOUT: ["Green"],
        username: "alice"
      }
    });

    const addGroupsIo = createMemoryIo();
    exitCode = await runCli(
      [
        "users",
        "groups",
        "add",
        "alice",
        "--group",
        "Yellow",
        "--in-group",
        "Amber",
        "--config",
        configPath,
        "--json"
      ],
      addGroupsIo.io
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(addGroupsIo.readStdout())).toMatchObject({
      user: {
        groupList: ["Blue", "Yellow"],
        groupListIN: ["Amber", "Red"],
        groupListOUT: ["Green"],
        username: "alice"
      }
    });

    const membersIo = createMemoryIo();
    exitCode = await runCli(
      ["users", "groups", "members", "Yellow", "--config", configPath, "--json"],
      membersIo.io
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(membersIo.readStdout())).toMatchObject({
      group: {
        groupname: "Yellow",
        usersInGroupList: ["alice"]
      }
    });

    const setGroupsIo = createMemoryIo();
    exitCode = await runCli(
      [
        "users",
        "groups",
        "set",
        "alice",
        "--clear",
        "--out-group",
        "White",
        "--config",
        configPath,
        "--json"
      ],
      setGroupsIo.io
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(setGroupsIo.readStdout())).toMatchObject({
      user: {
        groupList: [],
        groupListIN: [],
        groupListOUT: ["White"],
        username: "alice"
      }
    });

    const resetPasswordIo = createMemoryIo();
    exitCode = await runCli(
      [
        "users",
        "reset-password",
        "alice",
        "--password",
        "@lsoCh@ngeM3WhenYouCan",
        "--config",
        configPath,
        "--json"
      ],
      resetPasswordIo.io
    );
    expect(exitCode).toBe(0);
    expect(users.get("alice")?.password).toBe("@lsoCh@ngeM3WhenYouCan");

    const groupsListIo = createMemoryIo();
    exitCode = await runCli(["users", "groups", "list", "--config", configPath, "--json"], groupsListIo.io);
    expect(exitCode).toBe(0);
    expect(
      (JSON.parse(groupsListIo.readStdout()) as { groups: Array<{ groupname: string }> }).groups.map((group) => group.groupname)
    ).toEqual(["__ANON__", "White"]);

    const deleteIo = createMemoryIo();
    exitCode = await runCli(["users", "delete", "alice", "--config", configPath, "--json"], deleteIo.io);
    expect(exitCode).toBe(0);
    expect(users.has("alice")).toBe(false);

    expect(seenAuthorizationHeaders.length).toBeGreaterThan(0);
    expect(seenAuthorizationHeaders.every((value) => value === expectedAuthorization)).toBe(true);
  });
});
