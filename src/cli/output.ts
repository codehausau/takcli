import process from "node:process";

import type { IO } from "./runtime.js";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function supportsColor(): boolean {
  if ("NO_COLOR" in process.env) {
    return false;
  }

  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

function applyAnsi(text: string, code: string): string {
  if (!supportsColor() || !text) {
    return text;
  }

  return `\x1b[${code}m${text}\x1b[0m`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
}

export const color = {
  accent: (text: string): string => applyAnsi(text, "36"),
  danger: (text: string): string => applyAnsi(text, "31"),
  dim: (text: string): string => applyAnsi(text, "2"),
  info: (text: string): string => applyAnsi(text, "34"),
  muted: (text: string): string => applyAnsi(text, "90"),
  strong: (text: string): string => applyAnsi(text, "1"),
  success: (text: string): string => applyAnsi(text, "32"),
  warning: (text: string): string => applyAnsi(text, "33")
};

export function formatPrompt(text: string): string {
  return `${color.accent(color.strong(text))}`;
}

export function formatStatusToken(options: {
  kind: "error" | "info" | "success" | "warning";
  text: string;
}): string {
  const label = `[${options.text}]`;

  switch (options.kind) {
    case "success":
      return color.success(color.strong(label));
    case "warning":
      return color.warning(color.strong(label));
    case "error":
      return color.danger(color.strong(label));
    case "info":
      return color.info(color.strong(label));
  }
}

export function writeCommandTitle(io: IO, title: string, subtitle?: string): void {
  io.stdout(`${color.accent(color.strong(title))}\n`);
  if (subtitle) {
    io.stdout(`${color.muted(subtitle)}\n`);
  }
  io.stdout("\n");
}

export function writeJson(io: IO, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeSection(io: IO, title: string, lines: string[]): void {
  const content = lines.length > 0 ? lines : [color.muted("(no output)")];
  const width = content.reduce((max, line) => Math.max(max, visibleLength(line)), 0);
  const border = color.muted(`+${"-".repeat(width + 2)}+`);

  io.stdout(`${color.accent(color.strong(title))}\n`);
  io.stdout(`${border}\n`);
  for (const line of content) {
    io.stdout(`${color.muted("|")} ${padVisible(line, width)} ${color.muted("|")}\n`);
  }
  io.stdout(`${border}\n`);
  io.stdout("\n");
}

export function renderTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] ?? "")))
  );

  const renderRow = (row: string[]): string =>
    row.map((value, index) => padVisible(value ?? "", widths[index])).join("  ");

  return [color.strong(renderRow(headers)), ...rows.map(renderRow)];
}

export async function withSpinner<T>(
  io: IO,
  label: string,
  action: () => Promise<T>
): Promise<T> {
  if (!process.stdout.isTTY) {
    io.stdout(`${color.info(`${label}...`)}\n`);
    return await action();
  }

  const frames = ["|", "/", "-", "\\"].map((frame) => color.accent(frame));
  let index = 0;
  const renderedLabel = color.strong(label);

  io.stdout(`\r${frames[index]} ${renderedLabel}`);
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    io.stdout(`\r${frames[index]} ${renderedLabel}`);
  }, 100);

  try {
    return await action();
  } finally {
    clearInterval(timer);
    io.stdout(`\r${" ".repeat(label.length + 12)}\r`);
  }
}
