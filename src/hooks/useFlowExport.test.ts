import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import { useFlowStore } from '@/store';
import { toJpeg } from 'html-to-image';
import { createDownload } from './flow-export/exportCapture';
import { buildDiagramDocumentJson, importDiagramDocumentJson } from './flow-export/diagramDocumentTransfer';
import { useFlowExport } from './useFlowExport';

const { addToast, fitView } = vi.hoisted(() => ({ addToast: vi.fn(), fitView: vi.fn() }));

vi.mock('html-to-image', () => ({ toJpeg: vi.fn(), toPng: vi.fn(), toSvg: vi.fn() }));
vi.mock('./flow-export/exportCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./flow-export/exportCapture')>()),
  createDownload: vi.fn(),
}));
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


afterEach(() => { vi.useRealTimers(); });

describe('useFlowExport completion', () => {
  it('awaits PDF capture and releases export styles only when the download is ready', async () => {
    vi.useFakeTimers();
    let completeCapture!: (url: string) => void;
    vi.mocked(toJpeg).mockReturnValue(new Promise((resolve) => { completeCapture = resolve; }));
    const canvas = document.createElement('div');
    canvas.innerHTML = '<div class="react-flow__viewport"></div>';
    const { result } = renderHook(() => useFlowExport(vi.fn(), { current: canvas }, { stopPlayback: vi.fn() }));
    let finished = false;
    const exportPromise = result.current.handlePdfExport().then((outcome) => { finished = true; return outcome; });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(finished).toBe(false);
    expect(canvas).toHaveClass('exporting');
    expect(createDownload).not.toHaveBeenCalled();
    completeCapture('data:image/jpeg;base64,YQ==');
    expect(await exportPromise).toEqual({ status: 'success' });
    expect(createDownload).toHaveBeenCalledOnce();
    expect(canvas).not.toHaveClass('exporting');
  });

  it('reports JSON serialization failure as a handled result for download and copy', async () => {
    vi.mocked(buildDiagramDocumentJson).mockRejectedValue(new Error('Invalid document'));
    const { result } = renderHook(() => useFlowExport(vi.fn(), { current: null }, { stopPlayback: vi.fn() }));
    expect(await result.current.handleExportJSON()).toEqual({ status: 'error', message: 'Failed to export JSON. Please try again.' });
    expect(await result.current.handleCopyJSON()).toEqual({ status: 'error', message: 'Failed to copy JSON. Please try again.' });
    expect(createDownload).not.toHaveBeenCalled();
  });
});
