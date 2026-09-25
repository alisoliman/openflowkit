import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Layers, Activity, ArrowRight, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/SearchField';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import { useModalDialog } from '@/hooks/useModalDialog';
import { TemplateDiagramPreview } from '@/components/templates/TemplatePresentation';
import { type FlowTemplate, getFlowTemplates } from '@/services/templates';

const TEMPLATE_GRID_CLASS_NAME =
  'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

interface HomeTemplatesViewProps {
  onUseTemplate: (templateId: string) => void;
}

interface TemplatePreviewDialogProps {
  template: FlowTemplate;
  onClose: () => void;
  onUseTemplate: () => void;
}

interface TemplateCardProps {
  template: FlowTemplate;
  onSelect: () => void;
}

export function HomeTemplatesView({ onUseTemplate }: HomeTemplatesViewProps): React.ReactElement {
  const { t } = useTranslation();
  const templates = useMemo(() => getFlowTemplates(), []);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryItems = useMemo(
    () => [
      { id: 'all', label: t('homeTemplates.all', 'All templates'), count: templates.length },
      {
        id: 'featured',
        label: t('homeTemplates.featuredFilter', 'Featured'),
        count: templates.filter((template) => template.featured).length,
      },
      ...Array.from(new Set(templates.map((template) => template.category)))
        .sort()
        .map((category) => ({
          id: category,
          label:
            category === 'aws' || category === 'cncf'
              ? category.toUpperCase()
              : category.charAt(0).toUpperCase() + category.slice(1),
          count: templates.filter((template) => template.category === category).length,
        })),
    ],
    [t, templates]
  );
  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return templates.filter((template) => {
      if (activeCategory === 'featured' && !template.featured) return false;
      if (
        activeCategory !== 'all' &&
        activeCategory !== 'featured' &&
        template.category !== activeCategory
      )
        return false;
      return (
        !query ||
        [
          template.name,
          template.description,
          template.category,
          template.useCase,
          template.outcome,
          ...template.tags,
          ...template.replacementHints,
        ].some((value) => value.toLocaleLowerCase().includes(query))
      );
    });
  }, [templates, activeCategory, search]);

  function resetFilters(): void {
    setSearch('');
    setActiveCategory('all');
    searchRef.current?.focus();
  }
  const [selectedTemplate, setSelectedTemplate] = useState<FlowTemplate | null>(null);

  return (
    <div className="mx-auto w-full max-w-[1600px] flex-1 animate-in overflow-y-auto px-4 py-6 duration-300 fade-in sm:px-6 md:px-10 md:py-10">
      <div className="mb-8 flex flex-col gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-[var(--brand-text)]">
            {t('nav.templates', 'Templates')}
          </h1>
          <p className="max-w-3xl text-sm text-[var(--brand-secondary)]">
            {t(
              'homeTemplates.libraryDescription',
              'Find a starting point for your next idea. Every template is fully editable.'
            )}
          </p>
        </div>
      </div>

      <section aria-label={t('homeTemplates.browse', 'Browse templates')}>
        <div className="mb-5 max-w-xl">
          <SearchField
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('homeTemplates.search', 'Search templates, use cases, or technologies…')}
            aria-label={t('homeTemplates.search', 'Search templates, use cases, or technologies…')}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search) {
                event.stopPropagation();
                setSearch('');
              }
            }}
            trailingContent={
              search ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    searchRef.current?.focus();
                  }}
                  aria-label={t('home.clearSearch', 'Clear search')}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--brand-secondary)] hover:bg-[var(--brand-background)]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : undefined
            }
          />
        </div>
        <SegmentedTabs
          items={categoryItems}
          value={activeCategory}
          onChange={setActiveCategory}
          className="mb-6"
        />
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight text-[var(--brand-text)]">
            {activeCategory === 'featured'
              ? t('homeTemplates.featured', 'Featured Templates')
              : t('homeTemplates.library', 'Template library')}
          </h2>
          <span className="text-xs text-[var(--brand-secondary)]" role="status" aria-live="polite">
            {t('homeTemplates.count', '{{count}} templates', { count: filteredTemplates.length })}
          </span>
        </div>

        {filteredTemplates.length > 0 ? (
          <div className={TEMPLATE_GRID_CLASS_NAME}>
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => setSelectedTemplate(template)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-[var(--color-brand-border)] bg-[var(--brand-background)] px-6 py-14 text-center">
            <SearchX className="mb-4 h-8 w-8 text-[var(--brand-secondary)]" aria-hidden="true" />
            <h3 className="mb-2 text-base font-semibold text-[var(--brand-text)]">
              {t('homeTemplates.noResults', 'No matching templates')}
            </h3>
            <p className="mb-5 max-w-md text-sm text-[var(--brand-secondary)]">
              {t(
                'homeTemplates.searchHint',
                'Try a broader search or another category to find your starting point.'
              )}
            </p>
            <Button variant="secondary" onClick={resetFilters}>
              {t('homeTemplates.resetFilters', 'Reset filters')}
            </Button>
          </div>
        )}
      </section>

      {selectedTemplate ? (
        <TemplatePreviewDialog
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          onUseTemplate={() => onUseTemplate(selectedTemplate.id)}
        />
      ) : null}
    </div>
  );
}

