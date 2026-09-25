import React, { useId } from 'react';
import type {
  WorkspaceDocumentPreview,
  WorkspaceDocumentPreviewNode,
} from '@/store/workspaceDocumentModel';

/** A bounded SVG snapshot; it never mounts a second editor or subscribes to canvas state. */
export const WorkspaceDiagramPreview = React.memo(function WorkspaceDiagramPreview({
  preview,
}: {
  preview: WorkspaceDocumentPreview;
}): React.ReactElement {
  const arrowId = useId();
  const padding = 28;
  const minX = Math.min(...preview.nodes.map((node) => node.x));
  const minY = Math.min(...preview.nodes.map((node) => node.y));
  const maxX = Math.max(...preview.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...preview.nodes.map((node) => node.y + node.height));
  const nodeIndex = new Map(preview.nodes.map((node) => [node.id, node]));
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(maxX - minX, 1) + padding * 2} ${Math.max(maxY - minY, 1) + padding * 2}`;

  return (
    <div
      className="absolute inset-0 overflow-hidden text-[var(--brand-secondary)]"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--brand-secondary) 1px, transparent 0)',
          backgroundSize: '14px 14px',
        }}
      />
      <svg
        viewBox={viewBox}
        className="absolute inset-[8%] h-[84%] w-[84%]"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={arrowId}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 Z" fill="currentColor" />
          </marker>
        </defs>
        <g fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.65">
          {preview.edges.map((edge) => {
            const source = nodeIndex.get(edge.source);
            const target = nodeIndex.get(edge.target);
            if (!source || !target) return null;
            return (
              <path
                key={edge.id}
                d={previewEdgePath(source, target)}
                markerEnd={`url(#${arrowId})`}
              />
            );
          })}
        </g>
        {preview.nodes.map((node) => (
          <PreviewNode key={node.id} node={node} />
        ))}
      </svg>
    </div>
  );
});

function PreviewNode({ node }: { node: WorkspaceDocumentPreviewNode }): React.ReactElement {
  const { x, y, width, height, shape } = node;
  const style = {
    fill: 'var(--brand-surface)',
    stroke: 'var(--brand-secondary)',
    strokeOpacity: 0.5,
    strokeWidth: 1.5,
  };
  const maxCharacters = Math.max(
    4,
    Math.floor((width * (shape === 'diamond' ? 0.55 : 0.82)) / 5.6)
  );
  const label =
    node.label.length > maxCharacters ? `${node.label.slice(0, maxCharacters - 1)}…` : node.label;
  let outline: React.ReactNode;
  if (shape === 'diamond') {
    outline = (
      <polygon
        points={`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`}
        {...style}
      />
    );
  } else if (shape === 'circle' || shape === 'ellipse') {
    outline = (
      <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...style} />
    );
  } else if (shape === 'cylinder') {
    outline = (
      <>
        <path
          d={`M ${x} ${y + 8} C ${x} ${y - 3}, ${x + width} ${y - 3}, ${x + width} ${y + 8} L ${x + width} ${y + height - 8} C ${x + width} ${y + height + 3}, ${x} ${y + height + 3}, ${x} ${y + height - 8} Z`}
          {...style}
        />
        <path
          d={`M ${x} ${y + 8} C ${x} ${y + 19}, ${x + width} ${y + 19}, ${x + width} ${y + 8}`}
          fill="none"
          stroke="var(--brand-secondary)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
      </>
    );
  } else {
    outline = (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={shape === 'capsule' ? height / 2 : shape === 'rectangle' ? 3 : 8}
        {...style}
      />
    );
  }
  return (
    <g>
      {outline}
      {label && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fontWeight="500"
          fill="var(--brand-text)"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function previewEdgePath(
  source: WorkspaceDocumentPreviewNode,
  target: WorkspaceDocumentPreviewNode
): string {
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  if (source.id === target.id) {
    const right = source.x + source.width;
    return `M ${right} ${sy - 8} C ${right + 28} ${sy - 28}, ${right + 28} ${sy + 28}, ${right} ${sy + 8}`;
  }
  if (Math.abs(tx - sx) >= Math.abs(ty - sy)) {
    const direction = tx >= sx ? 1 : -1;
    const start = sx + (direction * source.width) / 2;
    const end = tx - (direction * target.width) / 2;
    const middle = (start + end) / 2;
    return `M ${start} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${end} ${ty}`;
  }
  const direction = ty >= sy ? 1 : -1;
  const start = sy + (direction * source.height) / 2;
  const end = ty - (direction * target.height) / 2;
  const middle = (start + end) / 2;
  return `M ${sx} ${start} C ${sx} ${middle}, ${tx} ${middle}, ${tx} ${end}`;
}
