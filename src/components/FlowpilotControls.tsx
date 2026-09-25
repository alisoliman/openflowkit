import type { ReactElement } from 'react';
import { Loader2, RefreshCw, Settings2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFlowStore } from '@/store';
import { useCopilotConnection } from '@/hooks/ai-generation/useCopilotConnection';
import { CopilotModelSelect } from './SettingsModal/ai/CopilotModelSelect';
import { HostedCopilotConnection } from './SettingsModal/ai/HostedCopilotConnection';
import { isHostedCopilot } from '@/services/copilot/client';

interface FlowpilotControlsProps {
  isGenerating: boolean;
  canUndo?: boolean;
  onUndo?: () => void;
}

export function FlowpilotControls({ isGenerating, canUndo, onUndo }: FlowpilotControlsProps): ReactElement {
  const { t } = useTranslation();
  const settings = useFlowStore((state) => state.aiSettings);
  const setSettings = useFlowStore((state) => state.setAISettings);
  const isCopilot = settings.provider === 'copilot';
  const { connection, refresh } = useCopilotConnection(isCopilot);
  const hosted = isHostedCopilot() || (connection.state === 'ready' && connection.status.mode === 'hosted');

  return (
    <div className="shrink-0 space-y-2 border-t border-[var(--color-brand-border)] px-1 py-3">
      {isCopilot && hosted && <HostedCopilotConnection connection={connection} onRefresh={refresh} />}
      {isCopilot && (
        <div className="space-y-1.5">
          <label htmlFor="flowpilot-model" className="text-xs font-medium text-[var(--brand-secondary)]">
            {t('flowpilot.model', 'Copilot model')}
          </label>
          <CopilotModelSelect
            id="flowpilot-model"
            model={settings.model || 'auto'}
            connection={connection}
            onChange={(model) => setSettings({ model })}
            disabled={isGenerating}
            describedBy={!hosted && (connection.state !== 'ready' || !connection.status.authenticated) ? 'flowpilot-connection-status' : undefined}
          />
          {!hosted && (connection.state !== 'ready' || !connection.status.authenticated) ? (
            <div className="space-y-2 pt-1">
              <p id="flowpilot-connection-status" role="status" className="flex items-start gap-1.5 break-words text-xs leading-5 text-[var(--brand-secondary)]">
                {connection.state === 'checking' ? <Loader2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
                {connection.state === 'checking'
                  ? t('copilot.checking')
                  : connection.state === 'unavailable' ? connection.message : connection.status.issue ?? t('copilot.notConnected')}
              </p>
              {connection.state !== 'checking' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={refresh} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)]">
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('copilot.checkConnection')}
                  </button>
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('open-ai-settings'))} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)]">
                    <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('flowpilot.aiSettings', 'AI settings')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {/* Copilot chat edits the canvas live and undoes per turn; its undo here is for AI imports. */}
      {(!isCopilot || canUndo) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!isCopilot && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--brand-text)]">
              <input
                type="checkbox"
                checked={settings.autoApply === true}
                onChange={(event) => setSettings({ autoApply: event.target.checked })}
                disabled={isGenerating}
                aria-describedby="flowpilot-apply-hint"
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              {t('flowpilot.autoApply', 'Apply edits automatically')}
            </label>
          )}
          <button
            type="button"
            onClick={onUndo}
            disabled={isGenerating || !canUndo || !onUndo}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
            {t('flowpilot.undo', 'Undo AI edit')}
          </button>
        </div>
      )}
      {!isCopilot && (
        <p id="flowpilot-apply-hint" className="text-xs leading-5 text-[var(--brand-secondary)]">
          {settings.autoApply
            ? t('flowpilot.autoApplyHint', 'Completed edits apply immediately. Undo is available after each edit.')
            : t('flowpilot.reviewHint', 'Review each change before it reaches the canvas.')}
        </p>
      )}
    </div>
  );
}
