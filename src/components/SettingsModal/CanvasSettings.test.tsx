import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { CanvasSettings } from './CanvasSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('CanvasSettings', () => {
  it('records one undo step before restyling every edge', () => {
    const recordHistoryV2 = vi.fn();
    const setGlobalEdgeOptions = vi.fn();
    const original = useFlowStore.getState();
    useFlowStore.setState({ recordHistoryV2, setGlobalEdgeOptions });
    render(<CanvasSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Rounded' }));

    expect(recordHistoryV2).toHaveBeenCalledTimes(1);
    expect(setGlobalEdgeOptions).toHaveBeenCalledWith({ type: 'smoothstep', curve: 'smoothstep' });
    expect(recordHistoryV2.mock.invocationCallOrder[0]).toBeLessThan(
      setGlobalEdgeOptions.mock.invocationCallOrder[0]
    );
    useFlowStore.setState({
      recordHistoryV2: original.recordHistoryV2,
      setGlobalEdgeOptions: original.setGlobalEdgeOptions,
    });
  });
});
