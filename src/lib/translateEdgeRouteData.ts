import type { EdgeData } from '@/lib/types';

/** Stored routes use canvas coordinates, so a copied graph must move their points too. */
export function translateEdgeRouteData(data: EdgeData | undefined, offset: { x: number; y: number }): EdgeData | undefined {
  if (!data) return data;
  const move = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  });
  return {
    ...data,
    ...(data.waypoint ? { waypoint: move(data.waypoint) } : {}),
    ...(data.waypoints ? { waypoints: data.waypoints.map(move) } : {}),
    ...(data.elkPoints ? { elkPoints: data.elkPoints.map(move) } : {}),
    ...(data.importRoutePoints ? { importRoutePoints: data.importRoutePoints.map(move) } : {}),
    // The renderer prefers the SVG path over its points. Fall back to the translated points
    // rather than leave an old absolute path behind. Path-only imports retain their data.
    ...(data.importRoutePath && data.importRoutePoints?.length ? { importRoutePath: undefined } : {}),
  };
}
