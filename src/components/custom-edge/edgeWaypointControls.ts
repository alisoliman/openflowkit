import type { EdgeData } from '@/lib/types';

export interface Point {
  x: number;
  y: number;
}

interface RouteInsertHandle extends Point {
  index: number;
}

function isFinitePoint(point: unknown): point is Point {
  if (typeof point !== 'object' || point === null) return false;
  const candidate = point as Partial<Point>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

export function getManualWaypoints(data?: EdgeData): Point[] {
  const points = Array.isArray(data?.waypoints) ? data.waypoints.filter(isFinitePoint) : [];
  if (points.length > 0) return points.map(({ x, y }) => ({ x, y }));
  return isFinitePoint(data?.waypoint) ? [{ x: data.waypoint.x, y: data.waypoint.y }] : [];
}

export function withManualWaypoints(data: EdgeData | undefined, points: Point[]): EdgeData {
  const waypoints = points.filter(isFinitePoint).map(({ x, y }) => ({ x, y }));
  const hasImportedRoute = (data?.importRoutePoints?.length ?? 0) > 0
    || typeof data?.importRoutePath === 'string';
  const hasElkRoute = (data?.elkPoints?.length ?? 0) > 0;
  return {
    ...data,
    routingMode: waypoints.length > 0 ? 'manual' : hasImportedRoute ? 'import-fixed' : hasElkRoute ? 'elk' : 'auto',
    waypoint: undefined,
    waypoints: waypoints.length > 0 ? waypoints : undefined,
  };
}

const MAX_PATH_SAMPLES = 128;
const REFINEMENT_STEPS = 10;

/** Places insertion controls halfway along each rendered interval, including curved routes. */
export function getRouteInsertHandles(
  path: SVGPathElement | null,
  waypoints: Point[],
  source: Point,
  target: Point
): RouteInsertHandle[] {
  const anchors = [source, ...waypoints, target];
  const fallback = (): RouteInsertHandle[] => anchors.slice(1).map((point, index) => ({
    index,
    x: (anchors[index].x + point.x) / 2,
    y: (anchors[index].y + point.y) / 2,
  }));
  if (!path || typeof path.getTotalLength !== 'function' || typeof path.getPointAtLength !== 'function') {
    return fallback();
  }

  try {
    const totalLength = path.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0) return fallback();
    const pointAt = (length: number): Point => {
      const point = path.getPointAtLength(length);
      if (!isFinitePoint(point)) throw new Error('SVG path returned an invalid point');
      return { x: point.x, y: point.y };
    };
    if (waypoints.length === 0) return [{ index: 0, ...pointAt(totalLength / 2) }];

    // Sample the route once, regardless of its length, then refine only the nearest
    // interval for each waypoint. This bounds SVG geometry calls on very long edges.
    const sampleCount = Math.min(MAX_PATH_SAMPLES, Math.max(16, Math.ceil(totalLength / 12)));
    const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
      const length = totalLength * index / sampleCount;
      return { length, point: pointAt(length) };
    });
    const distanceSquared = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const lengths = [0];

    for (const waypoint of waypoints) {
      const minimum = lengths[lengths.length - 1];
      let bestLength = minimum;
      let bestDistance = distanceSquared(pointAt(minimum), waypoint);
      let bestSampleIndex = -1;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (sample.length < minimum) continue;
        const distance = distanceSquared(sample.point, waypoint);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLength = sample.length;
          bestSampleIndex = index;
        }
      }

      let lower = bestSampleIndex < 0 ? minimum : Math.max(minimum, samples[Math.max(0, bestSampleIndex - 1)].length);
      let upper = bestSampleIndex < 0
        ? samples.find(sample => sample.length > minimum)?.length ?? totalLength
        : samples[Math.min(sampleCount, bestSampleIndex + 1)].length;
      const measure = (length: number): number => {
        const distance = distanceSquared(pointAt(length), waypoint);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLength = length;
        }
        return distance;
      };
      for (let step = 0; step < REFINEMENT_STEPS && upper > lower; step += 1) {
        const left = lower + (upper - lower) / 3;
        const right = upper - (upper - lower) / 3;
        if (measure(left) <= measure(right)) upper = right;
        else lower = left;
      }
      // Restrict each search to the remaining route so loops cannot reorder bends.
      lengths.push(bestLength);
    }
    lengths.push(totalLength);
    return lengths.slice(1).map((length, index) => ({
      index,
      ...pointAt((lengths[index] + length) / 2),
    }));
  } catch {
    // Detached paths and jsdom may expose the methods without implementing them.
    return fallback();
  }
}
