import type { Position } from '@/lib/reactflowCompat';

export interface Point { x: number; y: number }
export interface OrthogonalSegment {
  index: number;
  x: number;
  y: number;
  orientation: 'horizontal' | 'vertical';
}

const EPSILON = 0.000001;
const ENDPOINT_LEAD = 20;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;
const samePoint = (a: Point, b: Point): boolean => close(a.x, b.x) && close(a.y, b.y);

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (result.length && samePoint(result[result.length - 1], point)) continue;
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const collinear = (close(a.x, b.x) && close(b.x, point.x))
        || (close(a.y, b.y) && close(b.y, point.y));
      // A reversal is a real part of an endpoint dogleg, not a redundant point.
      const continuesForward = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) >= 0;
      if (!collinear || !continuesForward) break;
      result.pop();
    }
    result.push({ ...point });
  }
  return result;
}

function sideAxis(side: Position | undefined): 'horizontal' | 'vertical' | undefined {
  if (side === 'left' || side === 'right') return 'horizontal';
  if (side === 'top' || side === 'bottom') return 'vertical';
  return undefined;
}

/** Reconnect moved anchors or numeric bends with elbows, retaining already orthogonal segments. */
export function orthogonalizeRoute(points: Point[], sourcePosition?: Position, targetPosition?: Position): Point[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const result: Point[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const previous = result[result.length - 1];
    const next = points[index];
    if (!close(previous.x, next.x) && !close(previous.y, next.y)) {
      const startAxis = index === 1 ? sideAxis(sourcePosition) : undefined;
      const endAxis = index === points.length - 1 ? sideAxis(targetPosition) : undefined;
      const incoming = result.length > 1
        ? close(result[result.length - 2].y, previous.y) ? 'horizontal' : 'vertical'
        : undefined;
      const firstAxis = startAxis ?? (endAxis === 'horizontal' ? 'vertical' : endAxis === 'vertical' ? 'horizontal' : undefined)
        ?? (incoming === 'horizontal' ? 'vertical' : 'horizontal');
      result.push(firstAxis === 'horizontal'
        ? { x: next.x, y: previous.y }
        : { x: previous.x, y: next.y });
    }
    result.push({ ...next });
  }
  return simplify(result);
}

function fallbackRoute(source: Point, target: Point): Point[] {
  if (close(source.x, target.x) || close(source.y, target.y)) return simplify([source, target]);
  return Math.abs(target.x - source.x) >= Math.abs(target.y - source.y)
    ? simplify([source, { x: (source.x + target.x) / 2, y: source.y }, { x: (source.x + target.x) / 2, y: target.y }, target])
    : simplify([source, { x: source.x, y: (source.y + target.y) / 2 }, { x: target.x, y: (source.y + target.y) / 2 }, target]);
}

/** React Flow emits M/L/Q for step paths. A rounded Q's control point is the original corner. */
export function getOrthogonalRoutePoints(path: string, source: Point, target: Point): Point[] {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Point[] = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    const count = command === 'Q' ? 4 : command === 'M' || command === 'L' ? 2 : 0;
    if (!count || index + count > tokens.length) return fallbackRoute(source, target);
    const values = tokens.slice(index, index + count).map(Number);
    if (!values.every(Number.isFinite)) return fallbackRoute(source, target);
    index += count;
    points.push({ x: values[0], y: values[1] });
    if (command === 'Q') points.push({ x: values[2], y: values[3] });
  }
  const route = simplify(points);
  return route.length >= 2 && route.every((point, pointIndex) => pointIndex === 0
    || close(point.x, route[pointIndex - 1].x) || close(point.y, route[pointIndex - 1].y))
    ? route : fallbackRoute(source, target);
}

export function getOrthogonalSegments(points: Point[]): OrthogonalSegment[] {
  return points.slice(0, -1).flatMap((point, index) => {
    const next = points[index + 1];
    if (samePoint(point, next)) return [];
    const orientation = close(point.y, next.y) ? 'horizontal' : close(point.x, next.x) ? 'vertical' : undefined;
    return orientation ? [{ index, x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, orientation }] : [];
  });
}

/** Move one segment perpendicular to its axis. Endpoint leads keep node anchors fixed. */
export function moveOrthogonalSegment(points: Point[], index: number, coordinate: number): Point[] {
  const segment = getOrthogonalSegments(points).find((item) => item.index === index);
  if (!segment || !Number.isFinite(coordinate)) return points;
  const horizontal = segment.orientation === 'horizontal';
  if (close(horizontal ? segment.y : segment.x, coordinate)) return points;
  const axis = horizontal ? 'x' : 'y';
  const perpendicular = horizontal ? 'y' : 'x';
  const start = points[index];
  const end = points[index + 1];
  const lead = Math.sign(end[axis] - start[axis]) * Math.min(ENDPOINT_LEAD, Math.abs(end[axis] - start[axis]) / 3);
  const movedStart = { ...start, [perpendicular]: coordinate };
  const movedEnd = { ...end, [perpendicular]: coordinate };
  const prefix = index === 0
    ? [start, { ...start, [axis]: start[axis] + lead }, { ...movedStart, [axis]: start[axis] + lead }]
    : [...points.slice(0, index), movedStart];
  const suffix = index === points.length - 2
    ? [{ ...movedEnd, [axis]: end[axis] - lead }, { ...end, [axis]: end[axis] - lead }, end]
    : [movedEnd, ...points.slice(index + 2)];
  return simplify([...prefix, ...suffix]);
}
