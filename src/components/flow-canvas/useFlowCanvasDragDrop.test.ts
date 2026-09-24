import type React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestUserMediaFile } from '@/services/storage/assetStore';
import { useFlowStore } from '@/store';
import { useFlowCanvasDragDrop } from './useFlowCanvasDragDrop';

vi.mock('@/services/storage/assetStore', () => ({ ingestUserMediaFile: vi.fn() }));
vi.mock('@/services/storage/storageTelemetry', () => ({ reportStorageTelemetry: vi.fn() }));

function imageDrop(): React.DragEvent {
  const file = new File(['png'], 'diagram.png', { type: 'image/png' });
  return { preventDefault: vi.fn(), clientX: 40, clientY: 60, dataTransfer: { files: [file] } } as unknown as React.DragEvent;
}

function setup() {
  const handleAddImage = vi.fn();
  const onImageDropError = vi.fn();
  const { result } = renderHook(() => useFlowCanvasDragDrop({
    screenToFlowPosition: (position) => position,
    handleAddImage,
    onImageDropError,
  }));
  return { drop: result.current.onDrop, handleAddImage, onImageDropError };
}

beforeEach(() => {
  vi.resetAllMocks();
  useFlowStore.setState({ agentTurn: null });
});

describe('useFlowCanvasDragDrop', () => {
  it('adds a dropped image where it was dropped', async () => {
    vi.mocked(ingestUserMediaFile).mockResolvedValue({ assetId: 'asset-1', displayUrl: 'blob:1' } as never);
    const { drop, handleAddImage } = setup();

    await act(async () => { drop(imageDrop()); });

    expect(handleAddImage).toHaveBeenCalledWith('', { x: 40, y: 60 }, 'asset-1');
  });

  it('does not add an image whose upload finishes after a Flowpilot turn started', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(ingestUserMediaFile).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    const { drop, handleAddImage, onImageDropError } = setup();

    drop(imageDrop());
    useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'page-1' });
    await act(async () => { finish({ assetId: 'asset-1', displayUrl: 'blob:1' }); });

    expect(handleAddImage).not.toHaveBeenCalled();
    expect(onImageDropError).toHaveBeenCalledWith('Flowpilot is editing this page. Drop the image again after it finishes.');
  });
});
