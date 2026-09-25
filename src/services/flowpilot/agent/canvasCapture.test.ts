import { afterEach, describe, expect, it, vi } from 'vitest';
import { toJpeg } from 'html-to-image';
import { captureCanvasRegion } from './canvasCapture';

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn().mockResolvedValue('data:image/jpeg;base64,canvas'),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('captureCanvasRegion', () => {
  it('omits route editing controls while retaining diagram paths and labels', async () => {
    const viewport = document.createElement('div');
    viewport.className = 'react-flow__viewport';
    viewport.innerHTML = `
      <div class="react-flow__edgelabel-renderer">
        <div class="flow-edge-route-controls nodrag nopan"><button>Move bend</button></div>
        <div class="flow-edge-label">Success</div>
      </div>
      <svg><path class="react-flow__edge-path" d="M 0 0 L 100 100" /></svg>
    `;
    document.body.append(viewport);

    const result = await captureCanvasRegion({ x: 0, y: 0, width: 100, height: 100 }, '#fff');

    expect(result?.data).toBe('canvas');
    expect(toJpeg).toHaveBeenCalledTimes(1);
    const options = vi.mocked(toJpeg).mock.calls[0][1]!;
    expect(options.filter?.(viewport.querySelector('.flow-edge-route-controls')!)).toBe(false);
    expect(options.filter?.(viewport.querySelector('.react-flow__edgelabel-renderer')!)).toBe(true);
    expect(options.filter?.(viewport.querySelector('.flow-edge-label')!)).toBe(true);
    expect(options.filter?.(viewport.querySelector('.react-flow__edge-path')!)).toBe(true);
  });
});
