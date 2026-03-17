import type { CotFollowEvent, CotInjectInput, CotInjectResult, CotQueryResult, CotRuntimeContext, CotTargetRecord, CotTargetsResult, UidSearchResult } from "./types.js";
import { buildCotEventXml, parseCotEventXml } from "./xml.js";
import { fetchCotEventXml, fetchUidSearchResults } from "./http.js";
import { sendCotEventXml, streamCotEvents } from "./stream.js";

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getDefaultCotTargetDateRange(now = new Date()): { endDate: string; startDate: string } {
  return {
    endDate: isoDateOnly(now),
    startDate: isoDateOnly(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  };
}

export async function queryCot(context: CotRuntimeContext, lookup: { cotId?: number; uid?: string }): Promise<CotQueryResult> {
  const rawXml = await fetchCotEventXml(context.profile, context.timeoutMs, lookup);
  const event = parseCotEventXml(rawXml);

  return {
    command: "cot query",
    configPath: context.config.path,
    event,
    generatedAt: new Date().toISOString(),
    lookup,
    profile: context.profile,
    rawXml
  };
}

async function enrichTarget(
  context: CotRuntimeContext,
  uidResult: UidSearchResult
): Promise<CotTargetRecord> {
  try {
    const query = await queryCot(context, { uid: uidResult.uid });
    return {
      callsign: query.event.callsign ?? uidResult.callSign,
      lat: query.event.point.lat,
      lon: query.event.point.lon,
      time: query.event.time,
      type: query.event.type,
      uid: query.event.uid
    };
  } catch (error) {
    return {
      callsign: uidResult.callSign,
      error: error instanceof Error ? error.message : String(error),
      uid: uidResult.uid
    };
  }
}

export async function collectCotTargets(
  context: CotRuntimeContext,
  startDate: string,
  endDate: string,
  limit: number
): Promise<CotTargetsResult> {
  const uidResults = await fetchUidSearchResults(context.profile, context.timeoutMs, startDate, endDate);
  const selected = uidResults.slice(0, limit);
  const targets: CotTargetRecord[] = [];

  for (const uidResult of selected) {
    targets.push(await enrichTarget(context, uidResult));
  }

  return {
    command: "cot targets",
    configPath: context.config.path,
    endDate,
    generatedAt: new Date().toISOString(),
    limit,
    profile: context.profile,
    startDate,
    targets
  };
}

export async function injectCot(
  context: CotRuntimeContext,
  input: CotInjectInput
): Promise<CotInjectResult> {
  const rawXml = buildCotEventXml(input);
  const event = parseCotEventXml(rawXml);
  const bytesSent = await sendCotEventXml(context.profile, rawXml, context.timeoutMs);

  return {
    bytesSent,
    command: "cot inject",
    configPath: context.config.path,
    event,
    generatedAt: new Date().toISOString(),
    profile: context.profile
  };
}

export async function followCot(
  context: CotRuntimeContext,
  options: {
    limit?: number;
    onEvent: (event: CotFollowEvent) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  await streamCotEvents(context.profile, context.timeoutMs, {
    limit: options.limit,
    onEvent: (xml, sequence) => {
      const event = parseCotEventXml(xml);
      options.onEvent({
        command: "cot follow",
        configPath: context.config.path,
        event,
        generatedAt: new Date().toISOString(),
        profile: context.profile,
        sequence
      });
    },
    signal: options.signal
  });
}
