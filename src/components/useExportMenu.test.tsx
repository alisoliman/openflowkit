import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CinematicExportRequest } from '@/services/export/cinematicExport';
import { useExportMenu } from './useExportMenu';

const addToast = vi.fn();
const cinematicRequest: CinematicExportRequest = {
  format: 'cinematic-video',
  speed: 'normal',
  resolution: '1080p',
  themeMode: 'light',
};

vi.mock('./ui/ToastContext', () => ({
  useToast: () => ({
    addToast,
  }),
}));

const baseProps = {
  onExportPNG: vi.fn(),
  onCopyImage: vi.fn(),
  onExportSVG: vi.fn(),
  onCopySVG: vi.fn(),
  onExportPDF: vi.fn(),
  onExportCinematic: vi.fn(),
  getCinematicExportRequest: vi.fn(() => cinematicRequest),
  onExportJSON: vi.fn(),
  onCopyJSON: vi.fn(),
  onExportMermaid: vi.fn(),
  onDownloadMermaid: vi.fn(),
  onDownloadPlantUML: vi.fn(),
  onExportOpenFlowDSL: vi.fn(),
  onDownloadOpenFlowDSL: vi.fn(),
  onExportFigma: vi.fn(),
  onDownloadFigma: vi.fn(),
};

function Harness(): React.ReactElement {
  const { isOpen, pendingAction, errorMessage, triggerRef, menuRef, toggleMenu, handleSelect } = useExportMenu(baseProps);

  return (
    <div>
      <div ref={menuRef}>
        <button type="button" ref={triggerRef} onClick={toggleMenu}>
          Toggle export
        </button>
        <button type="button" onClick={() => void handleSelect('figma', 'copy')}>
          Run export
        </button>
        {isOpen ? <div data-testid="export-menu-open">Export menu</div> : null}
      </div>
      {pendingAction && <div role="status">Preparing</div>}
      {errorMessage && <div role="alert">{errorMessage}</div>}
      <button type="button">Outside target</button>
    </div>
  );
}

describe('useExportMenu', () => {
  beforeEach(() => {
    addToast.mockReset();
    Object.values(baseProps).forEach((handler) => {
      if (typeof handler === 'function' && 'mockReset' in handler) {
        handler.mockReset();
      }
    });
  });

  it('closes when clicking outside the menu', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle export' }));
    expect(screen.getByTestId('export-menu-open')).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside target' }));

    expect(screen.queryByTestId('export-menu-open')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle export' }));
    expect(screen.getByTestId('export-menu-open')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('export-menu-open')).toBeNull();
  });

  it('shows toast feedback when an export action rejects', async () => {
    baseProps.onExportFigma.mockRejectedValueOnce(new Error('copy failed'));
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Run export' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'Failed to complete figma copy: copy failed',
        'error',
        5000
      );
    });
  });

  it('waits for completion and suppresses duplicate actions while an export is in flight', async () => {
    let finish!: () => void;
    baseProps.onExportFigma.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run export' }));
    expect(baseProps.onExportFigma).toHaveBeenCalledOnce();
    expect(screen.getByTestId('export-menu-open')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing');
    await act(async () => finish());
    expect(screen.queryByTestId('export-menu-open')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('retains the menu for a handled failure without duplicating its toast', async () => {
    baseProps.onExportFigma.mockResolvedValueOnce({ status: 'error', message: 'Clipboard unavailable' });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard unavailable');
    expect(screen.getByTestId('export-menu-open')).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });


  it('restores the trigger after success and preserves outside focus when dismissed during export', async () => {
    let finish!: () => void;
    baseProps.onExportFigma.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Toggle export' });
    fireEvent.click(trigger);
    const run = screen.getByRole('button', { name: 'Run export' });
    run.focus();
    fireEvent.click(run);
    await act(async () => finish());
    expect(trigger).toHaveFocus();

    baseProps.onExportFigma.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(trigger);
    run.focus();
    fireEvent.click(run);
    const outside = screen.getByRole('button', { name: 'Outside target' });
    act(() => outside.focus());
    expect(screen.queryByTestId('export-menu-open')).toBeNull();
    await act(async () => finish());
    expect(outside).toHaveFocus();
  });

});
