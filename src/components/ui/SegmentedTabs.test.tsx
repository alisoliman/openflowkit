import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedTabs } from './SegmentedTabs';

const items = [
  { id: 'all', label: 'All templates', count: 8 },
  { id: 'disabled', label: 'Unavailable', disabled: true },
  { id: 'flow', label: 'Flowcharts', count: 4 },
  { id: 'cloud', label: 'Cloud', count: 2 },
];

function Harness({ rtl = false }: { rtl?: boolean }) {
  const [value, setValue] = useState('all');
  return (
    <div style={{ direction: rtl ? 'rtl' : 'ltr' }}>
      <SegmentedTabs
        items={items}
        value={value}
        onChange={setValue}
        ariaLabel="Template categories"
      />
    </div>
  );
}

describe('SegmentedTabs keyboard navigation', () => {
  it('keeps one Tab stop, skips disabled options, and wraps arrow navigation', () => {
    render(<Harness />);
    const all = screen.getByRole('tab', { name: 'All templates 8' });
    const flow = screen.getByRole('tab', { name: 'Flowcharts 4' });
    const cloud = screen.getByRole('tab', { name: 'Cloud 2' });
    expect(all.tabIndex).toBe(0);
    expect(flow.tabIndex).toBe(-1);
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(flow);
    expect(flow.getAttribute('aria-selected')).toBe('true');
    expect(all.tabIndex).toBe(-1);
    fireEvent.keyDown(flow, { key: 'End' });
    expect(document.activeElement).toBe(cloud);
    fireEvent.keyDown(cloud, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cloud);
    fireEvent.keyDown(cloud, { key: 'Home' });
    expect(document.activeElement).toBe(all);
    expect(screen.getByRole('tablist', { name: 'Template categories' })).toBeTruthy();
  });

  it('reverses horizontal arrows in RTL and leaves browser shortcuts alone', () => {
    render(<Harness rtl />);
    const all = screen.getByRole('tab', { name: 'All templates 8' });
    all.style.direction = 'rtl';
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Flowcharts 4' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', metaKey: true });
    expect(screen.getByRole('tab', { name: 'Flowcharts 4' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('keeps an enabled option reachable if the controlled selection disappears', () => {
    render(<SegmentedTabs items={items} value="missing" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'All templates 8' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Unavailable' }).tabIndex).toBe(-1);
  });
});
