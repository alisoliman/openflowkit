import { describe, expect, it } from 'vitest';
import { buildEdgePath } from '@/components/custom-edge/pathUtils';
import { ICON_ASSET_SIDE_HANDLE_TOP, resolveNodeSize } from '@/components/nodeHelpers';
import { buildInsertedTemplateData } from '@/hooks/flow-editor-actions/helpers';
import { Position } from '@/lib/reactflowCompat';
import type { FlowNode } from '@/lib/types';
import { assignSmartHandles } from '@/services/smartEdgeRouting';
import { FLOW_TEMPLATES } from '@/services/templates';

type Point = { x: number; y: number };

function anchor(node: FlowNode, side: Position): Point {
  const { width, height } = resolveNodeSize(node);
  const sideY = node.data.assetPresentation === 'icon' ? ICON_ASSET_SIDE_HANDLE_TOP : height / 2;
  switch (side) {
    case Position.Top: return { x: node.position.x + width / 2, y: node.position.y };
    case Position.Bottom: return { x: node.position.x + width / 2, y: node.position.y + height };
    case Position.Left: return { x: node.position.x, y: node.position.y + sideY };
    case Position.Right: return { x: node.position.x + width, y: node.position.y + sideY };
  }
}

// Sample the actual renderer's rounded orthogonal path, including its corner arcs.
function samplePath(path: string): Point[] {
  const tokens = path.match(/[MLQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? [];
  const points: Point[] = [];
  let index = 0;
  let current = { x: 0, y: 0 };
  const readPoint = (): Point => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const command = tokens[index++];
    expect(['M', 'L', 'Q']).toContain(command);
    if (command === 'M') {
      current = readPoint();
      points.push(current);
      continue;
    }
    const control = readPoint();
    const end = command === 'Q' ? readPoint() : control;
    const steps = Math.max(24, Math.ceil(Math.hypot(end.x - current.x, end.y - current.y) / 4));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const before = 1 - t;
      points.push(command === 'Q' ? {
        x: before * before * current.x + 2 * before * t * control.x + t * t * end.x,
        y: before * before * current.y + 2 * before * t * control.y + t * t * end.y,
      } : {
        x: current.x + t * (end.x - current.x),
        y: current.y + t * (end.y - current.y),
      });
    }
    current = end;
  }
  return points;
}

function pointAtFraction(points: Point[], fraction: number): Point {
  const lengths = points.map((point, index) => index === 0 ? 0
    : Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  for (let index = 1; index < points.length; index += 1) {
    if (remaining <= lengths[index]) {
      const t = remaining / lengths[index];
      return {
        x: points[index - 1].x + t * (points[index].x - points[index - 1].x),
        y: points[index - 1].y + t * (points[index].y - points[index - 1].y),
      };
    }
    remaining -= lengths[index];
  }
  return points[points.length - 1];
}

describe('AWS SaaS template geometry', () => {
  it.each([false, true])('keeps paths and labels clear of unrelated assets after insertion: %s', (inserted) => {
    const template = FLOW_TEMPLATES.find((item) => item.id === 'aws-event-driven-saas-platform')!;
    const graph = inserted
      ? buildInsertedTemplateData(template, [{ id: 'existing', position: { x: 900, y: 600 }, data: { label: 'Existing diagram' }, width: 200, height: 100 }])
      : { newNodes: template.nodes, newEdges: template.edges };
    const nodes = graph.newNodes;
    const edges = assignSmartHandles(nodes, graph.newEdges);
    const labels: { label: string; x: number; y: number; width: number }[] = [];

    for (const edge of edges) {
      const source = nodes.find((node) => node.id === edge.source)!;
      const target = nodes.find((node) => node.id === edge.target)!;
      const sourceSide = edge.sourceHandle as Position;
      const targetSide = edge.targetHandle as Position;
      const from = anchor(source, sourceSide);
      const to = anchor(target, targetSide);
      const path = buildEdgePath({
        id: edge.id, source: edge.source, target: edge.target,
        sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y,
        sourcePosition: sourceSide, targetPosition: targetSide,
        sourceHandleId: edge.sourceHandle, targetHandleId: edge.targetHandle,
      }, edges, nodes, 'smoothstep', edge.data);
      const samples = samplePath(path.edgePath);
      const labelPoint = typeof edge.data?.labelPosition === 'number'
        ? pointAtFraction(samples, edge.data.labelPosition)
        : { x: path.labelX, y: path.labelY };
      const label = {
        label: String(edge.label),
        ...labelPoint,
        width: String(edge.label).length * 7 + 16,
      };
      labels.push(label);

      for (const node of nodes.filter((item) => item.id !== source.id && item.id !== target.id && item.data.assetPresentation === 'icon')) {
        const { width, height } = resolveNodeSize(node);
        const crosses = samples.some(({ x, y }) => x > node.position.x - 4 && x < node.position.x + width + 4
          && y > node.position.y - 4 && y < node.position.y + height + 4);
        expect(crosses, `${edge.label} crosses ${node.data.label}`).toBe(false);
        const labelOverlaps = label.x + label.width / 2 > node.position.x && label.x - label.width / 2 < node.position.x + width
          && label.y + 12 > node.position.y && label.y - 12 < node.position.y + height;
        expect(labelOverlaps, `${edge.label} label overlaps ${node.data.label}`).toBe(false);
      }
    }

    for (const [index, label] of labels.entries()) {
      for (const other of labels.slice(index + 1)) {
        const overlaps = Math.abs(label.x - other.x) < (label.width + other.width) / 2
          && Math.abs(label.y - other.y) < 24;
        expect(overlaps, `${label.label} overlaps ${other.label}`).toBe(false);
      }
    }
  });
});
