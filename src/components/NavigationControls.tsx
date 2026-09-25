import React from 'react';
import { useReactFlow, useViewport } from '@/lib/reactflowCompat';
import { Plus, Minus, Maximize, HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useTranslation } from 'react-i18next';
import { useShortcutHelpActions } from '@/store/viewHooks';
import { useReducedMotion } from 'framer-motion';

const controlButtonClassName =
  'flex min-h-10 min-w-10 items-center justify-center rounded-[var(--radius-sm)] p-2 text-[var(--brand-secondary)] transition-all hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)] active:scale-95 sm:min-h-9 sm:min-w-9';

export function NavigationControls(): React.ReactElement {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const { setShortcutsHelpOpen } = useShortcutHelpActions();
  const reduceMotion = useReducedMotion();

  return (
    <div className="absolute bottom-8 left-4 z-30 @max-[640px]/canvas:bottom-auto @max-[640px]/canvas:top-4">
      <div className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] p-1 shadow-[var(--shadow-md)] ring-1 ring-black/5">
        <Tooltip text={t('navigationControls.zoomIn')} side="right">
          <button
            onClick={() => zoomIn({ duration: reduceMotion ? 0 : 200 })}
            aria-label={t('navigationControls.zoomIn')}
            className={controlButtonClassName}
          >
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>

        <div className="select-none py-1 text-center text-[10px] font-medium tabular-nums text-[var(--brand-secondary)]">
          {Math.round(zoom * 100)}%
        </div>

        <Tooltip text={t('navigationControls.zoomOut')} side="right">
          <button
            onClick={() => zoomOut({ duration: reduceMotion ? 0 : 200 })}
            aria-label={t('navigationControls.zoomOut')}
            className={controlButtonClassName}
          >
            <Minus className="w-4 h-4" />
          </button>
        </Tooltip>
        <div className="mx-2 my-1 h-px bg-[var(--color-brand-border)]" />
        <Tooltip text={t('navigationControls.fitView')} side="right">
          <button
            onClick={() => fitView({ duration: reduceMotion ? 0 : 300, padding: 0.2 })}
            aria-label={t('navigationControls.fitView')}
            className={controlButtonClassName}
          >
            <Maximize className="w-4 h-4" />
          </button>
        </Tooltip>
        <div className="mx-2 my-1 h-px bg-[var(--color-brand-border)]" />
        <Tooltip text={t('navigationControls.keyboardShortcuts')} side="right">
          <button
            onClick={() => setShortcutsHelpOpen(true)}
            aria-label={t('navigationControls.keyboardShortcuts')}
            className={controlButtonClassName}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
