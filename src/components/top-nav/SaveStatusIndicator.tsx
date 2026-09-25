import React from 'react';
import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../Tooltip';

interface SaveStatusIndicatorProps {
  showPrivacyMessage?: boolean;
}

export function SaveStatusIndicator({
  showPrivacyMessage = true,
}: SaveStatusIndicatorProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t('nav.localStorage', 'Local storage');
  const tooltipText = showPrivacyMessage
    ? t('nav.localStorageHelp', 'Diagrams are stored in this browser. Export a copy to keep a backup. Content you share or send to AI is handled by the service you choose.')
    : t('nav.localStorageBackup', 'Diagrams are stored in this browser. Export a copy to keep a backup.');

  return (
    <Tooltip text={tooltipText} side="bottom" contentClassName="max-w-[280px] whitespace-normal text-left leading-relaxed">
      <span
        tabIndex={0}
        role="note"
        aria-label={`${label}. ${tooltipText}`}
        className="flex h-8 cursor-default items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 text-[var(--brand-secondary)]"
      >
        <HardDrive aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="hidden text-[11px] font-medium xl:inline">{label}</span>
      </span>
    </Tooltip>
  );
}
