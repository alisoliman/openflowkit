import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
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

function ChatHarness({ scrollKey = 0, generate = async () => true }: {
  scrollKey?: number;
  generate?: (prompt: string) => Promise<boolean>;
}) {
  const { prompt, setPrompt, handleKeyDown, scrollRef, isScrolledUp, scrollToLatest } = useAIViewState({
    searchQuery: '', isGenerating: false, onAIGenerate: generate, onClose: vi.fn(), scrollKey,
  });
  return <>
    <textarea aria-label="Prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} />
    <div ref={scrollRef} role="log" />
    {isScrolledUp && <button onClick={scrollToLatest}>Latest message</button>}
  </>;
}

describe('useAIViewState', () => {
  it('keeps IME confirmation and Shift+Enter from submitting the prompt', async () => {
    const generate = vi.fn(async () => true);
    render(<ChatHarness generate={generate} />);
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    fireEvent.change(prompt, { target: { value: '認証の流れ' } });
    fireEvent.keyDown(prompt, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(prompt, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true });
    expect(generate).not.toHaveBeenCalled();
    expect(prompt).toHaveValue('認証の流れ');
    await act(async () => { fireEvent.keyDown(prompt, { key: 'Enter' }); });
    expect(generate).toHaveBeenCalledWith('認証の流れ', undefined);
  });

  it('preserves the reading position while streaming and resumes following on demand', () => {
    const { rerender } = render(<ChatHarness scrollKey={1} />);
    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 300, configurable: true },
    });
    rerender(<ChatHarness scrollKey={2} />);
    expect(log.scrollTop).toBe(1000);
    log.scrollTop = 150;
    fireEvent.scroll(log);
    expect(screen.getByRole('button', { name: 'Latest message' })).toBeInTheDocument();
    Object.defineProperty(log, 'scrollHeight', { value: 1200, configurable: true });
    rerender(<ChatHarness scrollKey={3} />);
    expect(log.scrollTop).toBe(150);
    fireEvent.click(screen.getByRole('button', { name: 'Latest message' }));
    expect(log.scrollTop).toBe(1200);
    expect(screen.queryByRole('button', { name: 'Latest message' })).not.toBeInTheDocument();
    Object.defineProperty(log, 'scrollHeight', { value: 1400, configurable: true });
    rerender(<ChatHarness scrollKey={4} />);
    expect(log.scrollTop).toBe(1400);
  });

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
