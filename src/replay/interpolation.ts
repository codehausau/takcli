import type { ReplayDatasetSummary, ReplayTrackPoint } from "./types.js";

function interpolateNumber(start: number | undefined, end: number | undefined, ratio: number): number | undefined {
  if (start === undefined && end === undefined) {
    return undefined;
  }

  if (start === undefined) {
    return end;
  }

  if (end === undefined) {
    return start;
  }

  return start + ((end - start) * ratio);
}

function normalizeCourse(course: number): number {
  return ((course % 360) + 360) % 360;
}

function interpolateCourse(start: number | undefined, end: number | undefined, ratio: number): number | undefined {
  if (start === undefined || end === undefined) {
    return interpolateNumber(start, end, ratio);
  }

  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  return normalizeCourse(start + (delta * ratio));
}

function buildInterpolatedPoint(start: ReplayTrackPoint, end: ReplayTrackPoint, sourceTimeMs: number): ReplayTrackPoint {
  const ratio = (sourceTimeMs - start.sourceTimeMs) / (end.sourceTimeMs - start.sourceTimeMs);

  return {
    ...start,
    course: interpolateCourse(start.course, end.course, ratio),
    interpolated: true,
    lat: interpolateNumber(start.lat, end.lat, ratio)!,
    lon: interpolateNumber(start.lon, end.lon, ratio)!,
    sourceTime: new Date(sourceTimeMs).toISOString(),
    sourceTimeMs,
    speedKnots: interpolateNumber(start.speedKnots, end.speedKnots, ratio),
    speedMetersPerSecond: interpolateNumber(start.speedMetersPerSecond, end.speedMetersPerSecond, ratio)
  };
}

export function interpolateReplayDataset(
  dataset: ReplayDatasetSummary,
  intervalMs: number
): ReplayDatasetSummary {
  if (intervalMs <= 0 || dataset.trackPoints.length < 2) {
    return dataset;
  }

  const trackPointsByUid = new Map<string, ReplayTrackPoint[]>();
  for (const trackPoint of dataset.trackPoints) {
    const trackPoints = trackPointsByUid.get(trackPoint.uid) ?? [];
    trackPoints.push(trackPoint);
    trackPointsByUid.set(trackPoint.uid, trackPoints);
  }

  const generatedTrackPoints: ReplayTrackPoint[] = [];
  for (const trackPoints of trackPointsByUid.values()) {
    trackPoints.sort((left, right) => left.sourceTimeMs - right.sourceTimeMs);

    for (let index = 0; index < trackPoints.length - 1; index += 1) {
      const current = trackPoints[index]!;
      const next = trackPoints[index + 1]!;
      const gapMs = next.sourceTimeMs - current.sourceTimeMs;
      if (gapMs <= intervalMs) {
        continue;
      }

      for (
        let sourceTimeMs = current.sourceTimeMs + intervalMs;
        sourceTimeMs < next.sourceTimeMs;
        sourceTimeMs += intervalMs
      ) {
        generatedTrackPoints.push(buildInterpolatedPoint(current, next, sourceTimeMs));
      }
    }
  }

  if (generatedTrackPoints.length === 0) {
    return {
      ...dataset,
      interpolation: {
        generatedTrackPoints: 0,
        intervalMs,
        originalTrackPoints: dataset.trackPoints.length
      }
    };
  }

  const trackPoints = [...dataset.trackPoints, ...generatedTrackPoints].sort((left, right) =>
    left.sourceTimeMs === right.sourceTimeMs
      ? left.uid.localeCompare(right.uid)
      : left.sourceTimeMs - right.sourceTimeMs
  );

  return {
    ...dataset,
    interpolation: {
      generatedTrackPoints: generatedTrackPoints.length,
      intervalMs,
      originalTrackPoints: dataset.trackPoints.length
    },
    trackPoints
  };
}
