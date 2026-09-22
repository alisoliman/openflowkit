import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CopilotConnectionState } from '@/services/copilot/client';
import { EDITOR_FIELD_DEFAULT_CLASS } from '@/components/ui/editorFieldStyles';

interface CopilotModelSelectProps {
  id: string;
  connection: CopilotConnectionState;
  model: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  describedBy?: string;
}

export function CopilotModelSelect({
  id, connection, model, onChange, disabled, describedBy,
}: CopilotModelSelectProps): ReactElement {
  const { t } = useTranslation();
  const status = connection.state === 'ready' ? connection.status : undefined;
  const models = status?.models ?? [];
  const missingModel = model !== 'auto' && !models.some((candidate) => candidate.id === model);
  return (
    <select
      id={id}
      value={model}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !status?.authenticated}
      aria-describedby={describedBy}
      className={`${EDITOR_FIELD_DEFAULT_CLASS} min-w-0 px-3 py-2.5 disabled:opacity-60`}
    >
      <option value="auto">{t('copilot.defaultModel')}</option>
      {missingModel && <option value={model} disabled>{model} ({t('copilot.unavailableModel')})</option>}
      {models.filter((candidate) => candidate.id !== 'auto').map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.name}{candidate.multiplier !== undefined ? ` (${candidate.multiplier}x)` : ''}
        </option>
      ))}
    </select>
  );
}
