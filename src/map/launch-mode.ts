export type MapLaunchMode = "local" | "web";

export function parseMapLaunchMode(value: string): MapLaunchMode {
  if (value === "local" || value === "web") {
    return value;
  }

  throw new Error(`Unsupported map launch mode: ${value}`);
}

export function resolveMapLaunchSettings(options: {
  defaultOpen: boolean;
  host: string;
  hostValueSource?: string;
  mode: MapLaunchMode;
  openValueSource?: string;
}): {
  host: string;
  open: boolean;
} {
  const host =
    options.mode === "web" && options.hostValueSource === "default"
      ? "0.0.0.0"
      : options.host;
  const open =
    options.mode === "web" && options.openValueSource === "default"
      ? false
      : options.defaultOpen;

  return { host, open };
}
