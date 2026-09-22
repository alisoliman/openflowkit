import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { isHostedCopilot, type CopilotConnectionState } from '@/services/copilot/client';
import { CopilotModelSelect } from './CopilotModelSelect';
import { HostedCopilotConnection } from './HostedCopilotConnection';

interface CopilotSettingsProps {
  connection: CopilotConnectionState;
  onRefresh: () => void;
  model: string;
  onModelChange: (model: string) => void;
}

export function CopilotSettings({ connection, onRefresh, model, onModelChange }: CopilotSettingsProps): ReactElement {
  const { t } = useTranslation();
  const status = connection.state === 'ready' ? connection.status : undefined;
  const hosted = status?.mode === 'hosted' || isHostedCopilot();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-[var(--brand-text)]">{t('copilot.connectionTitle')}</h4>
        {hosted ? (
          <>
            <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.hostedHelp')}</p>
            <HostedCopilotConnection connection={connection} onRefresh={onRefresh} />
            <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.hostedSessionHint')}</p>
          </>
        ) : (
          <>
        <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.loginHelp')}</p>
        <code className="block overflow-x-auto rounded-[var(--radius-md)] bg-[var(--brand-background)] px-3 py-2.5 text-sm text-[var(--brand-text)]">
          gh copilot login
        </code>
        <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.runtimeHelp')}</p>
        <div role="status" aria-live="polite" className="space-y-1 text-sm leading-6 text-[var(--brand-text)]">
          {connection.state === 'checking'
            ? t('copilot.checking')
            : status?.authenticated
              ? status.login ? t('copilot.connectedAs', { login: status.login }) : t('copilot.connected')
              : t('copilot.notConnected')}
          {connection.state === 'unavailable' && (
            <p className="break-words text-[var(--brand-secondary)]">{connection.message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={connection.state === 'checking'}
          className="rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3 py-2 text-sm font-medium text-[var(--brand-text)] transition-colors hover:border-[var(--brand-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-wait disabled:opacity-60"
        >
          {t('copilot.checkConnection')}
        </button>
          </>
        )}
      </div>
      <div className="space-y-2">
        <label htmlFor="copilot-model" className="text-sm font-medium text-[var(--brand-text)]">
          {t('settingsModal.ai.model')}
        </label>
        <CopilotModelSelect
          id="copilot-model"
          connection={connection}
          model={model}
          onChange={onModelChange}
          describedBy="copilot-model-hint"
        />
        <p id="copilot-model-hint" className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.modelHint')}</p>
      </div>
      <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t('copilot.usageHint')}</p>
      <p className="text-sm leading-6 text-[var(--brand-secondary)]">{t(hosted ? 'copilot.hostedPrivacy' : 'copilot.privacy')}</p>
    </div>
  );
}
