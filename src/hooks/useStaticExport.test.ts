import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPng } from 'html-to-image';
import { useExportMenu } from '@/components/useExportMenu';
import { copyDataUrlToClipboard } from './flow-export/exportCapture';
import { useStaticExport } from './useStaticExport';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('html-to-image', () => ({ toPng: vi.fn(), toJpeg: vi.fn(), toSvg: vi.fn() }));
vi.mock('@/components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('./flow-export/exportCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./flow-export/exportCapture')>()),
  copyDataUrlToClipboard: vi.fn(),
}));

function setup() {
  const root = document.createElement('div');
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  const ref = { current: root };
  const hook = renderHook(() => {
    const actions = useStaticExport([], ref, addToast, 'Service map');
    const menu = useExportMenu({
      onExportPNG: actions.handleExport,
      onCopyImage: actions.handleCopyImage,
      onExportSVG: actions.handleSvgExport,
      onCopySVG: actions.handleCopySvg,
      onExportPDF: vi.fn(),
      onExportCinematic: vi.fn(),
      getCinematicExportRequest: () => ({ format: 'cinematic-video', speed: 'normal', resolution: '1080p', themeMode: 'light' }),
      onExportJSON: vi.fn(), onCopyJSON: vi.fn(), onExportMermaid: vi.fn(), onDownloadMermaid: vi.fn(),
      onDownloadPlantUML: vi.fn(), onExportOpenFlowDSL: vi.fn(), onDownloadOpenFlowDSL: vi.fn(),
      onExportFigma: vi.fn(), onDownloadFigma: vi.fn(),
    });
    return { ...actions, menu };
  });
  return { ...hook, root };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('static export completion', () => {
  it('keeps the real menu pending through canvas preparation and image capture', async () => {
    let completeCapture!: (url: string) => void;
    vi.mocked(toPng).mockReturnValue(new Promise((resolve) => { completeCapture = resolve; }));
    const { result, root } = setup();
    act(() => result.current.menu.toggleMenu());
    act(() => { void result.current.menu.handleSelect('png', 'download'); });
    expect(result.current.menu.pendingAction).toEqual({ key: 'png', action: 'download' });
    expect(root).toHaveClass('exporting');
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(toPng).toHaveBeenCalledOnce();
    expect(result.current.menu.isOpen).toBe(true);
    expect(result.current.menu.pendingAction).not.toBeNull();
    act(() => { void result.current.menu.handleSelect('png', 'download'); });
    expect(toPng).toHaveBeenCalledOnce();
    await act(async () => completeCapture('data:image/png;base64,test'));
    expect(result.current.menu.pendingAction).toBeNull();
    expect(result.current.menu.isOpen).toBe(false);
    expect(root).not.toHaveClass('exporting');
  });

  it('waits for the clipboard write after capture before completing a copy', async () => {
    let completeCopy!: () => void;
    vi.mocked(toPng).mockResolvedValue('data:image/png;base64,test');
    vi.mocked(copyDataUrlToClipboard).mockReturnValue(new Promise((resolve) => { completeCopy = resolve; }));
    const { result, root } = setup();
    act(() => { void result.current.menu.handleSelect('png', 'copy'); });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(copyDataUrlToClipboard).toHaveBeenCalledWith('data:image/png;base64,test');
    expect(result.current.menu.pendingAction).not.toBeNull();
    expect(root).toHaveClass('exporting');
    await act(async () => completeCopy());
    expect(result.current.menu.pendingAction).toBeNull();
    expect(root).not.toHaveClass('exporting');
  });

  it('retains failed export settings, restores the canvas, and reports the error once', async () => {
    vi.mocked(toPng).mockRejectedValue(new Error('Capture failed'));
    const { result, root } = setup();
    act(() => result.current.menu.toggleMenu());
    act(() => { void result.current.menu.handleSelect('png', 'download'); });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(result.current.menu.isOpen).toBe(true);
    expect(result.current.menu.pendingAction).toBeNull();
    expect(result.current.menu.errorMessage).toBe('Failed to export. Please try again.');
    expect(root).not.toHaveClass('exporting');
    expect(addToast.mock.calls.filter((call) => call[1] === 'error')).toHaveLength(1);
  });
});
