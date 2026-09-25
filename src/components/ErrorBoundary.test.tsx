import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('@/services/analytics/analytics', () => ({ captureAnalyticsException: vi.fn() }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  withTranslation: () => (Wrapped: React.ComponentType<Record<string, unknown>>) =>
    function Translated(props: Record<string, unknown>) {
      return <Wrapped {...props} t={(_key: string, fallback: string) => fallback} />;
    },
}));

function BrokenChild(): never {
  throw new Error('Internal renderer path /private/workspace');
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('ErrorBoundary recovery', () => {
  it('announces recovery and focuses its heading without exposing internals in production', () => {
    vi.stubEnv('DEV', false);
    render(<ErrorBoundary><BrokenChild /></ErrorBoundary>);
    const heading = screen.getByRole('heading', { name: 'Something went wrong' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('alert')).toContainElement(heading);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled();
    expect(screen.queryByText(/Internal renderer path/)).toBeNull();
    expect(screen.queryByText('Technical details')).toBeNull();
  });

  it('keeps development error details collapsed until requested', () => {
    vi.stubEnv('DEV', true);
    render(<ErrorBoundary><BrokenChild /></ErrorBoundary>);
    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText(/Internal renderer path/)).not.toBeVisible();
    fireEvent.click(screen.getByText('Technical details'));
    expect(details).toHaveAttribute('open');
  });

  it('reloads the page without clearing stored diagrams', () => {
    localStorage.setItem('saved-diagram-recovery-test', 'preserved');
    render(<ErrorBoundary><BrokenChild /></ErrorBoundary>);
    const currentWindow = window;
    const reload = vi.fn();
    vi.stubGlobal('window', new Proxy(currentWindow, {
      get(target, key) {
        if (key === 'location') return { reload };
        return Reflect.get(target, key, target);
      },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem('saved-diagram-recovery-test')).toBe('preserved');
    localStorage.removeItem('saved-diagram-recovery-test');
  });

  it('preserves a supplied panel recovery view', () => {
    render(<ErrorBoundary fallback={<button>Close panel</button>}><BrokenChild /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
  });
});
