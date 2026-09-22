import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramChange, DiagramChangeSummary } from '@/services/flowpilot/types';

export function FlowpilotChangeSummary({ changes, compact = false }: {
  changes: DiagramChangeSummary;
  compact?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const counts = [
    changes.addedCount ? t('flowpilot.nodesAdded', { count: changes.addedCount, defaultValue: 'Nodes added: {{count}}' }) : '',
    changes.updatedCount ? t('flowpilot.nodesUpdated', { count: changes.updatedCount, defaultValue: 'Nodes changed: {{count}}' }) : '',
    changes.removedCount ? t('flowpilot.nodesRemoved', { count: changes.removedCount, defaultValue: 'Nodes removed: {{count}}' }) : '',
    changes.addedEdgeCount ? t('flowpilot.edgesAdded', { count: changes.addedEdgeCount, defaultValue: 'Connections added: {{count}}' }) : '',
    changes.updatedEdgeCount ? t('flowpilot.edgesUpdated', { count: changes.updatedEdgeCount, defaultValue: 'Connections changed: {{count}}' }) : '',
    changes.removedEdgeCount ? t('flowpilot.edgesRemoved', { count: changes.removedEdgeCount, defaultValue: 'Connections removed: {{count}}' }) : '',
  ].filter(Boolean);

  function describe(change: DiagramChange): string {
    if (change.previousLabel) {
      return t('flowpilot.renamed', { before: change.previousLabel, after: change.label, defaultValue: 'Renamed "{{before}}" to "{{after}}"' });
    }
    const action = change.status === 'added' ? t('flowpilot.added', 'Added')
      : change.status === 'removed' ? t('flowpilot.removed', 'Removed')
        : t('flowpilot.updated', 'Updated');
    return `${action}: ${change.label}`;
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs leading-5 text-[var(--brand-secondary)]">{counts.join(' · ') || t('flowpilot.noChanges', 'No changes')}</p>
      {!compact && (
        <>
          <ul className="space-y-1.5 break-words">
            {changes.details.slice(0, 6).map((change, index) => <li key={index}>{describe(change)}</li>)}
          </ul>
          {changes.details.length > 6 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--brand-secondary)]">
                {t('flowpilot.moreChanges', { count: changes.details.length - 6, defaultValue: 'Show {{count}} more changes' })}
              </summary>
              <ul className="mt-2 space-y-1.5 break-words">
                {changes.details.slice(6).map((change, index) => <li key={index}>{describe(change)}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
