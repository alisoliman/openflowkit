import React, { useMemo, useRef, useState } from 'react';
import {
  Copy,
  Layout,
  WandSparkles,
  Pencil,
  Plus,
  Trash2,
  LayoutTemplate,
  FileInput,
  ShieldCheck,
  SearchX,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Tooltip } from '../Tooltip';
import { SearchField } from '../ui/SearchField';
import { WorkspaceDiagramPreview } from './WorkspaceDiagramPreview';
import type { WorkspaceDocumentPreview } from '@/store/workspaceDocumentModel';
import { recordOnboardingEvent } from '@/services/onboarding/events';

export interface HomeFlowCard {
  id: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt?: string;
  isActive?: boolean;
  preview: WorkspaceDocumentPreview | null;
}

interface HomeDashboardProps {
  flows: HomeFlowCard[];
  createButtonRef?: React.Ref<HTMLButtonElement>;
  onCreateNew: () => void;
  onOpenTemplates: () => void;
  onPromptWithAI: () => void;
  onImportJSON: () => void;
  onOpenFlow: (flowId: string) => void;
  onRenameFlow: (flowId: string) => void;
  onDuplicateFlow: (flowId: string) => void;
  onDeleteFlow: (flowId: string) => void;
}

export function HomeDashboard({
  flows,
  createButtonRef,
  onCreateNew,
  onOpenTemplates,
  onPromptWithAI,
  onImportJSON,
  onOpenFlow,
  onRenameFlow,
  onDuplicateFlow,
  onDeleteFlow,
}: HomeDashboardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const hasFlows = flows.length > 0;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleFlows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return flows
      .filter((flow) => !query || flow.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        if (sort === 'name') return left.name.localeCompare(right.name);
        return (Date.parse(right.updatedAt ?? '') || 0) - (Date.parse(left.updatedAt ?? '') || 0);
      });
  }, [flows, search, sort]);

  function clearSearch(): void {
    setSearch('');
    searchRef.current?.focus();
  }
  const secondaryActionIconClass =
    'h-4 w-4 text-[var(--brand-secondary)] transition-transform duration-300 group-hover:scale-110';

  function handleCreateNew(): void {
    recordOnboardingEvent('welcome_blank_selected', { source: 'home-dashboard' });
    onCreateNew();
  }

  function handlePromptWithAI(): void {
    recordOnboardingEvent('welcome_prompt_selected', { source: 'home-dashboard' });
    onPromptWithAI();
  }

  function handleImportJSON(): void {
    recordOnboardingEvent('welcome_import_selected', { source: 'home-dashboard' });
    onImportJSON();
  }

  function handleOpenTemplates(): void {
    recordOnboardingEvent('welcome_template_selected', { source: 'home-dashboard' });
    onOpenTemplates();
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] flex-1 overflow-y-auto px-4 py-6 animate-in fade-in duration-300 sm:px-6 md:px-10 md:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-text)] tracking-tight mb-1">
            {t('home.workspaceTitle', 'Your workspace')}
          </h1>
          <p className="text-[var(--brand-secondary)] text-sm">
            {t(
              'home.workspaceDescription',
              'A place for your ideas, systems, and the connections between them.'
            )}
          </p>
        </div>
        <Button
          ref={createButtonRef}
          onClick={handleCreateNew}
          data-testid="home-create-new-header"
          variant="primary"
          size="md"
          className="self-start sm:shrink-0"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          {t('home.createNew', 'Create new')}
        </Button>
      </div>

      {hasFlows && (
        <div className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QuickStartAction
            icon={<WandSparkles className="h-5 w-5" />}
            title={t('home.homeFlowpilotAI', 'Flowpilot AI')}
            description={t('home.aiActionDescription', 'Describe an idea. Build it together.')}
            testId="home-generate-with-ai"
            onClick={handlePromptWithAI}
          />
          <QuickStartAction
            icon={<LayoutTemplate className="h-5 w-5" />}
            title={t('home.homeTemplates', 'Templates')}
            description={t('home.templateActionDescription', 'Start with a ready-to-edit diagram.')}
            testId="home-open-templates"
            onClick={handleOpenTemplates}
          />
          <QuickStartAction
            icon={<FileInput className="h-5 w-5" />}
            title={t('home.importFile', 'Import a file')}
            description={t('home.importActionDescription', 'Bring an existing diagram with you.')}
            testId="home-import-file"
            onClick={handleImportJSON}
          />
        </div>
      )}

      <section aria-labelledby="home-files-heading">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2">
            <h2
              id="home-files-heading"
              className="text-base font-semibold tracking-tight text-[var(--brand-text)]"
            >
              {t('home.yourDiagrams', 'Your diagrams')}
            </h2>
            <Tooltip
              text={t(
                'home.localSaveHint',
                'Diagrams are saved in this browser. Export a backup to keep a separate copy.'
              )}
              side="right"
            >
              <button
                type="button"
                aria-label={t('home.localSaveLabel', 'About local saving')}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          {hasFlows && (
            <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
              <div className="w-full sm:max-w-sm xl:w-64">
                <SearchField
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('home.searchDiagrams', 'Search diagrams…')}
                  aria-label={t('home.searchDiagrams', 'Search diagrams…')}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && search) {
                      event.stopPropagation();
                      clearSearch();
                    }
                  }}
                  trailingContent={
                    search ? (
                      <button
                        type="button"
                        onClick={clearSearch}
                        aria-label={t('home.clearSearch', 'Clear search')}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--brand-secondary)] hover:bg-[var(--brand-background)]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : undefined
                  }
                />
              </div>
              <label className="flex h-11 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3 text-sm text-[var(--brand-secondary)]">
                <span className="sr-only">{t('home.sortDiagrams', 'Sort diagrams')}</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  className="h-full w-full cursor-pointer bg-transparent text-sm text-[var(--brand-text)] outline-none"
                >
                  <option value="recent">{t('home.sortRecent', 'Last edited')}</option>
                  <option value="name">{t('home.sortName', 'Name, A–Z')}</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {!hasFlows ? (
          <div
            className="flex w-full flex-col py-2 sm:py-6 animate-in fade-in zoom-in-[0.99] duration-700"
            data-testid="home-empty-state"
          >
            <div className="relative overflow-hidden w-full max-w-[840px] mx-auto rounded-[24px] bg-[var(--brand-surface)] border border-[var(--color-brand-border)]/80 shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
              {/* Super-delicate background gradient inside card */}
              <div className="absolute top-0 left-0 w-full h-[140px] bg-gradient-to-b from-[var(--brand-background)] to-[var(--brand-surface)] pointer-events-none"></div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[120px] bg-[var(--brand-primary)]/5 blur-[50px] rounded-full pointer-events-none"></div>

              <div className="relative z-10 flex flex-col items-center px-6 py-10 text-center">
                {/* Sleek Icon */}
                <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[var(--brand-surface)] shadow-[0_4px_16px_rgba(0,0,0,0.04)] border border-[var(--color-brand-border)]/60 mb-5 relative group cursor-default">
                  <div className="absolute inset-0 bg-[var(--brand-primary)]/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-[18px]"></div>
                  <Layout
                    className="w-8 h-8 text-[var(--brand-primary)] transition-transform group-hover:scale-105 duration-500"
                    strokeWidth={1.5}
                  />
                </div>

                <h2 className="text-[24px] sm:text-[28px] font-bold tracking-tight text-[var(--brand-text)] mb-2">
                  {t('home.homeEmptyTitle', 'Create your first flow')}
                </h2>
                <p className="text-[14px] text-[var(--brand-secondary)] max-w-[500px] mb-8 leading-relaxed">
                  {t(
                    'home.firstDiagramDescription',
                    'Start from a blank canvas, turn an idea into a diagram with AI, or make a template your own.'
                  )}
                </p>

                {/* Action Grid strictly inside the card */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-[640px]">
                  <Button
                    onClick={handleCreateNew}
                    data-testid="home-create-new-main"
                    variant="primary"
                    size="lg"
                    className="w-full text-[14.5px]"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />{' '}
                    {t('home.homeBlankCanvas', 'Blank Canvas')}
                  </Button>

                  <Button
                    onClick={handlePromptWithAI}
                    data-testid="home-generate-with-ai"
                    variant="secondary"
                    size="lg"
                    className="w-full text-[14.5px] group"
                  >
                    <WandSparkles className={secondaryActionIconClass} strokeWidth={2} />{' '}
                    {t('home.homeFlowpilotAI', 'Flowpilot AI')}
                  </Button>

                  <Button
                    onClick={handleOpenTemplates}
                    data-testid="home-open-templates"
                    variant="secondary"
                    size="lg"
                    className="w-full text-[14.5px]"
                  >
                    <LayoutTemplate className={secondaryActionIconClass} strokeWidth={2} />{' '}
                    {t('home.homeTemplates', 'Templates')}
                  </Button>
                </div>

                <div className="mt-8 flex items-center justify-center pt-6 border-t border-[var(--color-brand-border)]/60 w-full max-w-[640px]">
                  <ImportExistingFileButton
                    label={t('home.homeImportFile', 'Or import an existing file')}
                    onClick={handleImportJSON}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : visibleFlows.length === 0 ? (
          <div
            className="flex flex-col items-center rounded-2xl border border-dashed border-[var(--color-brand-border)] bg-[var(--brand-background)] px-6 py-14 text-center"
            role="status"
          >
            <SearchX className="mb-4 h-8 w-8 text-[var(--brand-secondary)]" aria-hidden="true" />
            <h3 className="mb-2 text-base font-semibold text-[var(--brand-text)]">
              {t('home.noMatchingDiagrams', 'No matching diagrams')}
            </h3>
            <p className="mb-5 max-w-sm break-words text-sm text-[var(--brand-secondary)]">
              {t(
                'home.searchHint',
                'Try a different name, or clear your search to see all diagrams.'
              )}
            </p>
            <Button variant="secondary" onClick={clearSearch}>
              {t('home.clearSearch', 'Clear search')}
            </Button>
          </div>
        ) : (
          <>
            <p
              className="mb-4 text-xs text-[var(--brand-secondary)]"
              role="status"
              aria-live="polite"
            >
              {t('home.diagramCount', '{{count}} diagrams', { count: visibleFlows.length })}
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleFlows.map((flow) => (
                <article
                  key={flow.id}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 290px' }}
                  className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-brand-border)] bg-[var(--brand-surface)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)] focus-within:border-[var(--brand-primary)]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenFlow(flow.id)}
                    aria-label={t('home.openDiagram', 'Open {{name}}', { name: flow.name })}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                  >
                    <div className="relative flex h-40 w-full items-center justify-center overflow-hidden border-b border-[var(--color-brand-border)] bg-[var(--brand-background)]">
                      {flow.preview && flow.preview.nodes.length > 0 ? (
                        <WorkspaceDiagramPreview preview={flow.preview} />
                      ) : (
                        <EmptyFlowPreview />
                      )}
                      {flow.isActive && (
                        <span className="absolute left-3 top-3 rounded-full border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-2.5 py-1 text-xs font-medium text-[var(--brand-secondary)]">
                          {t('home.currentFlow', 'Current')}
                        </span>
                      )}
                    </div>
                    <div className="p-4 pb-3">
                      <h3
                        title={flow.name}
                        className="mb-2 truncate text-sm font-semibold tracking-tight text-[var(--brand-text)] transition-colors group-hover:text-[var(--brand-primary)]"
                      >
                        {flow.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--brand-secondary)]">
                        <span>
                          {formatUpdatedAt(
                            flow.updatedAt,
                            i18n?.language,
                            t('home.autosaved', 'Autosaved')
                          )}
                        </span>
                        <span>
                          {t('home.nodeCount', '{{count}} nodes', { count: flow.nodeCount })}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div
                    className="flex items-center justify-end gap-1 border-t border-[var(--color-brand-border)] px-2 py-1.5"
                    aria-label={flow.name}
                  >
                    <FlowCardActionButton
                      label={t('common.rename', 'Rename')}
                      onClick={() => onRenameFlow(flow.id)}
                      hoverClassName="hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-primary)] focus-visible:ring-[var(--brand-primary)]"
                    >
                      <Pencil className="h-4 w-4" />
                    </FlowCardActionButton>
                    <FlowCardActionButton
                      label={t('common.duplicate', 'Duplicate')}
                      onClick={() => onDuplicateFlow(flow.id)}
                      hoverClassName="hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-primary)] focus-visible:ring-[var(--brand-primary)]"
                    >
                      <Copy className="h-4 w-4" />
                    </FlowCardActionButton>
                    <FlowCardActionButton
                      label={t('common.delete', 'Delete')}
                      onClick={() => onDeleteFlow(flow.id)}
                      hoverClassName="hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </FlowCardActionButton>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function formatUpdatedAt(
  updatedAt: string | undefined,
  locale: string | undefined,
  autosavedLabel: string
): string {
  if (!updatedAt) {
    return autosavedLabel;
  }

  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return autosavedLabel;
  }

  const date = new Date(parsed);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

