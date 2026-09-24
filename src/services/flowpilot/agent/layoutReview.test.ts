import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { reviewLayout } from './layoutReview';

// Process nodes draw 120 x 60.
function node(id: string, x: number, y: number, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type: 'process',
    position: { x, y },
    data: { label: id.toUpperCase(), color: 'white', shape: 'rounded' },
    ...extra,
  };
}

function section(id: string, x: number, y: number, width: number, height: number): FlowNode {
  return { id, type: 'section', position: { x, y }, style: { width, height }, data: { label: id, color: 'blue' } };
}

function edge(source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id: `e-${source}-${target}`, source, target, ...extra };
}

describe('reviewLayout', () => {
  it('finds nothing wrong with a tidy row and reports its flow and bounds', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)],
      edges: [edge('a', 'b'), edge('b', 'c')],
    });
    expect(review).toEqual({
      flow: 'right',
      bounds: { x: 0, y: 0, width: 520, height: 60 },
      issues: [],
      issueCount: 0,
    });
  });

  it('reports overlapping nodes and nodes over a section they are not in', () => {
    const review = reviewLayout({
      nodes: [
        node('a', 0, 0),
        node('b', 100, 20),
        section('s', 0, 300, 400, 300),
        node('in', 40, 60, { parentId: 's' }),
        node('stray', 350, 400),
      ],
      edges: [],
    });
    expect(review.issues).toEqual([
      '"a" and "b" overlap by 20 px x 40 px.',
      '"stray" overlaps section "s" but is not in it; move it clear, or into the section with update_node parentId.',
    ]);
  });

  it('reports cramped nodes, and wants more room between connected ones', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('c', 0, 100), node('d', 0, 166), node('b', 150, 0)],
      edges: [edge('a', 'b')],
    });
    expect(review.issues).toEqual([
      '"a" and "b" are connected but only 30 px apart; leave at least 60 px so the edge shows.',
      '"c" and "d" are only 6 px apart.',
    ]);
  });

  it('wants room for edge labels between connected nodes', () => {
    const review = reviewLayout({
      nodes: [node('api', 0, 0), node('redis', 187, 0), node('db', 0, 200)],
      edges: [edge('api', 'redis', { label: 'cache' }), edge('api', 'db', { label: 'writes' })],
    });
    // "cache" draws about 51 px wide and needs 16 px either side; "writes" runs down, so only its height counts.
    expect(review.issues).toEqual([
      '"api" and "redis" are connected but only 67 px apart; leave at least 83 px so the edge and its label "cache" show.',
    ]);
  });

  it('wants room between a section and a node whose edge crosses into it', () => {
    const review = reviewLayout({
      nodes: [section('s', 0, 0, 800, 400), node('in', 40, 60, { parentId: 's' }), node('db', 817, 60)],
      edges: [edge('in', 'db')],
    });
    expect(review.issues).toEqual([
      '"db" is only 17 px from section "s", which its edge crosses; leave at least 60 px.',
    ]);
  });

  it('reports an edge running through another node', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)],
      edges: [edge('a', 'c')],
    });
    expect(review.issues).toEqual(['Edge "e-a-c" (a -> c) runs through "b".']);
  });

  it('reports an edge against the flow of the page', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0), node('e', 0, 200)],
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'e')],
    });
    expect(review.issues).toEqual([
      'Edge "e-c-e" (c -> e) runs right to left, against the page\'s left to right flow.',
    ]);
  });

  it('follows the route a layout stored for an edge instead of a straight line', () => {
    const around = [
      { x: 60, y: 60 },
      { x: 60, y: 120 },
      { x: 460, y: 120 },
      { x: 460, y: 60 },
    ];
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)];
    expect(
      reviewLayout({ nodes, edges: [edge('a', 'c', { data: { routingMode: 'elk', elkPoints: around } })] }).issues
    ).toEqual([]);
    // A route left behind by a node that moved away is stale, so the edge draws straight again.
    const stale = around.map((point) => ({ x: point.x + 900, y: point.y }));
    expect(
      reviewLayout({ nodes, edges: [edge('a', 'c', { data: { routingMode: 'elk', elkPoints: stale } })] }).issues
    ).toEqual(['Edge "e-a-c" (a -> c) runs through "b".']);
  });

  it('suggests lining up connected nodes that are slightly out of line', () => {
    const review = reviewLayout({ nodes: [node('a', 0, 0), node('b', 200, 12)], edges: [edge('a', 'b')] });
    expect(review.issues).toEqual([
      '"a" and "b" are 12 px out of line; for a straight edge, move "b" to y = 0 (or the other node to match).',
    ]);
    const column = reviewLayout(
      { nodes: [node('a', 0, 0), node('b', 20, 200)], edges: [edge('a', 'b')] },
      { focusIds: new Set(['a']) }
    );
    expect(column.issues).toEqual([
      '"a" and "b" are 20 px out of line; for a straight edge, move "a" to x = 20 (or the other node to match).',
    ]);
  });

  it('lines icon nodes up by their side handles, not their centres', () => {
    const icon = node('fn', 200, -12, {
      type: 'custom',
      data: { label: 'Function', assetPresentation: 'icon', archIconPackId: 'aws-official-starter-v1', archIconShapeId: 'compute-lambda' },
    });
    expect(reviewLayout({ nodes: [node('a', 0, 0), icon], edges: [edge('a', 'fn')] }).issues).toEqual([]);
  });

  it('says how to make room for a step that sits off the row of the steps around it', () => {
    const review = reviewLayout({
      nodes: [node('api', 0, 0), node('db', 200, 0), node('backup', 400, 0), node('cache', 100, 200)],
      edges: [edge('api', 'cache'), edge('cache', 'db'), edge('db', 'backup')],
    });
    // 60 px either side of the 120 px step, where 80 px are free.
    expect(review.issues).toEqual([
      '"cache" is a step between "api" and "db" but sits off their row; to make room, move "db", "backup" 160 px right, then move "cache" to x = 180, y = 0.',
    ]);
    const roomy = reviewLayout({
      nodes: [node('api', 0, 0), node('db', 600, 0), node('cache', 240, 200)],
      edges: [edge('api', 'cache'), edge('cache', 'db')],
    });
    expect(roomy.issues).toEqual([
      '"cache" is a step between "api" and "db" but sits off their row; move "cache" to x = 180, y = 0 to put it in line.',
    ]);
  });

  it('counts edge crossings', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('b', 300, 0), node('c', 0, 300), node('d', 300, 300)],
      edges: [edge('a', 'd'), edge('b', 'c')],
    });
    expect(review.issues).toEqual(['1 edge crossing: "e-a-d" x "e-b-c".']);
  });

  it('only reports issues around the given nodes, including ones parked far from their connections', () => {
    const graph = {
      nodes: [node('a', 0, 0), node('b', 0, 30), node('c', 2000, 0)],
      edges: [edge('a', 'c')],
    };
    expect(reviewLayout(graph, { focusIds: new Set(['c']) }).issues).toEqual([
      '"a" and "c" are connected but 1880 px apart.',
    ]);
    expect(reviewLayout(graph).issues).toEqual(['"a" and "b" overlap by 120 px x 30 px.']);
  });

  it('lists the most serious issues first and counts the rest', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => node(`n${index}`, index * 10, 0));
    const review = reviewLayout({ nodes, edges: [] });
    expect(review.issues).toHaveLength(12);
    expect(review.issueCount).toBe(28);
    expect(reviewLayout({ nodes, edges: [] }, { maxIssues: 3 }).issues).toHaveLength(3);
  });

  it('skips the edge checks on a canvas too large to compare every edge with every node', () => {
    const nodes = Array.from({ length: 1_500 }, (_, index) => node(`n${index}`, index * 200, 0));
    const edges = nodes.slice(1).map((target, index) => edge(nodes[index].id, target.id));
    const review = reviewLayout({ nodes, edges });
    expect(review.note).toBe('The canvas is too large to check edges; only node spacing was checked.');
    expect(reviewLayout({ nodes, edges }, { focusIds: new Set(['n0']) }).note).toBeUndefined();
  });

  it('ignores hidden nodes and edges', () => {
    const review = reviewLayout({
      nodes: [node('a', 0, 0), node('b', 10, 10, { hidden: true })],
      edges: [edge('a', 'b', { hidden: true })],
    });
    expect(review.issues).toEqual([]);
  });
});
