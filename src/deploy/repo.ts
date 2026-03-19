import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { CliError } from "../cli/runtime.js";
import type { CommandRunner } from "./types.js";

function looksLikeSymbolicRef(ref: string): boolean {
  return !/^[0-9a-f]{7,40}$/i.test(ref);
}

export function createRefCacheSegment(ref: string): string {
  const safe = ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "ref";
  const hash = createHash("sha1").update(ref).digest("hex").slice(0, 12);
  return `${safe}-${hash}`;
}

export function getDefaultTakServerCacheRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".takcli", "cache", "tak-server");
}

export function getDefaultDeploymentRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".takcli", "deployments");
}

export async function ensureTakServerClone(options: {
  cacheRoot?: string;
  ref: string;
  repoUrl: string;
  runner: CommandRunner;
}): Promise<{ clonePath: string; gitCommit: string }> {
  const cacheRoot = options.cacheRoot ?? getDefaultTakServerCacheRoot();
  const clonePath = path.join(cacheRoot, createRefCacheSegment(options.ref));

  await mkdir(cacheRoot, { recursive: true });

  const existsResult = await options.runner.run("git", ["-C", clonePath, "rev-parse", "HEAD"]).catch(() => undefined);
  if (!existsResult || existsResult.exitCode !== 0) {
    const cloneArgs = ["clone", "--quiet"];
    if (looksLikeSymbolicRef(options.ref)) {
      cloneArgs.push("--branch", options.ref, "--single-branch", "--depth", "1");
    }
    cloneArgs.push(options.repoUrl, clonePath);

    const cloneResult = await options.runner.run("git", cloneArgs);
    if (cloneResult.exitCode !== 0) {
      throw new CliError(`Unable to clone TAK Server repository: ${cloneResult.stderr || cloneResult.stdout}`);
    }

    if (!looksLikeSymbolicRef(options.ref)) {
      const checkoutResult = await options.runner.run(
        "git",
        ["-C", clonePath, "checkout", "--detach", options.ref, "--quiet"]
      );
      if (checkoutResult.exitCode !== 0) {
        throw new CliError(`Unable to checkout TAK Server ref ${options.ref}: ${checkoutResult.stderr || checkoutResult.stdout}`);
      }
    }
  }

  const revParse = await options.runner.run("git", ["-C", clonePath, "rev-parse", "HEAD"]);
  if (revParse.exitCode !== 0) {
    throw new CliError(`Unable to resolve TAK Server commit: ${revParse.stderr || revParse.stdout}`);
  }

  return {
    clonePath,
    gitCommit: revParse.stdout.trim()
  };
}
