import type { FlowEdge, FlowNode, FlowTab } from '@/lib/types';
import type { FlowDocument } from '@/services/storage/flowDocumentModel';
import { resolveNodeSize as resolveCanvasNodeSize } from '@/components/nodeHelpers';

export interface WorkspaceDocumentPreviewNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: FlowNode['data']['shape'];
  label: string;
}

export interface WorkspaceDocumentPreview {
  nodes: WorkspaceDocumentPreviewNode[];
  edges: Array<{ id: string; source: string; target: string }>;
}

const PREVIEW_MAX_NODES = 18;
// Bound both extraction and rendering independently of full document size.
const PREVIEW_MAX_EDGES = 24;
const PREVIEW_NODE_SCAN_LIMIT = 256;
const PREVIEW_EDGE_SCAN_LIMIT = 512;
const previewCache = new WeakMap<
  FlowNode[],
  WeakMap<FlowEdge[], WorkspaceDocumentPreview | null>
>();
const PREVIEW_MIN_NODE_WIDTH = 48;
const PREVIEW_MIN_NODE_HEIGHT = 24;
const PREVIEW_MAX_NODE_WIDTH = 132;
const PREVIEW_MAX_NODE_HEIGHT = 72;

export interface WorkspaceDocumentSummary {
  id: string;
  name: string;
  updatedAt?: string;
  nodeCount: number;
  edgeCount: number;
  isActive: boolean;
  preview: WorkspaceDocumentPreview | null;
}

export interface CreateWorkspaceDocumentsParams {
  documents: FlowDocument[];
  activeDocumentId: string;
  activeNodes: FlowNode[];
  activeEdges: FlowEdge[];
  activePages: FlowTab[];
  activePageId: string;
}

function resolveWorkspaceDocument(
  document: FlowDocument,
  activeDocumentId: string,
  activeNodes: FlowNode[],
  activeEdges: FlowEdge[],
  activePages: FlowTab[],
  activePageId: string
): FlowDocument {
  const isActive = document.id === activeDocumentId;
  return isActive
    ? mergeActivePagesIntoDocuments({
        documents: [document],
        activeDocumentId: document.id,
        activePages,
        activePageId,
        activeNodes,
        activeEdges,
      })[0]
    : document;
}

function findActivePage(document: FlowDocument): FlowDocument['pages'][number] | undefined {
  return document.pages.find((page) => page.id === document.activePageId) ?? document.pages[0];
}