function TemplatePreviewDialog({
  template,
  onClose,
  onUseTemplate,
}: TemplatePreviewDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const dialogRef = useModalDialog({ onClose, initialFocusRef: closeButtonRef });

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-preview-title"
        aria-describedby="template-preview-description"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[1080px] flex-col overflow-y-auto rounded-[24px] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-2xl lg:flex-row animate-in zoom-in-95 duration-200"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-brand-border)] bg-[var(--brand-surface)]/80 text-[var(--brand-secondary)] shadow-sm backdrop-blur-md transition-all hover:scale-105 hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)] hover:shadow"
          aria-label={t('homeTemplates.closePreview', 'Close template preview')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex w-full flex-col border-b border-[var(--color-brand-border)] bg-[var(--brand-surface)] z-10 lg:w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex-1 px-6 py-6 sm:px-8 lg:overflow-y-auto lg:py-8">
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center rounded-md bg-[var(--brand-primary)]/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--brand-primary)] ring-1 ring-inset ring-[var(--brand-primary)]/20">
                {template.category}
              </span>
              <div className="h-1 w-1 rounded-full bg-[var(--color-brand-border)]"></div>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--brand-secondary)]">
                <Layers className="h-3.5 w-3.5" />
                {t('homeTemplates.nodes', '{{count}} nodes', { count: template.nodes.length })}
              </span>
              <div className="h-1 w-1 rounded-full bg-[var(--color-brand-border)]"></div>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--brand-secondary)]">
                <Activity className="h-3.5 w-3.5" />
                {t('homeTemplates.edges', '{{count}} edges', { count: template.edges.length })}
              </span>
            </div>

            <h2
              id="template-preview-title"
              className="mb-4 break-words text-2xl font-semibold leading-[1.15] tracking-tight text-[var(--brand-text)]"
            >
              {template.name}
            </h2>
            <p
              id="template-preview-description"
              className="mb-8 text-[15px] leading-relaxed text-[var(--brand-secondary)]"
            >
              {template.description}
            </p>

            {template.replacementHints.length > 0 && (
              <div className="mb-8 rounded-2xl border border-[var(--brand-primary)]/20 bg-gradient-to-b from-[var(--brand-primary)]/[0.03] to-transparent p-5">
                <div className="mb-4 text-[12px] font-bold uppercase tracking-widest text-[var(--brand-primary)]">
                  {t('homeTemplates.bestFirstEdits', 'Best First Edits')}
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {template.replacementHints.slice(0, 5).map((hint) => (
                    <Pill key={hint}>{hint}</Pill>
                  ))}
                </div>
              </div>
            )}

            {template.useCase && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-text)]">
                  {t('homeTemplates.perfectFor', 'Perfect For')}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--brand-secondary)]">
                  {template.useCase}
                </p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 border-t border-[var(--color-brand-border)] bg-[var(--brand-surface)] p-5">
            <Button
              type="button"
              variant="primary"
              onClick={onUseTemplate}
              className="flex h-12 w-full items-center justify-center gap-2 text-[15px] font-semibold shadow-md transition-transform active:scale-[0.98]"
            >
              {t('homeTemplates.useTemplate', 'Use Template')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative order-first h-[220px] shrink-0 bg-[var(--brand-background)] sm:h-[280px] lg:order-none lg:h-auto lg:min-h-[480px] lg:flex-1">
          <div className="absolute inset-0 z-0 bg-[radial-gradient(var(--color-brand-border)_1px,transparent_1px)] [background-size:20px_20px] opacity-20 pointer-events-none"></div>
          <TemplateDiagramPreview template={template} />
        </div>
      </div>

      <button
        type="button"
        className="absolute inset-0 -z-10"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        aria-label={t('homeTemplates.closePreview', 'Close template preview')}
      />
    </div>,
    document.body
  );
}

function TemplateCard({ template, onSelect }: TemplateCardProps): React.ReactElement {
  const { t } = useTranslation();
  const metadata = [
    template.category,
    t('homeTemplates.nodes', '{{count}} nodes', { count: template.nodes.length }),
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-left transition-all duration-200 hover:border-[var(--brand-primary)]/50 hover:shadow-[var(--shadow-md)]"
    >
      <div className="relative h-[168px] w-full overflow-hidden border-b border-[color-mix(in_srgb,var(--color-brand-border),transparent_55%)] bg-[var(--brand-background)]">
        <TemplateDiagramPreview template={template} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-[var(--brand-text)] transition-colors group-hover:text-[var(--brand-primary)]">
          {template.name}
        </h3>
        <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-[var(--brand-secondary)]">
          {template.description}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-[var(--brand-secondary)]">
          <TemplateMetadataLine templateId={template.id} items={metadata} />
          <ArrowRight
            className="ml-auto h-4 w-4 text-[var(--brand-secondary)] transition-colors group-hover:text-[var(--brand-primary)]"
            aria-hidden="true"
          />
        </div>
      </div>
    </button>
  );
}

function TemplateMetadataLine({
  templateId,
  items,
}: {
  templateId: string;
  items: string[];
}): React.ReactElement {
  return (
    <>
      {items.map((item, index) => (
        <React.Fragment key={`${templateId}-${item}`}>
          {index > 0 ? (
            <div className="h-[3px] w-[3px] rounded-full bg-[color-mix(in_srgb,var(--brand-secondary),transparent_50%)]" />
          ) : null}
          <span className={index === 0 ? 'capitalize' : undefined}>{item}</span>
        </React.Fragment>
      ))}
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="inline-flex items-center rounded-lg border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3 py-1.5 text-xs font-medium text-[var(--brand-text)] shadow-sm transition-colors hover:border-[var(--brand-primary)]/40 hover:bg-[color-mix(in_srgb,var(--brand-primary),transparent_95%)] hover:text-[var(--brand-primary)]">
      {children}
    </span>
  );
}
