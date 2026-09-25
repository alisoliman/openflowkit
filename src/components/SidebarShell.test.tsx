import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarHeader, SidebarSegmentedTabs, SidebarShell } from './SidebarShell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback }),
}));

describe('SidebarShell controls', () => {
  it('names its views from the sidebar heading and exposes selected state with keyboard navigation', () => {
    function Harness() {
      const [value, setValue] = useState('ai');
      return (
        <SidebarShell>
          <SidebarHeader title="Studio" />
          <SidebarSegmentedTabs
            tabs={[
              { id: 'ai', label: 'Flowpilot', badge: 'Beta' },
              { id: 'code', label: 'Code' },
            ]}
            activeTab={value}
            onTabChange={setValue}
          />
        </SidebarShell>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Studio' })).toBeTruthy();
    const ai = screen.getByRole('tab', { name: 'Flowpilot Beta' });
    const code = screen.getByRole('tab', { name: 'Code' });
    expect(ai.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(ai, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute('aria-selected')).toBe('true');
    expect(ai.tabIndex).toBe(-1);
  });

  it('closes without implicitly submitting an enclosing form', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SidebarShell>
          <SidebarHeader title="Properties" onClose={onClose} />
        </SidebarShell>
      </form>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
