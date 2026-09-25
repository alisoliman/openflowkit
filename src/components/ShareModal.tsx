import { useModalDialog } from '@/hooks/useModalDialog';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';
import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { getShareStatusDefaultMessage, SHARE_MODAL_COPY, type ShareModalStatus } from './shareModalContent';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCopyInvite: () => Promise<boolean>;
    roomId: string;
    inviteUrl: string;
    status: 'realtime' | 'waiting' | 'fallback';
    viewerCount: number;
    participants?: Array<{
        clientId: string;
        name: string;
        color: string;
        isLocal: boolean;
    }>;
}

function getShareStatusMessage(
    status: ShareModalStatus,
    t: ReturnType<typeof useTranslation>['t']
): string {
    return t(`share.statusMessage.${status}`, {
        defaultValue: getShareStatusDefaultMessage(status),
    });
}

function InviteLink({ inviteUrl, onCopyInvite, statusMessage }: {
    inviteUrl: string;
    onCopyInvite: () => Promise<boolean>;
    statusMessage: string;
}): React.JSX.Element {
    const { t } = useTranslation();
    const { status, copyNow } = useCopyFeedback(onCopyInvite);
    const copied = status === 'copied';

    return <>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-4 py-3">
            <label htmlFor="share-invite-link" className="text-xs font-semibold text-[var(--brand-secondary)]">
                {t('share.link', { defaultValue: SHARE_MODAL_COPY.linkLabel })}
            </label>
            <textarea
                id="share-invite-link"
                readOnly
                value={inviteUrl}
                rows={2}
                onFocus={(event) => event.target.select()}
                aria-describedby="share-link-status"
                className="mt-2 block w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-3 py-2 font-mono text-xs leading-5 text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
            />
            <p id="share-link-status" className="mt-2 text-xs leading-5 text-[var(--brand-secondary)]">{statusMessage}</p>
        </div>
        <Button
            variant="primary"
            onClick={() => void copyNow()}
            isLoading={status === 'copying'}
            disabled={!inviteUrl}
            className="w-full text-sm font-semibold"
            icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        >
            {status === 'copying'
                ? t('share.copying', 'Copying…')
                : copied
                    ? t('share.copied', { defaultValue: SHARE_MODAL_COPY.copiedLink })
                    : t('share.copyLink', { defaultValue: SHARE_MODAL_COPY.copyLink })}
        </Button>
        {status === 'error' ? (
            <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-surface-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--color-surface-warning-text)]">
                {t('share.copyError', 'Could not copy. Select the link above and copy it manually, or try again.')}
            </p>
        ) : null}
        <p role="status" className="sr-only">{copied ? t('share.copied', { defaultValue: SHARE_MODAL_COPY.copiedLink }) : ''}</p>
    </>;
}

export function ShareModal({
    isOpen,
    onClose,
    onCopyInvite,
    roomId,
    inviteUrl,
    status,
    viewerCount: _viewerCount,
    participants: _participants = [],
}: ShareModalProps): React.JSX.Element | null {
    const { t } = useTranslation();
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const modalRadius = 'var(--radius-xl)';
    const sectionRadius = 'var(--radius-md)';
    const primaryColor = 'var(--brand-primary)';
    const primary50Color = 'var(--brand-primary-50)';
    const statusMessage = getShareStatusMessage(status, t);

    const dialogRef = useModalDialog({ isOpen, onClose, initialFocusRef: closeButtonRef });

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-modal-title"
                aria-describedby="share-modal-description"
                data-testid="share-panel"
                className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200"
                style={{ borderRadius: modalRadius }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="relative p-6">
                    <button
                        type="button"
                        ref={closeButtonRef}
                        onClick={onClose}
                        className="absolute right-5 top-5 rounded-full p-2 text-[var(--brand-secondary)] transition-all hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)] active:scale-95"
                        aria-label={t('share.close', { defaultValue: SHARE_MODAL_COPY.close })}
                    >
                        <X aria-hidden="true" size={18} />
                    </button>

                    <div className="mb-6 flex flex-col items-center text-center">
                        <div
                            className="mb-4 flex h-12 w-12 items-center justify-center ring-8"
                            style={{
                                background: primary50Color,
                                color: primaryColor,
                                borderRadius: sectionRadius,
                                '--tw-ring-color': primary50Color,
                            } as React.CSSProperties}
                        >
                            <Share2 aria-hidden="true" className="h-6 w-6" />
                        </div>

                        <h2 id="share-modal-title" className="text-xl font-bold tracking-tight text-[var(--brand-text)]">
                            {t('share.title', { defaultValue: SHARE_MODAL_COPY.title })}
                            <span className="ml-2 inline-block rounded-full bg-[var(--color-surface-warning-bg)] px-2 py-0.5 align-middle text-xs font-semibold text-[var(--color-surface-warning-text)]">
                                {t('share.betaBadge', { defaultValue: SHARE_MODAL_COPY.betaBadge })}
                            </span>
                        </h2>
                        <p id="share-modal-description" className="mt-2 max-w-[300px] text-sm leading-relaxed text-[var(--brand-secondary)]">
                            {t('share.description', { defaultValue: SHARE_MODAL_COPY.description })}
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-4 py-3">
                            <div className="text-xs font-semibold text-[var(--brand-secondary)]">
                                {t('share.roomId', { defaultValue: SHARE_MODAL_COPY.roomLabel })}
                            </div>
                            <div className="mt-2 break-all font-mono text-sm text-[var(--brand-text)]">{roomId}</div>
                        </div>

                        <InviteLink key={inviteUrl} inviteUrl={inviteUrl} onCopyInvite={onCopyInvite} statusMessage={statusMessage} />

                        <p className="text-center text-xs text-[var(--brand-secondary)]">
                            {t('share.footerNote', { defaultValue: SHARE_MODAL_COPY.footerNote })}
                        </p>
                    </div>
                </div>
            </div>

            <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 -z-10"
                onClick={onClose}
                aria-label={t('share.closeDialog', { defaultValue: SHARE_MODAL_COPY.closeDialog })}
            />
        </div>,
        document.body
    );
}
