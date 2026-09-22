import type { ReactElement } from 'react';
import { Undo2 } from 'lucide-react';
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
    <div className="space-y-2 border-t border-[var(--color-brand-border)] px-1 py-3">
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
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <button
          type="button"
          onClick={onUndo}
          disabled={isGenerating || !canUndo || !onUndo}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
          {t('flowpilot.undo', 'Undo AI edit')}
        </button>
      </div>
      <p id="flowpilot-apply-hint" className="text-xs leading-5 text-[var(--brand-secondary)]">
        {settings.autoApply
          ? t('flowpilot.autoApplyHint', 'Completed edits apply immediately. Undo is available after each edit.')
          : t('flowpilot.reviewHint', 'Review each change before it reaches the canvas.')}
      </p>
    </div>
  );
}
