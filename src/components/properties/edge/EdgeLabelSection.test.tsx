import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { EdgeLabelSection } from './EdgeLabelSection';

function EditableEdge({ onEdge }: { onEdge: (edge: FlowEdge) => void }): React.ReactElement {
    const [edge, setEdge] = useState<FlowEdge>({ id: 'edge-1', source: 'a', target: 'b', data: {} });
    return (
        <EdgeLabelSection
            selectedEdge={edge}
            onChange={(_id, updates) => {
                const next = { ...edge, ...updates };
                onEdge(next);
                setEdge(next);
            }}
        />
    );
}

describe('EdgeLabelSection', () => {
    it('keeps the space between words while the label is typed one key at a time', () => {
        let edge: FlowEdge | undefined;
        render(<EditableEdge onEdge={(next) => { edge = next; }} />);
        const input = screen.getByPlaceholderText(/if yes/i) as HTMLInputElement;

        for (const value of ['I', 'If', 'If ', 'If y', 'If ye', 'If yes']) {
            fireEvent.change(input, { target: { value } });
            expect(input.value).toBe(value);
        }
        expect(edge?.label).toBe('If yes');

        // A trailing space is only kept while typing; the stored label is trimmed.
        fireEvent.change(input, { target: { value: 'If yes ' } });
        expect(edge?.label).toBe('If yes');
        fireEvent.blur(input);
        expect(input.value).toBe('If yes');
    });
});
