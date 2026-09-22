import React from 'react';
import { useTranslation } from 'react-i18next';
import { MCPFlowVisual } from './MCPFlowVisual';
import { MCPSettings } from '../SettingsModal/MCPSettings';
import { CopilotIcon } from '../icons/CopilotIcon';

export function HomeMCPView(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      data-testid="mcp-page"
      className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-10 md:py-10"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 max-w-3xl">
          <div className="mb-3 flex items-center gap-3 text-[var(--brand-text)]">
            <CopilotIcon className="h-9 w-9 sm:h-10 sm:w-10" />
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('mcp.pageTitle', 'Diagram with GitHub Copilot')}
            </h1>
          </div>
          <p className="max-w-[70ch] text-sm leading-relaxed text-[var(--brand-secondary)]">
            {t(
              'mcp.pageSubtitle',
              'Give GitHub Copilot App and CLI the tools to turn prompts and code into editable diagrams. Other MCP clients work here, too.'
            )}
          </p>
        </header>

        <div className="mb-8">
          <MCPFlowVisual />
        </div>

        <MCPSettings variant="page" />
      </div>
    </div>
  );
}
