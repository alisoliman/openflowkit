import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import { useFlowStore } from '@/store';
import { importDiagramDocumentJson } from './flow-export/diagramDocumentTransfer';
import { useFlowExport } from './useFlowExport';

const { addToast, fitView } = vi.hoisted(() => ({ addToast: vi.fn(), fitView: vi.fn() }));

vi.mock('./flow-export/diagramDocumentTransfer', () => ({
  buildDiagramDocumentJson: vi.fn(),
  importDiagramDocumentJson: vi.fn(),
}));
vi.mock('../components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({ fitView }),
}));

type ImportResult = Awaited<ReturnType<typeof importDiagramDocumentJson>>;

function node(id: string): FlowNode {
  return { id, type: 'process', position: { x: 0, y: 0 }, data: { label: id } };
}

const existing = [node('existing')];

beforeEach(() => {
  vi.clearAllMocks();
  useFlowStore.setState({ nodes: existing, edges: [], agentTurn: null });
});

async function importWhile(duringLayout: () => void) {
  let finish!: (result: ImportResult) => void;
  vi.mocked(importDiagramDocumentJson).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const recordHistory = vi.fn();
  const { result } = renderHook(() => useFlowExport(recordHistory, { current: null }, { stopPlayback: vi.fn() }));
  const file = new File(['{}'], 'diagram.json', { type: 'application/json' });
  act(() => result.current.onFileImport({ target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>));
  await vi.waitFor(() => expect(importDiagramDocumentJson).toHaveBeenCalledOnce());

  duringLayout();
  await act(async () => finish({
    ok: true,
    nodes: [node('imported')],
    edges: [],
    diagramType: undefined,
    playback: undefined,
    warnings: [],
    report: {} as ImportResult['report'],
    outcome: { status: 'success', summary: 'Imported.' },
  }));
  return recordHistory;
}

describe('useFlowExport JSON import', () => {
  it('applies the imported document once it is laid out', async () => {
    const recordHistory = await importWhile(() => undefined);
    expect(recordHistory).toHaveBeenCalledOnce();
    expect(useFlowStore.getState().nodes.map((candidate) => candidate.id)).toEqual(['imported']);
  });

  it('drops an import whose layout finishes after a Flowpilot turn took the page', async () => {
    const recordHistory = await importWhile(() => useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' }));
    expect(addToast).toHaveBeenCalledWith('Flowpilot is editing this page. Try again after it finishes.', 'warning');
    expect(recordHistory).not.toHaveBeenCalled();
    expect(useFlowStore.getState().nodes).toBe(existing);
  });
});
