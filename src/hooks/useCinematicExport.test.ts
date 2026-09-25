import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForExportRender } from './flow-export/exportCapture';
import { useCinematicExport } from './useCinematicExport';

vi.mock('./flow-export/exportCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./flow-export/exportCapture')>()),
  waitForExportRender: vi.fn(),
}));

const request = { format: 'cinematic-video', speed: 'normal', resolution: '1080p', themeMode: 'light' } as const;

function setup() {
  const canvas = document.createElement('div');
  canvas.innerHTML = '<div class="react-flow__viewport"></div>';
  const addToast = vi.fn();
  const { result } = renderHook(() => useCinematicExport({
    nodes: [{ id: 'one', type: 'process', position: { x: 0, y: 0 }, data: { label: 'Start' }, width: 160, height: 80 }],
    edges: [],
    reactFlowWrapper: { current: canvas },
    animatedPlayback: { stopPlayback: vi.fn() },
    addToast,
    exportBaseName: 'Service map',
  }));
  return { result, canvas, addToast };
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('cinematic export outcomes', () => {
  it('returns cancellation separately from success and clears capture styles', async () => {
    vi.mocked(waitForExportRender).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const { result, canvas, addToast } = setup();
    expect(await result.current.handleCinematicExport(request)).toEqual({ status: 'cancelled' });
    expect(canvas).not.toHaveClass('exporting');
    expect(addToast).toHaveBeenCalledWith('Cinematic export cancelled.', 'info');
  });

  it('returns a handled rendering failure so the menu can retain export settings', async () => {
    vi.mocked(waitForExportRender).mockRejectedValue(new Error('Frame capture is unavailable'));
    const { result, canvas, addToast } = setup();
    expect(await result.current.handleCinematicExport(request)).toEqual({ status: 'error', message: 'Frame capture is unavailable' });
    expect(canvas).not.toHaveClass('exporting');
    expect(addToast).toHaveBeenCalledWith('Frame capture is unavailable', 'error');
  });
});
