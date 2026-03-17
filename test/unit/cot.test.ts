import { describe, expect, it } from "vitest";

import { getDefaultCotTargetDateRange } from "../../src/tak/cot/service.js";
import { buildCotEventXml, formatCotSummaryLine, parseCotEventXml } from "../../src/tak/cot/xml.js";

describe("CoT helpers", () => {
  it("builds and parses a generated CoT event", () => {
    const xml = buildCotEventXml(
      {
        callsign: "Eagle 1",
        ce: 12,
        hae: 450,
        how: "m-g",
        lat: -35.3,
        le: 22,
        lon: 149.1,
        remarks: "hello world",
        staleSeconds: 300,
        type: "a-f-G-U-C",
        uid: "alpha"
      },
      new Date("2026-03-17T10:00:00.000Z")
    );

    const event = parseCotEventXml(xml);

    expect(event.uid).toBe("alpha");
    expect(event.callsign).toBe("Eagle 1");
    expect(event.remarks).toBe("hello world");
    expect(event.point).toMatchObject({
      ce: 12,
      hae: 450,
      lat: -35.3,
      le: 22,
      lon: 149.1
    });
    expect(event.time).toBe("2026-03-17T10:00:00.000Z");
    expect(event.stale).toBe("2026-03-17T10:05:00.000Z");
  });

  it("formats a compact CoT summary line", () => {
    const line = formatCotSummaryLine(
      parseCotEventXml(
        '<event version="2.0" uid="alpha" type="a-f-G-U-C" time="2026-03-17T10:00:00.000Z" start="2026-03-17T10:00:00.000Z" stale="2026-03-17T10:05:00.000Z" how="m-g"><point lat="-35.3" lon="149.1" hae="450" ce="12" le="22"/><detail><contact callsign="Eagle 1"/></detail></event>'
      )
    );

    expect(line).toContain("alpha");
    expect(line).toContain("Eagle 1");
    expect(line).toContain("-35.30000,149.10000");
  });

  it("computes the default targets date range from the last 24 hours", () => {
    const range = getDefaultCotTargetDateRange(new Date("2026-03-17T15:30:00.000Z"));

    expect(range).toEqual({
      endDate: "2026-03-17",
      startDate: "2026-03-16"
    });
  });
});
