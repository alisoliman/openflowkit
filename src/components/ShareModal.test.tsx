import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareModal } from './ShareModal';
import { getShareStatusDefaultMessage, SHARE_MODAL_COPY } from './shareModalContent';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: string | { defaultValue?: string }) => {
        if (typeof options === 'string') {
          return options;
        }
        return options?.defaultValue ?? key;
      },
    }),
  };
});

describe('ShareModal', () => {
  it('renders the invite URL and fallback guidance for local-only mode', () => {
    render(
      <ShareModal
        isOpen
        onClose={vi.fn()}
        onCopyInvite={vi.fn().mockResolvedValue(true)}
        roomId="room-123"
        inviteUrl="https://example.com/flow?room=room-123"
        status="fallback"
        viewerCount={2}
        participants={[
          { clientId: 'local', name: 'You', color: '#000', isLocal: true },
          { clientId: 'peer', name: 'Peer', color: '#fff', isLocal: false },
        ]}
      />
    );

    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: new RegExp(SHARE_MODAL_COPY.title) }).getAttribute('aria-describedby')).toBe('share-modal-description');
    expect(screen.getByRole('textbox', { name: SHARE_MODAL_COPY.linkLabel })).toHaveValue('https://example.com/flow?room=room-123');
    expect(screen.getByText(getShareStatusDefaultMessage('fallback'))).toBeTruthy();
    expect(screen.getByText(SHARE_MODAL_COPY.footerNote)).toBeTruthy();
  });

  it('invokes copy and close actions', () => {
    const onClose = vi.fn();
    const onCopyInvite = vi.fn().mockResolvedValue(true);

    render(
      <ShareModal
        isOpen
        onClose={onClose}
        onCopyInvite={onCopyInvite}
        roomId="room-123"
        inviteUrl="https://example.com/flow?room=room-123"
        status="realtime"
        viewerCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: SHARE_MODAL_COPY.copyLink }));
    fireEvent.click(screen.getByLabelText(SHARE_MODAL_COPY.close));

    expect(onCopyInvite).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for clipboard confirmation before saying that the link was copied', async () => {
    let finish!: (success: boolean) => void;
    const copy = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<ShareModal isOpen onClose={vi.fn()} onCopyInvite={copy} roomId="room-1" inviteUrl="https://example.com/?room=room-1" status="realtime" viewerCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: SHARE_MODAL_COPY.copyLink }));
    expect(screen.getByRole('button', { name: 'Copying…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: SHARE_MODAL_COPY.copiedLink })).not.toBeInTheDocument();
    await act(async () => { finish(true); });
    expect(screen.getByRole('button', { name: SHARE_MODAL_COPY.copiedLink })).toBeEnabled();
  });

  it.each(['false', 'rejection'])('shows manual-copy recovery when copying returns %s', async (failure) => {
    const copy = failure === 'false' ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error('Denied'));
    render(<ShareModal isOpen onClose={vi.fn()} onCopyInvite={copy} roomId="room-1" inviteUrl="https://example.com/?room=room-1" status="realtime" viewerCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: SHARE_MODAL_COPY.copyLink }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. Select the link above and copy it manually, or try again.');
    expect(screen.getByRole('button', { name: SHARE_MODAL_COPY.copyLink })).toBeEnabled();
    const link = screen.getByRole('textbox', { name: SHARE_MODAL_COPY.linkLabel }) as HTMLTextAreaElement;
    fireEvent.focus(link);
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(link.value.length);
  });
});
