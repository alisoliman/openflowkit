import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '@/store';
import { InertWhileAgentEdits } from './InertWhileAgentEdits';

describe('InertWhileAgentEdits', () => {
  afterEach(() => {
    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
  });

  it('makes its controls inert only while a Flowpilot turn edits the page', () => {
    render(
      <InertWhileAgentEdits>
        <button type="button">Import</button>
      </InertWhileAgentEdits>
    );
    const wrapper = screen.getByRole('button', { name: 'Import' }).parentElement;
    expect(wrapper).not.toHaveAttribute('inert');

    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    expect(wrapper).toHaveAttribute('inert');

    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
    expect(wrapper).not.toHaveAttribute('inert');
  });
});
