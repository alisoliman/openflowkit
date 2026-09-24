import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { buildArchitectureServiceSuggestionPrompt } from '@/hooks/ai-generation/nodeActionPrompts';
import { useFlowEditorPanelActions } from './useFlowEditorPanelActions';

function setup() {
    const props = {
        handleFocusedAIRequest: vi.fn().mockResolvedValue(true),
        setStudioTab: vi.fn(),
        setStudioCodeMode: vi.fn(),
        setStudioMode: vi.fn(),
    };
    const { result } = renderHook(() => useFlowEditorPanelActions(props));
    return { props, result };
}

describe('useFlowEditorPanelActions', () => {
    const provider = useFlowStore.getState().aiSettings.provider;

    beforeEach(() => {
        useFlowStore.getState().setNodes([
            { id: 'orders', type: 'er_entity', position: { x: 0, y: 0 }, data: { label: 'Orders' } },
        ]);
    });

    afterEach(() => {
        useFlowStore.getState().setAISettings({ provider });
    });

    it('opens the AI studio for a Copilot node action, where the turn can be followed and stopped', async () => {
        useFlowStore.getState().setAISettings({ provider: 'copilot' });
        const { props, result } = setup();

        await act(async () => {
            await result.current.handleGenerateEntityFields('orders');
        });

        expect(props.setStudioTab).toHaveBeenCalledWith('ai');
        expect(props.setStudioMode).toHaveBeenCalled();
        expect(props.handleFocusedAIRequest).toHaveBeenCalledWith(expect.stringContaining('Orders'), ['orders']);
        expect(props.handleFocusedAIRequest).toHaveBeenCalledWith(expect.not.stringContaining('OpenFlow DSL'), ['orders']);
    });

    it('leaves the studio closed for other providers', async () => {
        useFlowStore.getState().setAISettings({ provider: 'openai' });
        const { props, result } = setup();

        await act(async () => {
            await result.current.handleSuggestArchitectureNode('orders');
        });

        expect(props.setStudioMode).not.toHaveBeenCalled();
        expect(props.handleFocusedAIRequest).toHaveBeenCalledWith(
            buildArchitectureServiceSuggestionPrompt(useFlowStore.getState().nodes[0]),
            ['orders']
        );
    });
});
