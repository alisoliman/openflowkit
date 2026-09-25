import { useModalDialog } from '@/hooks/useModalDialog';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';
import React, { useId, useRef } from 'react';
import { Check, Code2, Copy, ExternalLink, FileCode2, Link, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MODAL_PANEL_CLASS, SECTION_CARD_CLASS } from '@/lib/designTokens';
import { Button } from './ui/Button';

interface ShareEmbedModalProps {
    viewerUrl: string;
    onClose: () => void;
}

function CopyRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }): React.ReactElement {
    const { t } = useTranslation();
    const inputId = useId();
    const errorId = useId();
    const { status, copyNow } = useCopyFeedback(async () => {
        await navigator.clipboard.writeText(value);
        return true;
    });

    return (
        <div className={`${SECTION_CARD_CLASS} p-3`}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <label htmlFor={inputId} className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--brand-text)]">
                    <span aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
                    {label}
                </label>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyNow()}
                    isLoading={status === 'copying'}
                    aria-label={t('shareEmbed.copyLabel', { label, defaultValue: 'Copy {{label}}' })}
                    icon={status === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                >
                    {t('shareEmbed.copy', 'Copy')}
                </Button>
            </div>
            <textarea
                id={inputId}
                value={value}
                readOnly
                rows={2}
                onFocus={(event) => event.target.select()}
                aria-describedby={status === 'error' ? errorId : undefined}
                className="block w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-2.5 py-2 font-mono text-xs leading-5 text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
            />
            <p role="status" className="mt-1.5 min-h-4 text-xs text-[var(--color-surface-success-text)]">
                {status === 'copied' ? t('shareEmbed.copied', 'Copied') : status === 'copying' ? t('share.copying', 'Copying…') : ''}
            </p>
            {status === 'error' ? (
                <p id={errorId} role="alert" className="mt-1 text-xs leading-5 text-[var(--color-surface-warning-text)]">
                    {t('shareEmbed.copyError', 'Could not copy. Select the text above and copy it manually, or try again.')}
                </p>
            ) : null}
        </div>
    );
}

function getViewerLinks(viewerUrl: string): { full: string; card: string; badge: string } | null {
    try {
        const viewer = new URL(viewerUrl);
        if (viewer.protocol !== 'https:' && viewer.protocol !== 'http:') return null;
        const withSize = (size: 'card' | 'badge'): string => {
            const next = new URL(viewer.toString());
            if (next.hash.startsWith('#/')) {
                // HashRouter reads the route's query, not the page's outer query.
                const route = new URL(next.hash.slice(1), next.origin);
                route.searchParams.set('size', size);
                next.hash = `${route.pathname}${route.search}`;
            } else {
                next.searchParams.set('size', size);
            }
            return next.toString();
        };
        return { full: viewer.toString(), card: withSize('card'), badge: withSize('badge') };
    } catch {
        return null;
    }
}

function escapeHtmlAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function ShareEmbedModal({ viewerUrl, onClose }: ShareEmbedModalProps): React.ReactElement {
    const { t } = useTranslation();
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useModalDialog({ onClose, initialFocusRef: closeRef });
    const links = getViewerLinks(viewerUrl);
    const markdownLink = links ? `[${t('shareEmbed.markdownText', 'Open interactive diagram on OpenFlowKit')}](<${links.full}>)` : '';
    const readmeLink = links ? `[${t('shareEmbed.readmeText', 'View architecture diagram')}](<${links.badge}>)` : '';
    const iframeSnippet = links ? `<iframe src="${escapeHtmlAttribute(links.card)}" width="720" height="420" style="border:0;border-radius:16px;overflow:hidden;" loading="lazy" title="${escapeHtmlAttribute(t('shareEmbed.frameTitle', 'OpenFlowKit diagram'))}"></iframe>` : '';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-embed-title"
                aria-describedby="share-embed-description"
                className={`relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden text-[var(--brand-text)] animate-in fade-in zoom-in-95 duration-150 ${MODAL_PANEL_CLASS}`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-brand-border)] px-5 py-4">
                    <div className="min-w-0">
                        <h2 id="share-embed-title" className="text-base font-semibold text-[var(--brand-text)]">{t('shareEmbed.title', 'Share and embed diagram')}</h2>
                        <p id="share-embed-description" className="mt-1 text-xs leading-5 text-[var(--brand-secondary)]">{t('shareEmbed.description', 'Anyone with the link can view this snapshot. Later edits will not update it.')}</p>
                    </div>
                    <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label={t('share.closeDialog', 'Close share dialog')}>
                        <X aria-hidden="true" className="h-4 w-4" />
                    </Button>
                </div>

                <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-5 custom-scrollbar">
                    {links ? <>
                        <CopyRow key={`viewer:${links.full}`} label={t('shareEmbed.viewerLink', 'Viewer link')} value={links.full} icon={Link} />
                        <CopyRow key={`markdown:${markdownLink}`} label={t('shareEmbed.markdownLink', 'Markdown link')} value={markdownLink} icon={Code2} />
                        <CopyRow key={`readme:${readmeLink}`} label={t('shareEmbed.readmeLink', 'README link')} value={readmeLink} icon={Code2} />
                        <CopyRow key={`iframe:${iframeSnippet}`} label={t('shareEmbed.iframe', 'Embed iframe')} value={iframeSnippet} icon={FileCode2} />

                        <a
                            href={links.card}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] px-3 py-2 text-sm font-medium text-[var(--brand-text)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-primary)]"
                        >
                            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                            {t('shareEmbed.openViewer', 'Open card viewer')}
                            <span className="sr-only">{t('shareEmbed.newTab', '(opens in a new tab)')}</span>
                        </a>
                    </> : (
                        <p role="alert" className="text-sm leading-6 text-[var(--color-surface-danger-text)]">{t('shareEmbed.invalidLink', 'This viewer link is unavailable. Close this dialog and create a new share link.')}</p>
                    )}
                </div>

                <div className="shrink-0 border-t border-[var(--color-brand-border)] px-5 py-3">
                    <p className="text-xs leading-5 text-[var(--brand-secondary)]">
                        {t('shareEmbed.help', 'Use a Markdown link in GitHub READMEs, or the iframe in websites that support embedded content.')}
                    </p>
                </div>
            </div>
        </div>
    );
}
