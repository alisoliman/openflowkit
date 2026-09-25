import { describe, expect, it, vi } from 'vitest';
import type { EdgeData } from '@/lib/types';
import { getManualWaypoints, getRouteInsertHandles, withManualWaypoints, type Point } from './edgeWaypointControls';

function mockPath(length: number, pointAtLength: (length: number) => Point): SVGPathElement {
  return {
    getTotalLength: vi.fn(() => length),
    getPointAtLength: vi.fn(pointAtLength),
  } as unknown as SVGPathElement;
}

describe('manual waypoint data', () => {
  it('prefers finite array points and falls back to the legacy point when the array is empty or invalid', () => {
    const legacy = { x: 2, y: 3 };
    const data: EdgeData = { waypoint: legacy, waypoints: [{ x: NaN, y: 5 }, { x: 10, y: 20 }, { x: 8, y: Infinity }] };
    expect(getManualWaypoints(data)).toEqual([{ x: 10, y: 20 }]);
    expect(getManualWaypoints({ ...data, waypoints: [] })).toEqual([legacy]);
    expect(getManualWaypoints({ ...data, waypoints: [{ x: NaN, y: 0 }] })).toEqual([legacy]);
    expect(getManualWaypoints({ waypoint: { x: 0, y: Infinity } })).toEqual([]);
    expect(getManualWaypoints()).toEqual([]);
    expect(getManualWaypoints(data)[0]).not.toBe(data.waypoints![1]);
  });

  it('sets manual routing without mutating inputs or discarding cached routes and metadata', () => {
    const data: EdgeData = {
      routingMode: 'import-fixed',
      waypoint: { x: 1, y: 2 },
      elkPoints: [{ x: 3, y: 4 }],
      importRoutePoints: [{ x: 5, y: 6 }],
      importRoutePath: 'M 0 0 L 100 100',
      labelOffsetX: 12,
    };
    const points = [{ x: 30, y: 40 }];
    const updated = withManualWaypoints(data, points);
    expect(updated).toEqual({ ...data, routingMode: 'manual', waypoint: undefined, waypoints: points });
    expect(updated.waypoints).not.toBe(points);
    expect(updated.waypoints![0]).not.toBe(points[0]);
    expect(updated.elkPoints).toBe(data.elkPoints);
    expect(updated.importRoutePoints).toBe(data.importRoutePoints);
    expect(data.routingMode).toBe('import-fixed');
    expect(data.waypoint).toEqual({ x: 1, y: 2 });
  });

  it.each([
    [{ importRoutePoints: [{ x: 1, y: 2 }], elkPoints: [{ x: 3, y: 4 }] }, 'import-fixed'],
    [{ importRoutePath: 'M0 0 L10 10' }, 'import-fixed'],
    [{ elkPoints: [{ x: 3, y: 4 }] }, 'elk'],
    [{ routingMode: 'manual' }, 'auto'],
    [undefined, 'auto'],
  ] as Array<[EdgeData | undefined, EdgeData['routingMode']]>)('restores cached routing when all bends are removed: %j', (data, routingMode) => {
    const updated = withManualWaypoints({ ...data, waypoint: { x: 1, y: 2 }, waypoints: [{ x: 3, y: 4 }] }, []);
    expect(updated).toEqual({ ...data, routingMode, waypoint: undefined, waypoints: undefined });
  });
});

describe('route insertion handles', () => {
  const source = { x: 100, y: 0 };
  const target = { x: -100, y: 0 };
  const arcPoint = (length: number): Point => ({ x: 100 * Math.cos(length / 100), y: 100 * Math.sin(length / 100) });

  it('uses the rendered arc midpoint instead of the straight coordinate midpoint', () => {
    const path = mockPath(Math.PI * 100, arcPoint);
    const [handle] = getRouteInsertHandles(path, [], source, target);
    expect(handle.index).toBe(0);
    expect(handle.x).toBeCloseTo(0, 6);
    expect(handle.y).toBeCloseTo(100, 6);
    expect(path.getPointAtLength).toHaveBeenCalledTimes(1);
  });

  it('splits the rendered arc at ordered nearest waypoint positions, including off-path bends', () => {
    const path = mockPath(Math.PI * 100, arcPoint);
    const handles = getRouteInsertHandles(path, [{ x: 0, y: 120 }], source, target);
    expect(handles.map(handle => handle.index)).toEqual([0, 1]);
    expect(handles[0].x).toBeCloseTo(Math.sqrt(5000), 1);
    expect(handles[0].y).toBeCloseTo(Math.sqrt(5000), 1);
    expect(handles[1].x).toBeCloseTo(-Math.sqrt(5000), 1);
    expect(handles[1].y).toBeCloseTo(Math.sqrt(5000), 1);
    handles.forEach(handle => expect(Math.hypot(handle.x, handle.y)).toBeCloseTo(100, 6));
  });

  it('does not match a later bend to an earlier pass through the same coordinate', () => {
    // A square loop followed by a rightward tail retraces part of its first segment.
    const path = mockPath(600, length => {
      if (length <= 100) return { x: length, y: 0 };
      if (length <= 200) return { x: 100, y: length - 100 };
      if (length <= 300) return { x: 300 - length, y: 100 };
      if (length <= 400) return { x: 0, y: 400 - length };
      return { x: length - 400, y: 0 };
    });
    const handles = getRouteInsertHandles(path, [{ x: 0, y: 100 }, { x: 50, y: 0 }], { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(handles.map(handle => handle.index)).toEqual([0, 1, 2]);
    expect(handles[0].x).toBeCloseTo(100, 1);
    expect(handles[0].y).toBeCloseTo(50, 1);
    expect(handles[1].x).toBeCloseTo(0, 1);
    expect(handles[1].y).toBeCloseTo(25, 1);
    expect(handles[2].x).toBeCloseTo(125, 1);
    expect(handles[2].y).toBeCloseTo(0, 1);
  });

  it('bounds geometry sampling independently of route length', () => {
    const path = mockPath(1_000_000, length => ({ x: length, y: 0 }));
    const handles = getRouteInsertHandles(path, [{ x: 300_000, y: 0 }, { x: 700_000, y: 0 }], { x: 0, y: 0 }, { x: 1_000_000, y: 0 });
    expect(handles).toHaveLength(3);
    expect(vi.mocked(path.getPointAtLength).mock.calls.length).toBeLessThanOrEqual(174);
    expect(handles.every(handle => Number.isFinite(handle.x) && handle.y === 0)).toBe(true);
  });

  it('falls back safely for missing, unsupported, zero-length and invalid SVG geometry', () => {
    const points = [{ x: 20, y: 40 }];
    const fallback = [{ index: 0, x: 60, y: 20 }, { index: 1, x: -40, y: 20 }];
    const paths = [
      null,
      document.createElementNS('http://www.w3.org/2000/svg', 'path'),
      mockPath(0, arcPoint),
      mockPath(NaN, arcPoint),
      mockPath(Infinity, arcPoint),
      mockPath(100, () => { throw new Error('not implemented'); }),
      mockPath(100, () => ({ x: NaN, y: 0 })),
    ];
    paths.forEach(path => expect(getRouteInsertHandles(path, points, source, target)).toEqual(fallback));
  });
});