interface ImportExistingFileButtonProps {
  label: string;
  onClick: () => void;
}

function ImportExistingFileButton({
  label,
  onClick,
}: ImportExistingFileButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--brand-secondary)] transition-colors hover:text-[var(--brand-text)] focus:outline-none focus-visible:underline"
    >
      <FileInput className="w-[14px] h-[14px]" />
      {label}
    </button>
  );
}

interface FlowCardActionButtonProps {
  children: React.ReactNode;
  hoverClassName: string;
  label: string;
  onClick: () => void;
}

function FlowCardActionButton({
  children,
  hoverClassName,
  label,
  onClick,
}: FlowCardActionButtonProps): React.ReactElement {
  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onClick();
  }

  return (
    <Tooltip text={label} side="bottom">
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        className={`flex h-11 w-11 items-center justify-center rounded-lg text-[var(--brand-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 ${hoverClassName}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function EmptyFlowPreview(): React.ReactElement {
  return (
    <>
      <div
        className="absolute inset-0 dark:hidden opacity-[0.05] transition-opacity duration-300 group-hover:opacity-[0.15]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--brand-secondary) 1px, transparent 0)',
          backgroundSize: '12px 12px',
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block opacity-[0.3] transition-opacity duration-300 group-hover:opacity-[0.4]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--color-brand-border) 1px, transparent 0)',
          backgroundSize: '12px 12px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,var(--brand-background)_120%)]" />
      <div className="z-10 flex h-10 w-10 items-center justify-center rounded-[10px] border border-[color-mix(in_srgb,var(--color-brand-border),transparent_50%)] bg-[var(--brand-surface)] text-[var(--brand-secondary)] shadow-sm transition-all duration-300 group-hover:scale-105 group-hover:border-[var(--brand-primary-400)]/40 group-hover:text-[var(--brand-primary)] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
        <Layout className="w-4 h-4" />
      </div>
    </>
  );
}

function QuickStartAction({
  icon,
  title,
  description,
  testId,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  testId: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-4 text-left transition-colors hover:border-[var(--brand-primary)]/40 hover:bg-[var(--brand-primary)]/5"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-[var(--brand-primary)]"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--brand-text)]">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-[var(--brand-secondary)]">
          {description}
        </span>
      </span>
      <ArrowUpRight
        className="h-4 w-4 shrink-0 text-[var(--brand-secondary)] transition-colors group-hover:text-[var(--brand-primary)]"
        aria-hidden="true"
      />
    </button>
  );
}
