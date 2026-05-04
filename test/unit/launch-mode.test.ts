import { describe, expect, it } from "vitest";

import { resolveMapLaunchSettings } from "../../src/map/launch-mode.js";

describe("map launch mode helpers", () => {
  it("keeps local mode defaults unchanged", () => {
    expect(
      resolveMapLaunchSettings({
        defaultOpen: true,
        host: "127.0.0.1",
        hostValueSource: "default",
        mode: "local",
        openValueSource: "default"
      })
    ).toEqual({
      host: "127.0.0.1",
      open: true
    });
  });

  it("switches web mode to 0.0.0.0 and disables auto-open by default", () => {
    expect(
      resolveMapLaunchSettings({
        defaultOpen: true,
        host: "127.0.0.1",
        hostValueSource: "default",
        mode: "web",
        openValueSource: "default"
      })
    ).toEqual({
      host: "0.0.0.0",
      open: false
    });
  });

  it("preserves explicit host and open choices in web mode", () => {
    expect(
      resolveMapLaunchSettings({
        defaultOpen: false,
        host: "192.168.1.10",
        hostValueSource: "cli",
        mode: "web",
        openValueSource: "cli"
      })
    ).toEqual({
      host: "192.168.1.10",
      open: false
    });
  });
});
