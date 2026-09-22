import React from 'react';
import { AppWindow, ArrowRight, Terminal, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OpenFlowLogo } from '../icons/OpenFlowLogo';

export function MCPFlowVisual(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <figure
      aria-label={t(
        'mcp.visualAlt',
        'GitHub Copilot App and CLI connect to local OpenFlowKit MCP tools to create editable diagrams.'
      )}
      className="border-y border-[var(--color-brand-border)] py-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="flex gap-1 text-[var(--brand-secondary)]">
            <AppWindow className="h-5 w-5" />
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--brand-text)]">GitHub Copilot</p>
            <p className="text-xs text-[var(--brand-secondary)]">
              {t('mcp.visualClients', 'App and CLI')}
            </p>
          </div>
        </div>

        <ArrowRight
          aria-hidden="true"
          className="ml-3 h-4 w-4 shrink-0 rotate-90 text-[var(--brand-secondary)] sm:ml-0 sm:rotate-0"
        />

        <div className="flex items-center gap-3">
          <OpenFlowLogo className="h-8 w-8 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-[var(--brand-text)]">OpenFlowKit MCP</p>
            <p className="text-xs text-[var(--brand-secondary)]">
              {t('mcp.visualServer', 'Local diagramming tools')}
            </p>
          </div>
        </div>

        <ArrowRight
          aria-hidden="true"
          className="ml-3 h-4 w-4 shrink-0 rotate-90 text-[var(--brand-secondary)] sm:ml-0 sm:rotate-0"
        />

        <div className="flex items-center gap-3">
          <Workflow aria-hidden="true" className="h-8 w-8 shrink-0 text-[var(--brand-text)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--brand-text)]">
              {t('mcp.visualResult', 'Editable diagrams')}
            </p>
            <p className="text-xs text-[var(--brand-secondary)]">
              {t('mcp.visualResultHint', 'Validate, preview, share')}
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-xs leading-relaxed text-[var(--brand-secondary)]">
        {t(
          'mcp.visualCaption',
          'Tools run locally over stdio. Your AI client handles model requests. No OpenFlowKit API key required.'
        )}
      </figcaption>
    </figure>
  );
}
