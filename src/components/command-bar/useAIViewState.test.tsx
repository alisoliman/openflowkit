import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAIViewState } from './useAIViewState';

function createHook(onAIGenerate: (prompt: string, imageBase64?: string) => Promise<boolean>) {
  return renderHook(() =>
    useAIViewState({
      searchQuery: '',
      isGenerating: false,
      onAIGenerate,
      onClose: vi.fn(),
      scrollKey: 0,
    })
  );
}

describe('useAIViewState', () => {
  it('clears the submitted text and image before generation finishes', async () => {
    let finish!: (value: boolean) => void;
    const generate = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const hook = createHook(generate);
    act(() => {
      hook.result.current.setPrompt('Plan an authentication diagram');
      hook.result.current.setSelectedImage('data:image/png;base64,original');
    });

    let request!: Promise<void>;
    act(() => { request = hook.result.current.handleGenerate(); });

    expect(generate).toHaveBeenCalledWith('Plan an authentication diagram', 'data:image/png;base64,original');
    expect(hook.result.current.prompt).toBe('');
    expect(hook.result.current.selectedImage).toBeNull();
    await act(async () => { finish(true); await request; });
  });

  it.each([true, false])('preserves a newer text/image draft when generation finishes with %s', async (success) => {
    let finish!: (value: boolean) => void;
    const hook = createHook(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    act(() => hook.result.current.setPrompt('First request'));
    let request!: Promise<void>;
    act(() => { request = hook.result.current.handleGenerate(); });
    act(() => {
      hook.result.current.setPrompt('My next request');
      hook.result.current.setSelectedImage('data:image/png;base64,next');
    });
    await act(async () => { finish(success); await request; });
    expect(hook.result.current.prompt).toBe('My next request');
    expect(hook.result.current.selectedImage).toBe('data:image/png;base64,next');
  });

  it('restores an untouched submission, including its image, when generation fails or is cancelled', async () => {
    let finish!: (value: boolean) => void;
    const hook = createHook(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    act(() => {
      hook.result.current.setPrompt('Add Redis');
      hook.result.current.setSelectedImage('data:image/png;base64,original');
    });
    let request!: Promise<void>;
    act(() => { request = hook.result.current.handleGenerate(); });
    expect(hook.result.current.prompt).toBe('');
    await act(async () => { finish(false); await request; });
    expect(hook.result.current.prompt).toBe('Add Redis');
    expect(hook.result.current.selectedImage).toBe('data:image/png;base64,original');
  });

  it('does not restore over a draft the user intentionally cleared', async () => {
    let finish!: (value: boolean) => void;
    const hook = createHook(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    act(() => hook.result.current.setPrompt('First request'));
    let request!: Promise<void>;
    act(() => { request = hook.result.current.handleGenerate(); });
    act(() => {
      hook.result.current.setPrompt('Unsent draft');
      hook.result.current.setPrompt('');
    });
    await act(async () => { finish(false); await request; });
    expect(hook.result.current.prompt).toBe('');
  });

  it('prevents a second submission while the first promise is still pending', async () => {
    let finish!: (value: boolean) => void;
    const generate = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const hook = createHook(generate);
    act(() => hook.result.current.setPrompt('First request'));
    let request!: Promise<void>;
    act(() => { request = hook.result.current.handleGenerate(); });
    act(() => hook.result.current.setPrompt('Next request'));
    await act(async () => { await hook.result.current.handleGenerate(); });
    expect(generate).toHaveBeenCalledOnce();
    expect(hook.result.current.prompt).toBe('Next request');
    await act(async () => { finish(true); await request; });
  });

  it('restores the submission if generation unexpectedly rejects, without swallowing the error', async () => {
    const hook = createHook(vi.fn().mockRejectedValue(new Error('Request failed')));
    act(() => hook.result.current.setPrompt('Add Redis'));
    await act(async () => {
      await expect(hook.result.current.handleGenerate()).rejects.toThrow('Request failed');
    });
    expect(hook.result.current.prompt).toBe('Add Redis');
  });

  it('clears prompt after a successful generation', async () => {
    const onAIGenerate = vi.fn().mockResolvedValue(true);
    const hook = createHook(onAIGenerate);

    act(() => {
      hook.result.current.setPrompt('Add Redis');
    });

    await act(async () => {
      await hook.result.current.handleGenerate();
    });

    expect(onAIGenerate).toHaveBeenCalledWith('Add Redis', undefined);
    expect(hook.result.current.prompt).toBe('');
  });

  it('keeps the prompt when generation is rejected by preflight or request failure', async () => {
    const onAIGenerate = vi.fn().mockResolvedValue(false);
    const hook = createHook(onAIGenerate);

    act(() => {
      hook.result.current.setPrompt('Add Redis');
    });

    await act(async () => {
      await hook.result.current.handleGenerate();
    });

    expect(onAIGenerate).toHaveBeenCalledWith('Add Redis', undefined);
    expect(hook.result.current.prompt).toBe('Add Redis');
  });
});
