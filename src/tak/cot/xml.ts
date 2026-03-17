import type { CotEventSummary, CotInjectInput } from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function readAttribute(source: string, attribute: string): string | undefined {
  const pattern = new RegExp(`\\b${escapeRegex(attribute)}=(["'])(.*?)\\1`, "i");
  const match = source.match(pattern);
  return decodeXml(match?.[2]);
}

function readInnerText(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${escapeRegex(tagName)}\\b[^>]*>([\\s\\S]*?)</${escapeRegex(tagName)}>`, "i");
  const match = xml.match(pattern);
  return decodeXml(match?.[1].trim());
}

function requireFiniteNumber(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Missing or invalid CoT field: ${field}`);
  }

  return parsed;
}

export function parseCotEventXml(xml: string): CotEventSummary {
  const trimmed = xml.trim();
  const eventMatch = trimmed.match(/<event\b([\s\S]*?)>([\s\S]*?)<\/event>/i);
  if (!eventMatch) {
    throw new Error("Invalid CoT XML: missing <event> root element.");
  }

  const eventAttributes = eventMatch[1];
  const body = eventMatch[2];
  const pointMatch = body.match(/<point\b([\s\S]*?)\/?>/i);
  if (!pointMatch) {
    throw new Error("Invalid CoT XML: missing <point> element.");
  }

  const pointAttributes = pointMatch[1];
  const uid = readAttribute(eventAttributes, "uid");
  const type = readAttribute(eventAttributes, "type");
  const how = readAttribute(eventAttributes, "how");

  if (!uid || !type || !how) {
    throw new Error("Invalid CoT XML: missing uid, type, or how attributes.");
  }

  const callsign =
    readAttribute(body, "callsign") ?? readAttribute(body, "endpoint") ?? readInnerText(body, "callsign");

  return {
    callsign,
    how,
    point: {
      ce: requireFiniteNumber(readAttribute(pointAttributes, "ce"), "point.ce"),
      hae: requireFiniteNumber(readAttribute(pointAttributes, "hae"), "point.hae"),
      lat: requireFiniteNumber(readAttribute(pointAttributes, "lat"), "point.lat"),
      le: requireFiniteNumber(readAttribute(pointAttributes, "le"), "point.le"),
      lon: requireFiniteNumber(readAttribute(pointAttributes, "lon"), "point.lon")
    },
    rawXml: trimmed,
    remarks: readInnerText(body, "remarks"),
    start: readAttribute(eventAttributes, "start"),
    stale: readAttribute(eventAttributes, "stale"),
    time: readAttribute(eventAttributes, "time"),
    type,
    uid
  };
}

export function buildCotEventXml(input: CotInjectInput, now = new Date()): string {
  const time = now.toISOString();
  const stale = new Date(now.getTime() + input.staleSeconds * 1000).toISOString();
  const detailParts: string[] = [];

  if (input.callsign) {
    detailParts.push(`<contact callsign="${escapeXml(input.callsign)}"/>`);
  }

  if (input.remarks) {
    detailParts.push(`<remarks>${escapeXml(input.remarks)}</remarks>`);
  }

  const detail = detailParts.length > 0 ? `<detail>${detailParts.join("")}</detail>` : "";

  return [
    `<event version="2.0" uid="${escapeXml(input.uid)}" type="${escapeXml(input.type)}" time="${time}" start="${time}" stale="${stale}" how="${escapeXml(input.how)}">`,
    `<point lat="${input.lat}" lon="${input.lon}" hae="${input.hae}" ce="${input.ce}" le="${input.le}"/>`,
    detail,
    "</event>"
  ].join("");
}

export function formatCotSummaryLine(event: CotEventSummary): string {
  const callsign = event.callsign ?? "-";
  const time = event.time ?? "-";
  return `${time}  ${event.uid}  ${callsign}  ${event.type}  ${event.point.lat.toFixed(5)},${event.point.lon.toFixed(5)}`;
}
