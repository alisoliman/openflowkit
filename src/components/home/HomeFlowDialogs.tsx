import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { useModalDialog } from '@/hooks/useModalDialog';

interface HomeFlowRenameDialogProps {
  flowName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (nextName: string) => void;
}

interface HomeFlowDeleteDialogProps {
  flowName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function HomeFlowRenameDialog({
  flowName,
  isOpen,
  onClose,
  onSubmit,
}: HomeFlowRenameDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(flowName);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalDialog({ isOpen, onClose, initialFocusRef: inputRef });

  if (!isOpen) {
    return null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draftName.trim() && draftName.trim() !== flowName) onSubmit(draftName);
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-flow-rename-title"
        aria-describedby="home-flow-rename-description"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-[var(--shadow-overlay)]"
      >
        <div className="flex items-start justify-between border-b border-[var(--color-brand-border)] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-primary-50)] text-[var(--brand-primary)]">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="home-flow-rename-title"
                className="text-base font-semibold text-[var(--brand-text)]"
              >
                {t('home.renameFlow.title', 'Rename flow')}
              </h2>
              <p
                id="home-flow-rename-description"
                className="text-sm text-[var(--brand-secondary)]"
              >
                {t(
                  'home.renameFlow.description',
                  'Update the name shown on your dashboard and in the editor.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-2 text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
            aria-label={t('common.close', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <label
            htmlFor="home-flow-rename-input"
            className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--brand-secondary)]"
          >
            {t('home.renameFlow.label', 'Flow name')}
          </label>
          <input
            ref={inputRef}
            id="home-flow-rename-input"
            aria-describedby="home-flow-rename-hint"
            onFocus={(event) => event.target.select()}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-3 py-2.5 text-sm text-[var(--brand-text)] outline-none transition-colors placeholder:text-[var(--brand-secondary)] focus:border-[var(--brand-primary)]"
            placeholder={t('home.renameFlow.placeholder', 'Enter a flow name')}
          />
          <p id="home-flow-rename-hint" className="mt-2 text-xs text-[var(--brand-secondary)]">
            {t(
              'home.renameFlow.hint',
              'Names are local to this browser profile unless you export or sync them elsewhere.'
            )}
          </p>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!draftName.trim() || draftName.trim() === flowName}
            >
              {t('common.save', 'Save')}
            </Button>
          </div>
        </form>
      </div>

      <button
        type="button"
        className="absolute inset-0 -z-10"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        aria-label={t('home.renameFlow.closeDialog', 'Close rename flow dialog')}
      />
    </div>,
    document.body
  );
}

export function HomeFlowDeleteDialog({
  flowName,
  isOpen,
  onClose,
  onConfirm,
}: HomeFlowDeleteDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog({ isOpen, onClose, initialFocusRef: cancelRef });

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-flow-delete-title"
        aria-describedby="home-flow-delete-description"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-[var(--shadow-overlay)]"
      >
        <div className="flex items-start justify-between border-b border-[var(--color-brand-border)] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="home-flow-delete-title"
                className="text-base font-semibold text-[var(--brand-text)]"
              >
                {t('home.deleteFlow.title', 'Delete flow')}
              </h2>
              <p
                id="home-flow-delete-description"
                className="text-sm text-[var(--brand-secondary)]"
              >
                {t(
                  'home.deleteFlow.description',
                  'This removes the local autosaved flow from this device.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-2 text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
            aria-label={t('common.close', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="break-words text-sm leading-6 text-[var(--brand-text)]">
            {t('home.deleteFlow.confirmation', 'Delete "{{name}}"?', { name: flowName })}
          </p>
          <p className="mt-2 text-xs text-[var(--brand-secondary)]">
            {t(
              'home.deleteFlow.hint',
              'This cannot be undone unless you have an exported backup or another copy.'
            )}
          </p>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button ref={cancelRef} type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={onConfirm}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="absolute inset-0 -z-10"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        aria-label={t('home.deleteFlow.closeDialog', 'Close delete flow dialog')}
      />
    </div>,
    document.body
  );
}