function haveSamePageContent(
  left: FlowDocument['pages'],
  right: FlowTab[],
  activePageId: string,
  activeNodes: FlowNode[],
  activeEdges: FlowEdge[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((page, index) => {
    const nextPage = right[index];
    if (!nextPage) {
      return false;
    }

    const expectedNodes = nextPage.id === activePageId ? activeNodes : nextPage.nodes;
    const expectedEdges = nextPage.id === activePageId ? activeEdges : nextPage.edges;

    return (
      page.id === nextPage.id &&
      page.name === nextPage.name &&
      page.diagramType === nextPage.diagramType &&
      page.updatedAt === nextPage.updatedAt &&
      page.playback === nextPage.playback &&
      page.history === nextPage.history &&
      page.nodes === expectedNodes &&
      page.edges === expectedEdges
    );
  });
}

export function syncActivePageTabs(
  pages: FlowTab[],
  activePageId: string,
  activeNodes: FlowNode[],
  activeEdges: FlowEdge[]
): FlowTab[] {
  return pages.map((page) =>
    page.id === activePageId
      ? {
          ...page,
          nodes: activeNodes,
          edges: activeEdges,
        }
      : page
  );
}

export function mergeActivePagesIntoDocuments(params: {
  documents: FlowDocument[];
  activeDocumentId: string;
  activePages: FlowTab[];
  activePageId: string;
  activeNodes: FlowNode[];
  activeEdges: FlowEdge[];
}): FlowDocument[] {
  const { documents, activeDocumentId, activePages, activePageId, activeNodes, activeEdges } =
    params;
  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  if (!activeDocument) {
    return documents;
  }

  if (
    activeDocument.activePageId === activePageId &&
    haveSamePageContent(activeDocument.pages, activePages, activePageId, activeNodes, activeEdges)
  ) {
    return documents;
  }

  const syncedPages = syncActivePageTabs(activePages, activePageId, activeNodes, activeEdges);

  return documents.map((document) => {
    if (document.id !== activeDocumentId) {
      return document;
    }

    return {
      ...document,
      activePageId,
      pages: syncedPages.map((page) => ({
        id: page.id,
        name: page.name,
        diagramType: page.diagramType,
        updatedAt: page.updatedAt,
        nodes: page.nodes,
        edges: page.edges,
        playback: page.playback,
        history: page.history,
      })),
    };
  });
}

export function createWorkspaceDocumentSummary(
  document: FlowDocument,
  activeDocumentId: string,
  activeNodes: FlowNode[],
  activeEdges: FlowEdge[],
  activePages: FlowTab[],
  activePageId: string
): WorkspaceDocumentSummary {
  const isActive = document.id === activeDocumentId;
  const resolvedDocument = resolveWorkspaceDocument(
    document,
    activeDocumentId,
    activeNodes,
    activeEdges,
    activePages,
    activePageId
  );
  const nodeCount = resolvedDocument.pages.reduce((sum, page) => sum + page.nodes.length, 0);
  const edgeCount = resolvedDocument.pages.reduce((sum, page) => sum + page.edges.length, 0);

  return {
    id: resolvedDocument.id,
    name: resolvedDocument.name,
    updatedAt: resolvedDocument.updatedAt,
    nodeCount,
    edgeCount,
    isActive,
    preview: null,
  };
}

export function sortWorkspaceDocuments(
  documents: WorkspaceDocumentSummary[]
): WorkspaceDocumentSummary[] {
  return [...documents].sort((left, right) => {
    if (left.isActive && !right.isActive) return -1;
    if (!left.isActive && right.isActive) return 1;
    const leftTime = Date.parse(left.updatedAt || '');
    const rightTime = Date.parse(right.updatedAt || '');
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

export function createWorkspaceDocumentsFromTabs({
  documents,
  activeDocumentId,
  activeNodes,
  activeEdges,
  activePages,
  activePageId,
}: CreateWorkspaceDocumentsParams): WorkspaceDocumentSummary[] {
  const documentMap = new Map(documents.map((document) => [document.id, document] as const));
  const sortedSummaries = sortWorkspaceDocuments(
    documents.map((document) =>
      createWorkspaceDocumentSummary(
        document,
        activeDocumentId,
        activeNodes,
        activeEdges,
        activePages,
        activePageId
      )
    )
  );

  return sortedSummaries.map((summary) => {
    const sourceDocument = documentMap.get(summary.id);
    if (!sourceDocument) {
      return summary;
    }

    const resolvedDocument = resolveWorkspaceDocument(
      sourceDocument,
      activeDocumentId,
      activeNodes,
      activeEdges,
      activePages,
      activePageId
    );
    const activePage = findActivePage(resolvedDocument);

    return {
      ...summary,
      preview: activePage
        ? createWorkspaceDocumentPreview(activePage.nodes, activePage.edges)
        : null,
    };
  });
}

export function findDocumentRouteTarget(
  documents: FlowDocument[],
  targetId: string
): {
  documentId: string;
  pageId: string;
} | null {
  for (const document of documents) {
    if (document.id === targetId) {
      return {
        documentId: document.id,
        pageId: document.activePageId,
      };
    }

    const matchingPage = document.pages.find((page) => page.id === targetId);
    if (matchingPage) {
      return {
        documentId: document.id,
        pageId: matchingPage.id,
      };
    }
  }

  return null;
}

function resolveNodeSize(node: FlowNode): { width: number; height: number } {
  return resolveCanvasNodeSize(node);
}

function isPreviewContainerNode(node: FlowNode): boolean {
  return node.type === 'swimlane' || node.type === 'group' || node.type === 'section';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createWorkspaceDocumentPreview(
  nodes: FlowNode[],
  edges: FlowEdge[]
): WorkspaceDocumentPreview | null {
  const cachedByEdges = previewCache.get(nodes);
  if (cachedByEdges?.has(edges)) return cachedByEdges.get(edges) ?? null;

  const preview = extractWorkspaceDocumentPreview(nodes, edges);
  const nextCache = cachedByEdges ?? new WeakMap<FlowEdge[], WorkspaceDocumentPreview | null>();
  nextCache.set(edges, preview);
  if (!cachedByEdges) previewCache.set(nodes, nextCache);
  return preview;
}

function extractWorkspaceDocumentPreview(
  nodes: FlowNode[],
  edges: FlowEdge[]
): WorkspaceDocumentPreview | null {
  const sampledNodes = nodes.slice(0, PREVIEW_NODE_SCAN_LIMIT);
  const nodeIndex = new Map(sampledNodes.map((node) => [node.id, node]));
  const previewNodes: WorkspaceDocumentPreviewNode[] = [];

  for (const node of sampledNodes) {
    if (node.hidden || isPreviewContainerNode(node)) continue;
    const position = resolvePreviewPosition(node, nodeIndex);
    if (!position) continue;
    const size = resolveNodeSize(node);
    const rawLabel = typeof node.data?.label === 'string' ? node.data.label : '';
    const label = rawLabel
      .slice(0, 160)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    previewNodes.push({
      id: node.id,
      x: position.x,
      y: position.y,
      width: clamp(
        Number.isFinite(size.width) ? size.width : 120,
        PREVIEW_MIN_NODE_WIDTH,
        PREVIEW_MAX_NODE_WIDTH
      ),
      height: clamp(
        Number.isFinite(size.height) ? size.height : 60,
        PREVIEW_MIN_NODE_HEIGHT,
        PREVIEW_MAX_NODE_HEIGHT
      ),
      shape:
        node.data?.shape ??
        (node.type === 'decision'
          ? 'diamond'
          : node.type === 'start' || node.type === 'end'
            ? 'capsule'
            : 'rounded'),
      label: label.length > 24 ? `${label.slice(0, 23)}…` : label,
    });
    if (previewNodes.length === PREVIEW_MAX_NODES) break;
  }

  if (previewNodes.length === 0) return null;
  const nodeIds = new Set(previewNodes.map((node) => node.id));
  const previewEdges: WorkspaceDocumentPreview['edges'] = [];
  for (const edge of edges.slice(0, PREVIEW_EDGE_SCAN_LIMIT)) {
    if (edge.hidden || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    previewEdges.push({ id: edge.id, source: edge.source, target: edge.target });
    if (previewEdges.length === PREVIEW_MAX_EDGES) break;
  }
  return { nodes: previewNodes, edges: previewEdges };
}

function resolvePreviewPosition(
  node: FlowNode,
  nodeIndex: Map<string, FlowNode>
): { x: number; y: number } | null {
  let x = node.position?.x;
  let y = node.position?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId) {
    if (visited.has(parentId) || visited.size > 16) return null;
    visited.add(parentId);
    const parent = nodeIndex.get(parentId);
    if (!parent || !Number.isFinite(parent.position?.x) || !Number.isFinite(parent.position?.y))
      return null;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function getEditorPagesForDocument(
  documents: FlowDocument[],
  documentId: string | null
): {
  activeDocumentId: string;
  activePageId: string;
  pages: FlowTab[];
} | null {
  if (!documentId) {
    return null;
  }

  const document = documents.find((entry) => entry.id === documentId);
  if (!document || document.pages.length === 0) {
    return null;
  }

  return {
    activeDocumentId: document.id,
    activePageId: document.activePageId,
    pages: document.pages.map((page) => ({
      id: page.id,
      name: page.name,
      diagramType: page.diagramType,
      updatedAt: page.updatedAt,
      nodes: page.nodes,
      edges: page.edges,
      playback: page.playback,
      history: page.history,
    })),
  };
}
