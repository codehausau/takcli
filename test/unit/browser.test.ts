import { describe, expect, it } from "vitest";

import {
  BrowserOpenError,
  describeBrowserOpenFailure,
  getBrowserLaunchCommands,
  shouldAttemptBrowserOpen
} from "../../src/map/browser.js";

describe("browser launch helpers", () => {
  it("prefers WSL-friendly openers before Linux desktop openers", () => {
    const commands = getBrowserLaunchCommands("http://127.0.0.1:3000", {
      env: {
        WSL_DISTRO_NAME: "Ubuntu"
      },
      platform: "linux"
    });

    expect(commands.map((entry) => entry.command)).toEqual([
      "wslview",
      "xdg-open",
      "gio",
      "sensible-browser"
    ]);
  });

  it("does not attempt browser open in headless Linux sessions", () => {
    expect(
      shouldAttemptBrowserOpen({
        env: {},
        platform: "linux"
      })
    ).toBe(false);
  });

  it("allows browser open in Linux desktop sessions", () => {
    expect(
      shouldAttemptBrowserOpen({
        env: {
          DISPLAY: ":1"
        },
        platform: "linux"
      })
    ).toBe(true);
  });

  it("formats a helpful headless message with the no-open hint", () => {
    const message = describeBrowserOpenFailure(
      new BrowserOpenError("No graphical desktop session was detected.", {
        reason: "headless"
      }),
      "http://127.0.0.1:3000",
      { supportsNoOpenFlag: true }
    );

    expect(message).toContain("Open http://127.0.0.1:3000 manually");
    expect(message).toContain("--no-open");
  });

  it("formats missing opener errors with the manual URL fallback", () => {
    const message = describeBrowserOpenFailure(
      new BrowserOpenError("spawn xdg-open ENOENT", {
        code: "ENOENT",
        openerCommand: "xdg-open",
        reason: "spawn"
      }),
      "http://127.0.0.1:3000"
    );

    expect(message).toContain("xdg-open");
    expect(message).toContain("Open http://127.0.0.1:3000 manually.");
  });
});
