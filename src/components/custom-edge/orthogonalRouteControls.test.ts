import { describe, expect, it } from 'vitest';
import { Position } from '@/lib/reactflowCompat';
import { getOrthogonalRoutePoints, getOrthogonalSegments, moveOrthogonalSegment, orthogonalizeRoute, type Point } from './orthogonalRouteControls';

function expectOrthogonal(points: Point[]): void {
  for (let index = 1; index < points.length; index += 1) {
    expect(points[index].x === points[index - 1].x || points[index].y === points[index - 1].y,
      `${JSON.stringify(points[index - 1])} → ${JSON.stringify(points[index])}`).toBe(true);
  }
}

const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 120 }, { x: 220, y: 120 }];

describe('orthogonal route controls', () => {
  it('recovers original corners from rounded Q paths and removes redundant points', () => {
    expect(getOrthogonalRoutePoints('M0,0 L40,0 L80,0 Q100,0 100,20 L100,100 Q100,120 120,120 L220,120', route[0], route[3]))
      .toEqual(route);
  });

  it('uses the actual rendered anchors, including renderer endpoint offsets', () => {
    const points = getOrthogonalRoutePoints('M 2 4 L 60 4 L 60 104 L 220 104', route[0], route[3]);
    expect(points[0]).toEqual({ x: 2, y: 4 });
    expect(points.at(-1)).toEqual({ x: 220, y: 104 });
  });

  it.each(['', 'M0,0 C20,40 80,60 100,100', 'M0,0 L100,100', 'M0,0 L nope'])('falls back to an orthogonal endpoint route for %s', (path) => {
    const source = { x: 0, y: 0 };
    const target = { x: 200, y: 100 };
    const points = getOrthogonalRoutePoints(path, source, target);
    expect(points[0]).toEqual(source);
    expect(points.at(-1)).toEqual(target);
    expectOrthogonal(points);
  });

  it('returns midpoint controls indexed by their full route segments', () => {
    expect(getOrthogonalSegments(route)).toEqual([
      { index: 0, x: 50, y: 0, orientation: 'horizontal' },
      { index: 1, x: 100, y: 60, orientation: 'vertical' },
      { index: 2, x: 160, y: 120, orientation: 'horizontal' },
    ]);
  });

  it('moves an interior segment and both adjacent corners without changing either anchor', () => {
    const points = moveOrthogonalSegment(route, 1, 150);
    expect(points).toEqual([route[0], { x: 150, y: 0 }, { x: 150, y: 120 }, route[3]]);
    expect(route[1]).toEqual({ x: 100, y: 0 });
    expectOrthogonal(points);
  });

  it.each([0, 2])('adds an endpoint dogleg when moving segment %s', (index) => {
    const points = moveOrthogonalSegment(route, index, 60);
    expect(points[0]).toEqual(route[0]);
    expect(points.at(-1)).toEqual(route[3]);
    expect(getOrthogonalSegments(points).some((segment) => segment.orientation === 'horizontal' && segment.y === 60)).toBe(true);
    expectOrthogonal(points);
    // Each connector still leaves/enters its node horizontally.
    expect(points[1].y).toBe(points[0].y);
    expect(points.at(-2)?.y).toBe(points.at(-1)?.y);
  });

  it.each([
    { source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, coordinate: 50, axis: 'y' as const },
    { source: { x: 100, y: 0 }, target: { x: 0, y: 0 }, coordinate: -50, axis: 'y' as const },
    { source: { x: 0, y: 100 }, target: { x: 0, y: 0 }, coordinate: 50, axis: 'x' as const },
  ])('bends a single straight segment while keeping both anchors attached: $target', ({ source, target, coordinate, axis }) => {
    const points = moveOrthogonalSegment([source, target], 0, coordinate);
    expect(points[0]).toEqual(source);
    expect(points.at(-1)).toEqual(target);
    expect(points).toHaveLength(6);
    expect(points[2][axis]).toBe(coordinate);
    expect(points[3][axis]).toBe(coordinate);
    expectOrthogonal(points);
  });

  it('keeps unchanged and invalid drags from creating a different route', () => {
    expect(moveOrthogonalSegment(route, 0, 0)).toBe(route);
    expect(moveOrthogonalSegment(route, 10, 50)).toBe(route);
    expect(moveOrthogonalSegment(route, 1, Number.NaN)).toBe(route);
  });

  it('reconnects moved anchors and numeric bends along their handle axes', () => {
    const points = orthogonalizeRoute([
      { x: -25, y: 17 }, { x: 100, y: 0 }, { x: 100, y: 120 }, { x: 235, y: 153 },
    ], Position.Right, Position.Left);
    expect(points[0]).toEqual({ x: -25, y: 17 });
    expect(points.at(-1)).toEqual({ x: 235, y: 153 });
    expect(points[1].y).toBe(17);
    expect(points.at(-2)?.y).toBe(153);
    expectOrthogonal(points);
  });
});
