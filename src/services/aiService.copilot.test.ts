import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatWithDocs, generateDiagramFromChat } from './aiService';

const request = vi.hoisted(() => vi.fn().mockResolvedValue('flow: "Test"'));
vi.mock('./copilot/client', () => ({ requestCopilot: request }));
afterEach(() => request.mockClear());

describe('Copilot as the Flowpilot engine', () => {
  it('defaults diagram generation to the SDK without requiring an API key', async () => {
    await expect(generateDiagramFromChat([], 'Create a diagram')).resolves.toBe('flow: "Test"');
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model: 'auto', prompt: expect.stringContaining('Create a diagram'), history: [],
      systemInstruction: expect.stringContaining('OpenFlow'),
    }), undefined, undefined);
  });

  it('preserves edit context, chat history, images, streaming, and cancellation without forwarding credentials', async () => {
    const signal = new AbortController().signal;
    const onChunk = vi.fn();
    await generateDiagramFromChat(
      [{ role: 'model', parts: [{ text: 'Previous response' }] }],
      'Add Redis', 'flow: "Existing"\n[process] api: API', 'data:image/png;base64,aGVsbG8=',
      'unused-provider-key', 'copilot-model', 'copilot', 'https://unused.example',
      true, onChunk, signal, 0.8,
    );
    const [payload, callback, requestSignal] = request.mock.calls[0];
    expect(payload).toMatchObject({
      prompt: expect.stringContaining('Preserve ALL unchanged node IDs'),
      history: [{ role: 'assistant', content: 'Previous response' }],
      image: 'data:image/png;base64,aGVsbG8=', model: 'copilot-model',
    });
    expect(payload.prompt).toContain('flow: "Existing"');
    expect(JSON.stringify(payload)).not.toContain('unused-provider-key');
    expect(JSON.stringify(payload)).not.toContain('unused.example');
    expect(payload).not.toHaveProperty('temperature');
    expect(callback).toBe(onChunk);
    expect(requestSignal).toBe(signal);
  });

  it('routes documentation answers through the same SDK engine', async () => {
    await chatWithDocs([], 'How do I export?', 'Use the export button.');
    expect(request.mock.calls[0][0]).toMatchObject({ prompt: 'How do I export?', model: 'auto' });
    expect(request.mock.calls[0][0].systemInstruction).toContain('Use the export button.');
  });
});
