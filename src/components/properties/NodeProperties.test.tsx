import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@/lib/reactflowCompat';
import type { NodeData } from '@/lib/types';
import { NodeProperties } from './NodeProperties';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useAssetCatalog', () => ({
  useAssetCatalog: () => ({
    items: [],
    filteredItems: [],
    previewUrls: {},
    query: '',
    setQuery: vi.fn(),
    category: 'all',
    setCategory: vi.fn(),
  }),
}));

vi.mock('./IconPicker', () => ({
  IconPicker: () => <div>icon-picker</div>,
}));

function createNode(overrides: Partial<Node<NodeData>> = {}): Node<NodeData> {
  return {
    id: 'node-1',
    type: 'process',
    position: { x: 0, y: 0 },
    data: {
      label: 'API Gateway',
      subLabel: 'Routes traffic to downstream services',
      ...overrides.data,
    },
    ...overrides,
  } as Node<NodeData>;
}

describe('NodeProperties', () => {
  it('keeps content editing controls inside the Content section without native selects', () => {
    const { container } = render(
      <NodeProperties
        selectedNode={createNode()}
        onChange={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('button', { name: 'Content' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('API Gateway');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Routes traffic to downstream services');
    expect(screen.getByRole('combobox', { name: 'Label font' })).toHaveTextContent('Inter');
    expect(screen.getByRole('combobox', { name: 'Label font size' })).toHaveTextContent('14px');
    expect(screen.getByRole('combobox', { name: 'Description font' })).toHaveTextContent('Inter');
    expect(screen.getByRole('combobox', { name: 'Description font size' })).toHaveTextContent('12px');
    expect(screen.getByText('Secondary Style')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Text Style' })).toBeNull();
  });

  it('exposes formatting state and activates styles through native button clicks', () => {
    const onChange = vi.fn();
    render(
      <NodeProperties
        selectedNode={createNode({ data: { label: 'API Gateway', fontWeight: 'bold', align: 'right' } })}
        onChange={onChange}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const bold = screen.getByRole('button', { name: 'Bold', pressed: true });
    const italic = screen.getByRole('button', { name: 'Italic', pressed: false });
    expect(bold).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Align Right' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Align Center' })).toHaveAttribute('aria-pressed', 'false');

    // Mousedown preserves a textarea selection; activation also supports the
    // native click produced by Enter, Space, and assistive technology.
    fireEvent.mouseDown(bold);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(bold);
    expect(onChange).toHaveBeenCalledWith('node-1', { fontWeight: 'normal' });
    fireEvent.click(italic);
    expect(onChange).toHaveBeenCalledWith('node-1', { fontStyle: 'italic' });
  });

  it('preserves the focused text selection when applying inline formatting', () => {
    const onChange = vi.fn();
    render(
      <NodeProperties
        selectedNode={createNode()}
        onChange={onChange}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const label = screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement;
    fireEvent.focus(label);
    label.setSelectionRange(0, 3);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('node-1', { label: '**API** Gateway' });
  });

  it('uses the shared icon picker for icon-backed asset nodes', () => {
    render(
      <NodeProperties
        selectedNode={createNode({
          type: 'custom',
          data: {
            label: 'Lambda',
            assetPresentation: 'icon',
            archIconPackId: 'aws-official-starter-v1',
            archIconShapeId: 'compute-lambda',
          },
        })}
        onChange={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Icon' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('icon-picker')).toBeTruthy();
  });
});
