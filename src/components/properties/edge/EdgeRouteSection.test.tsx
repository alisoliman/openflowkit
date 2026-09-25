import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge, GlobalEdgeOptions } from '@/lib/types';
import { useFlowStore } from '@/store';
import { EdgeRouteSection } from './EdgeRouteSection';

function createEdge(overrides: Partial<FlowEdge> = {}): FlowEdge {
    return {
        id: 'edge-1',
        source: 'a',
        target: 'b',
        data: {},
        ...overrides,
    };
}

describe('EdgeRouteSection', () => {
    const initialGlobalEdgeOptions = useFlowStore.getState().globalEdgeOptions;
    beforeEach(() => useFlowStore.setState({ agentTurn: null, globalEdgeOptions: initialGlobalEdgeOptions }));
    afterEach(() => useFlowStore.setState({ agentTurn: null, globalEdgeOptions: initialGlobalEdgeOptions }));
    it('resets back to elk routing when manual bends exist', () => {
        const onChange = vi.fn();
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    data: {
                        elkPoints: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
                        routingMode: 'elk',
                        waypoint: { x: 50, y: 50 },
                        waypoints: [{ x: 70, y: 70 }],
                    },
                })}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /reset path/i }));

        expect(onChange).toHaveBeenCalledWith('edge-1', {
            data: {
                elkPoints: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
                routingMode: 'elk',
                waypoint: undefined,
                waypoints: undefined,
            },
        });
    });

    it('shows automatic routing state when there are no manual bends', () => {
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    data: {
                        routingMode: 'elk',
                        elkPoints: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
                    },
                })}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(/elk auto-routed/i)).toBeTruthy();
        expect(screen.getByText(/connector routing is automatic/i)).toBeTruthy();
    });

    it('shows preserved Mermaid endpoint state after fixed geometry is released', () => {
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    data: {
                        routingMode: 'auto',
                        _mermaidImportedEdge: {
                            source: 'official-flowchart',
                            fidelity: 'renderer-backed',
                            hasFixedRoute: false,
                        },
                    },
                })}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(/mermaid preserved endpoints/i)).toBeTruthy();
    });

    it('resets manual bends back to auto when no elk route exists', () => {
        const onChange = vi.fn();
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    data: {
                        routingMode: 'manual',
                        waypoints: [
                            { x: 50, y: 50 },
                            { x: 80, y: 90 },
                        ],
                    },
                })}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /reset path/i }));

        expect(onChange).toHaveBeenCalledWith('edge-1', {
            data: {
                routingMode: 'auto',
                waypoint: undefined,
                waypoints: undefined,
            },
        });
    });

    it('shows stored custom path hint and reset guidance', () => {
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    data: {
                        routingMode: 'manual',
                        waypoints: [
                            { x: 50, y: 50 },
                            { x: 80, y: 90 },
                        ],
                    },
                })}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(/2 custom bends/i)).toBeTruthy();
        expect(screen.getByText(/reset to restore the original route/i)).toBeTruthy();
        expect(screen.getByRole('spinbutton', { name: 'Bend 1 X' })).toHaveValue(50);
        expect(screen.getByRole('spinbutton', { name: 'Bend 2 Y' })).toHaveValue(90);
    });

    it('leaves the route untouched on selection and explains the drag handles', () => {
        const onChange = vi.fn();
        const { rerender } = render(<EdgeRouteSection selectedEdge={createEdge()} onChange={onChange} />);
        expect(screen.getByText(/select the arrow and drag its round handles/i)).toBeTruthy();

        rerender(<EdgeRouteSection selectedEdge={createEdge({ id: 'edge-2', data: { waypoint: { x: 10, y: 20 } } })} onChange={onChange} />);
        expect(screen.getByRole('spinbutton', { name: 'Bend 1 X' })).toHaveValue(10);
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        { edgeCurve: 'step', diagramCurve: 'basis', type: 'bezier', step: true },
        { edgeCurve: 'stepBefore', diagramCurve: 'basis', type: 'bezier', step: true },
        { edgeCurve: 'stepAfter', diagramCurve: 'basis', type: 'bezier', step: true },
        { edgeCurve: 'smoothstep', diagramCurve: 'basis', type: 'bezier', step: true },
        { edgeCurve: 'basis', diagramCurve: 'step', type: 'step', step: false },
        { edgeCurve: undefined, diagramCurve: 'step', type: 'bezier', step: true },
        { edgeCurve: undefined, diagramCurve: 'basis', type: 'step', step: false },
        { edgeCurve: undefined, diagramCurve: undefined, type: 'step', step: true },
        { edgeCurve: undefined, diagramCurve: undefined, type: 'straight', step: false },
    ] as const)('resolves drag instructions for edge $edgeCurve, diagram $diagramCurve, type $type', ({ edgeCurve, diagramCurve, type, step }) => {
        useFlowStore.setState({ globalEdgeOptions: { ...initialGlobalEdgeOptions, curve: diagramCurve } as GlobalEdgeOptions });
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ type, data: { curve: edgeCurve } })} onChange={onChange} />);

        expect(Boolean(screen.queryByText(/right angles stay locked/i))).toBe(step);
        expect(Boolean(screen.queryByText(/select the arrow and drag its round handles/i))).toBe(!step);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps coordinate fields with perpendicular-drag guidance for manual step routes', () => {
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { curve: 'step', waypoints: [{ x: 10, y: 20 }] } })} onChange={vi.fn()} />);
        expect(screen.getByText(/drag horizontal segments up\/down or vertical segments left\/right/i)).toBeTruthy();
        expect(screen.getByRole('spinbutton', { name: 'Bend 1 X' })).toHaveValue(10);
        expect(screen.queryByText(/round handles/i)).toBeNull();
    });

    it.each([false, true])('avoids draggable-handle instructions for self-loops with manual points: %s', (manual) => {
        render(<EdgeRouteSection selectedEdge={createEdge({ target: 'a', data: { curve: 'step', waypoints: manual ? [{ x: 10, y: 20 }] : undefined } })} onChange={vi.fn()} />);
        expect(screen.getByText('Self-loop routes are automatic; bend handles are not available.')).toBeTruthy();
        expect(screen.queryByText(/drag horizontal segments|round handles/i)).toBeNull();
    });

    it('commits a coordinate once on blur and normalizes a legacy bend', () => {
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { waypoint: { x: 10, y: 20 }, waypoints: [], connectionType: 'fixed' } })} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: 'Bend 1 X' });

        fireEvent.change(input, { target: { value: '-2' } });
        fireEvent.change(input, { target: { value: '-25.5' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('edge-1', {
            data: {
                routingMode: 'manual',
                connectionType: 'fixed',
                waypoint: undefined,
                waypoints: [{ x: -25.5, y: 20 }],
            },
        });
    });

    it('rounds displayed coordinates without committing untouched fields on blur or Enter', () => {
        const onChange = vi.fn();
        const point = { x: 768.5000610351, y: -123.456789 };
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { waypoints: [point] } })} onChange={onChange} />);
        const xInput = screen.getByRole('spinbutton', { name: 'Bend 1 X' });
        const yInput = screen.getByRole('spinbutton', { name: 'Bend 1 Y' });

        expect(xInput).toHaveValue(768.5);
        expect(yInput).toHaveValue(-123.46);
        xInput.focus();
        fireEvent.keyDown(xInput, { key: 'Enter' });
        fireEvent.blur(yInput);
        expect(onChange).not.toHaveBeenCalled();

        xInput.focus();
        fireEvent.change(xInput, { target: { value: '42' } });
        fireEvent.keyDown(xInput, { key: 'Escape' });
        expect(xInput).toHaveValue(768.5);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('commits explicitly edited precision, then displays a rounded value without another write', () => {
        const onChange = vi.fn();
        const originalY = 456.123456;
        function Editor(): React.ReactElement {
            const [edge, setEdge] = React.useState(createEdge({ data: {
                routingMode: 'manual', waypoints: [{ x: 768.5000610351, y: originalY }],
            } }));
            return <EdgeRouteSection selectedEdge={edge} onChange={(id, updates) => { onChange(id, updates); setEdge({ ...edge, ...updates }); }} />;
        }
        render(<Editor />);
        const input = screen.getByRole('spinbutton', { name: 'Bend 1 X' });
        input.focus();
        fireEvent.change(input, { target: { value: '42.98765' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('edge-1', { data: {
            routingMode: 'manual', waypoint: undefined, waypoints: [{ x: 42.98765, y: originalY }],
        } });
        const updatedInput = screen.getByRole('spinbutton', { name: 'Bend 1 X' });
        expect(updatedInput).toHaveValue(42.99);
        updatedInput.focus();
        fireEvent.keyDown(updatedInput, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('commits Enter once, preserving the other coordinates and cached route', () => {
        const onChange = vi.fn();
        const elkPoints = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
        function Editor(): React.ReactElement {
            const [edge, setEdge] = React.useState(createEdge({ data: {
                routingMode: 'manual', elkPoints, waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
            } }));
            return <EdgeRouteSection selectedEdge={edge} onChange={(id, updates) => { onChange(id, updates); setEdge({ ...edge, ...updates }); }} />;
        }
        render(<Editor />);
        const input = screen.getByRole('spinbutton', { name: 'Bend 2 Y' });
        input.focus();
        fireEvent.change(input, { target: { value: '75' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('edge-1', { data: {
            routingMode: 'manual', elkPoints, waypoint: undefined, waypoints: [{ x: 10, y: 20 }, { x: 30, y: 75 }],
        } });
        const updatedInput = screen.getByRole('spinbutton', { name: 'Bend 2 Y' });
        expect(updatedInput).toHaveValue(75);
        fireEvent.blur(updatedInput);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('cancels on Escape and restores blank or unchanged fields without history updates', () => {
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { waypoints: [{ x: 10, y: 20 }] } })} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: 'Bend 1 X' });
        input.focus();
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input).toHaveValue(10);

        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        expect(input).toHaveValue(10);
        fireEvent.blur(input);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('removes one bend while retaining the remaining manual route', () => {
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { routingMode: 'manual', waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }] } })} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove bend 1' }));
        expect(onChange).toHaveBeenCalledWith('edge-1', { data: {
            routingMode: 'manual', waypoint: undefined, waypoints: [{ x: 30, y: 40 }],
        } });
    });

    it.each([
        { cached: {}, routingMode: 'auto' },
        { cached: { elkPoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }, routingMode: 'elk' },
        { cached: { importRoutePath: 'M0,0 L100,100', elkPoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }, routingMode: 'import-fixed' },
    ])('restores $routingMode when the last bend is removed', ({ cached, routingMode }) => {
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { ...cached, routingMode: 'manual', waypoint: { x: 10, y: 20 } } })} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove bend 1' }));
        expect(onChange).toHaveBeenCalledWith('edge-1', { data: {
            ...cached, routingMode, waypoint: undefined, waypoints: undefined,
        } });
    });

    it('discards drafts when selecting another edge or receiving changed coordinates', () => {
        const onChange = vi.fn();
        const edge = createEdge({ data: { waypoints: [{ x: 10, y: 20 }] } });
        const { rerender } = render(<EdgeRouteSection selectedEdge={edge} onChange={onChange} />);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Bend 1 X' }), { target: { value: '99' } });
        rerender(<EdgeRouteSection selectedEdge={{ ...edge, data: { waypoints: [{ x: 30, y: 20 }] } }} onChange={onChange} />);
        expect(screen.getByRole('spinbutton', { name: 'Bend 1 X' })).toHaveValue(30);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Bend 1 X' }), { target: { value: '99' } });
        rerender(<EdgeRouteSection selectedEdge={{ ...edge, id: 'edge-2' }} onChange={onChange} />);
        expect(screen.getByRole('spinbutton', { name: 'Bend 1 X' })).toHaveValue(10);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disables route editing during an agent turn and blocks a pending draft commit', async () => {
        const onChange = vi.fn();
        render(<EdgeRouteSection selectedEdge={createEdge({ data: { waypoints: [{ x: 10, y: 20 }] } })} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: 'Bend 1 X' });
        fireEvent.change(input, { target: { value: '99' } });
        await act(async () => { useFlowStore.setState({ agentTurn: { turnId: 'turn-1', pageId: 'page-1' } }); });

        expect(input).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Reset path' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove bend 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Fixed' })).toBeDisabled();
        fireEvent.blur(input);
        fireEvent.click(screen.getByRole('button', { name: 'Fixed' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove bend 1' }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('switches connector ownership to fixed and dynamic', () => {
        const onChange = vi.fn();
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    sourceHandle: 'right',
                    targetHandle: 'left',
                    data: {
                        connectionType: 'fixed',
                    },
                })}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dynamic' }));

        expect(onChange).toHaveBeenCalledWith('edge-1', {
            sourceHandle: null,
            targetHandle: null,
            data: {
                connectionType: 'dynamic',
                archSourceSide: undefined,
                archTargetSide: undefined,
            },
        });
    });

    it('routes a connector made dynamic instead of leaving its handles unset', () => {
        useFlowStore.setState({
            nodes: [
                { id: 'a', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A' } },
                { id: 'b', type: 'process', position: { x: 0, y: 300 }, data: { label: 'B' } },
            ],
        });
        const onChange = vi.fn();
        render(
            <EdgeRouteSection
                selectedEdge={createEdge({
                    sourceHandle: 'right',
                    targetHandle: 'right',
                    data: { connectionType: 'fixed' },
                })}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dynamic' }));

        expect(onChange).toHaveBeenCalledWith('edge-1', expect.objectContaining({
            sourceHandle: 'bottom',
            targetHandle: 'top',
            data: expect.objectContaining({ connectionType: 'dynamic' }),
        }));
        useFlowStore.setState({ nodes: [] });
    });
});
