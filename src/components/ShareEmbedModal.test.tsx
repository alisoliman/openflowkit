import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareEmbedModal } from './ShareEmbedModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, string>) => {
      if (typeof options === 'string') return options;
      return (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => options?.[name] ?? '');
    },
  }),
}));

afterEach(() => { vi.unstubAllGlobals(); });

const VIEWER_URL = 'https://example.com/?campaign=docs#/view?flow=~encoded-diagram';

describe('ShareEmbedModal', () => {
  it('keeps compact sizes in the hash route and preserves the diagram payload', () => {
    render(<ShareEmbedModal viewerUrl={VIEWER_URL} onClose={vi.fn()} />);
    const card = new URL(screen.getByRole('link', { name: /Open card viewer/ }).getAttribute('href')!);
    expect(card.search).toBe('?campaign=docs');
    const route = new URL(card.hash.slice(1), card.origin);
    expect(route.pathname).toBe('/view');
    expect(route.searchParams.get('flow')).toBe('~encoded-diagram');
    expect(route.searchParams.get('size')).toBe('card');
    expect((screen.getByRole('textbox', { name: 'README link' }) as HTMLTextAreaElement).value).toContain('size=badge');
    const iframe = (screen.getByRole('textbox', { name: 'Embed iframe' }) as HTMLTextAreaElement).value;
    const embed = new DOMParser().parseFromString(iframe, 'text/html').querySelector('iframe');
    expect(embed?.getAttribute('src')).toBe(card.toString());
  });

  it('waits for clipboard completion and allows a single pending copy', async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShareEmbedModal viewerUrl={VIEWER_URL} onClose={vi.fn()} />);
    const copy = screen.getByRole('button', { name: 'Copy Viewer link' });
    fireEvent.click(copy);
    expect(copy).toBeDisabled();
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(VIEWER_URL);
    await act(async () => { finish(); });
    expect(screen.getByText('Copied')).toBeInTheDocument();
    expect(copy).toBeEnabled();
  });

  it.each(['denied', 'unavailable'])('recovers from %s clipboard access with selectable text', async (failure) => {
    vi.stubGlobal('navigator', failure === 'denied' ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } } : {});
    render(<ShareEmbedModal viewerUrl={VIEWER_URL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. Select the text above and copy it manually, or try again.');
    const text = screen.getByRole('textbox', { name: 'Markdown link' }) as HTMLTextAreaElement;
    fireEvent.focus(text);
    expect(text.selectionStart).toBe(0);
    expect(text.selectionEnd).toBe(text.value.length);
    expect(screen.getByRole('button', { name: 'Copy Markdown link' })).toBeEnabled();
  });

  it.each(['invalid', 'javascript:alert(1)'])('handles an unusable viewer URL without losing the close control: %s', (viewerUrl) => {
    const close = vi.fn();
    render(<ShareEmbedModal viewerUrl={viewerUrl} onClose={close} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This viewer link is unavailable.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close share dialog' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
