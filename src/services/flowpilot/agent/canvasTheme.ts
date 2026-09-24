import { normalizeHex } from '@/lib/colorUtils';
import { selectActiveDesignSystem } from '@/store/selectors';
import type { FlowState } from '@/store/types';
import { describeEdgeStyle, describeNodeColor, edgePathName } from './canvasStyle';

// The page's look as get_canvas reports it, so the agent picks colors that fit what is already there.

const LIGHT_BACKGROUND = '#f8fafc';
const DARK_BACKGROUND = '#0a0a0a';
const MAX_LISTED_COLORS = 12;

export type CanvasAppearance = 'light' | 'dark';

/** Whether the app draws in its light or dark theme, as ThemeContext sets it on the document. */
export function canvasAppearance(): CanvasAppearance {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** The color behind the diagram: the brand background of the current theme. */
export function canvasBackground(appearance: CanvasAppearance = canvasAppearance()): string {
  const fallback = appearance === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--brand-background').trim();
  return normalizeHex(value) ?? fallback;
}

function tally<T>(items: readonly T[], keyOf: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups].sort((left, right) => right[1].length - left[1].length).slice(0, MAX_LISTED_COLORS);
}

/**
 * The page style: light or dark appearance, the active design system, the edge style new edges get and
 * the colors the page already uses, by node type, so additions can match their peers.
 */
export function describeCanvasStyle(state: FlowState): Record<string, unknown> {
  const appearance = canvasAppearance();
  const designSystem = selectActiveDesignSystem(state);
  const edgeOptions = state.globalEdgeOptions;
  const nodeColors = tally(
    state.nodes.filter((node) => !node.hidden),
    (node) => `${describeNodeColor(node.data) ?? 'default'}|${node.data.colorMode ?? 'subtle'}`
  ).map(([key, nodes]) => {
    const [color, colorMode] = key.split('|');
    return { color, colorMode, count: nodes.length, types: [...new Set(nodes.map((node) => node.type))] };
  });
  const edgeColors = tally(state.edges, (edge) => String(describeEdgeStyle(edge, true).color))
    .map(([color, edges]) => ({ color, count: edges.length }));

  return {
    appearance,
    canvasBackground: canvasBackground(appearance),
    designSystem: {
      name: designSystem?.name,
      fontFamily: designSystem?.typography.fontFamily,
      nodeCornerRadius: designSystem?.components.node.borderRadius,
      primary: designSystem?.colors.primary,
      accent: designSystem?.colors.accent,
      edgeColor: designSystem?.colors.edge,
    },
    edgeDefaults: {
      path: edgePathName({ type: edgeOptions.type }, edgeOptions.curve),
      width: edgeOptions.strokeWidth,
      animated: edgeOptions.animated,
      ...(edgeOptions.color ? { color: edgeOptions.color } : {}),
    },
    nodeColors,
    edgeColors,
  };
}
