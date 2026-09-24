import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { useFlowStore } from '@/store';
import { EdgeStyleSection } from './EdgeStyleSection';

function createEdge(overrides: Partial<FlowEdge> = {}): FlowEdge {
    return { id: 'edge-1', source: 'a', target: 'b', type: 'smoothstep', data: {}, ...overrides };
}

describe('EdgeStyleSection', () => {
    it('pins the chosen line style as the edge curve so it wins over the diagram style', () => {
        const onChange = vi.fn();
        render(<EdgeStyleSection selectedEdge={createEdge()} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Step' }));
        expect(onChange).toHaveBeenLastCalledWith('edge-1', expect.objectContaining({
            type: 'step',
            data: expect.objectContaining({ curve: 'step' }),
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Straight' }));
        expect(onChange).toHaveBeenLastCalledWith('edge-1', expect.objectContaining({
            type: 'straight',
            data: expect.objectContaining({ curve: 'linear' }),
        }));
    });

    it('marks the style the edge is drawn with', () => {
        const { rerender } = render(<EdgeStyleSection selectedEdge={createEdge()} onChange={vi.fn()} />);

        // A smoothstep edge with no curve of its own is drawn with the diagram's bezier default.
        expect(screen.getByRole('button', { name: 'Bezier' })).toHaveAttribute('aria-pressed', 'true');

        rerender(<EdgeStyleSection selectedEdge={createEdge({ data: { curve: 'smoothstep' } })} onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Smoothstep' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Bezier' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers no swap for a mindmap branch', () => {
        useFlowStore.setState({
            nodes: [
                { id: 'a', type: 'mindmap', position: { x: 0, y: 0 }, data: { label: 'Root' } },
                { id: 'b', type: 'mindmap', position: { x: 200, y: 0 }, data: { label: 'Topic' } },
            ],
        });
        render(<EdgeStyleSection selectedEdge={createEdge()} onChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));

        expect(screen.queryByRole('button', { name: /swap/i })).toBeNull();
        useFlowStore.setState({ nodes: [] });
    });

    it('swaps the edge ends', () => {
        const onChange = vi.fn();
        render(
            <EdgeStyleSection
                selectedEdge={createEdge({ sourceHandle: 'bottom', targetHandle: 'top' })}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        fireEvent.click(screen.getByRole('button', { name: /swap/i }));

        expect(onChange).toHaveBeenCalledWith('edge-1', expect.objectContaining({
            source: 'b',
            target: 'a',
            sourceHandle: 'top',
            targetHandle: 'bottom',
        }));
    });
});
