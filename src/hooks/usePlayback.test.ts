import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import { useFlowStore } from '@/store';
import { usePlayback } from './usePlayback';

const { fitView } = vi.hoisted(() => ({ fitView: vi.fn() }));

vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({ fitView }),
}));

function node(id: string, x: number): FlowNode {
  return { id, type: 'process', position: { x, y: 0 }, style: { width: 120 }, data: { label: id.toUpperCase() } };
}

function styles() {
  return useFlowStore.getState().nodes.map((candidate) => candidate.style);
}

beforeEach(() => {
  vi.useFakeTimers();
  useFlowStore.setState({ nodes: [node('a', 0), node('b', 200)], edges: [], agentTurn: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePlayback', () => {
  it('ends playback and restores node styles as a Flowpilot turn takes the page', () => {
    const { result } = renderHook(() => usePlayback());
    act(() => result.current.startPlayback());
    act(() => result.current.togglePlay());
    expect(styles()[1]).toMatchObject({ opacity: 0.2 });

    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
      // The turn reads the page it starts from right after taking its lock.
      expect(styles()).toEqual([{ width: 120 }, { width: 120 }]);
    });
    expect(result.current.currentStepIndex).toBe(-1);
    expect(result.current.isPlaying).toBe(false);

    act(() => vi.advanceTimersByTime(10_000));
    expect(styles()).toEqual([{ width: 120 }, { width: 120 }]);
  });
});
