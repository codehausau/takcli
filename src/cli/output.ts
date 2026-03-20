import process from "node:process";

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

export async function withSpinner<T>(
  io: IO,
  label: string,
  action: () => Promise<T>
): Promise<T> {
  if (!process.stdout.isTTY) {
    io.stdout(`${label}...\n`);
    return await action();
  }

  const frames = ["|", "/", "-", "\\"];
  let index = 0;

  io.stdout(`\r${frames[index]} ${label}`);
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    io.stdout(`\r${frames[index]} ${label}`);
  }, 100);

  try {
    return await action();
  } finally {
    clearInterval(timer);
    io.stdout(`\r${" ".repeat(label.length + 2)}\r`);
  }
}
