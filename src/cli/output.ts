import type { IO } from "./runtime.js";

export function writeJson(io: IO, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeSection(io: IO, title: string, lines: string[]): void {
  io.stdout(`${title}\n`);
  for (const line of lines) {
    io.stdout(`${line}\n`);
  }
  io.stdout("\n");
}

export function renderTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );

  const renderRow = (row: string[]): string =>
    row.map((value, index) => (value ?? "").padEnd(widths[index], " ")).join("  ");

  return [renderRow(headers), ...rows.map(renderRow)];
}
