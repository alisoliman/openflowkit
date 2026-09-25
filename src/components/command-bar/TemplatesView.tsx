import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Layout, SearchX, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useTranslation } from 'react-i18next';
import { SearchField } from '../ui/SearchField';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import { ViewHeader } from './ViewHeader';
import { TemplateDiagramPreview } from '@/components/templates/TemplatePresentation';
import { getFlowTemplates, type FlowTemplate } from '@/services/templates';

interface TemplatesViewProps {
  onSelectTemplate?: (t: FlowTemplate) => void;
  onClose: () => void;
  handleBack: () => void;
}

export const TemplatesView = ({
  onSelectTemplate,
  onClose,
  handleBack,
}: TemplatesViewProps): React.ReactElement => {
  const { t } = useTranslation();
  const [tSearch, setTSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);
  const [activeCategory, setActiveCategory] = useState('all');
  const templates = useMemo(() => getFlowTemplates(), []);
  const categories = useMemo(
    () =>
      Array.from(new Set(templates.map((template) => template.category))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [templates]
  );

  const handleSelect = (template: FlowTemplate) => {
    onSelectTemplate?.(template);
    onClose();
  };

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = tSearch.trim().toLowerCase();
    return templates.filter((template) => {
      if (activeCategory !== 'all' && template.category !== activeCategory) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        template.name.toLowerCase().includes(normalizedSearch) ||
        template.description.toLowerCase().includes(normalizedSearch) ||
        template.useCase.toLowerCase().includes(normalizedSearch) ||
        template.outcome.toLowerCase().includes(normalizedSearch) ||
        template.category.toLowerCase().includes(normalizedSearch) ||
        template.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch)) ||
        template.replacementHints.some((hint) => hint.toLowerCase().includes(normalizedSearch))
      );
    });
  }, [activeCategory, tSearch, templates]);

  const categoryItems = useMemo(
    () => [
      { id: 'all', label: t('homeTemplates.all', 'All templates'), count: templates.length },
      ...categories.map((category) => ({
        id: category,
        label: category.toUpperCase(),
        count: templates.filter((template) => template.category === category).length,
      })),
    ],
    [categories, t, templates]
  );

  function resetFilters(): void {
    setTSearch('');
    setActiveCategory('all');
    searchRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.08),_transparent_48%)]">
      <ViewHeader
        title={t('commandBar.templates.title')}
        icon={<Layout className="h-4 w-4 text-[var(--brand-primary)]" />}
        description={t(
          'homeTemplates.libraryDescription',
          'Find a starting point for your next idea. Every template is fully editable.'
        )}
        onBack={handleBack}
        onClose={onClose}
      />

      <div className="border-b border-[var(--color-brand-border)]/70 bg-[var(--brand-surface)]/90 px-4 py-3 backdrop-blur-sm">
        <SearchField
          ref={searchRef}
          value={tSearch}
          onChange={(e) => setTSearch(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && tSearch) {
              event.stopPropagation();
              setTSearch('');
            }
          }}
          placeholder={t('commandBar.templates.placeholder')}
          aria-label={t('homeTemplates.search', 'Search templates, use cases, or technologies…')}
          trailingContent={
            tSearch ? (
              <button
                type="button"
                onClick={() => {
                  setTSearch('');
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

        <SegmentedTabs
          items={categoryItems}
          value={activeCategory}
          onChange={setActiveCategory}
          className="mt-3 -mx-1"
          listClassName="px-1"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        <p className="mb-3 text-xs text-[var(--brand-secondary)]" role="status" aria-live="polite">
          {t('homeTemplates.count', '{{count}} templates', { count: filteredTemplates.length })}
        </p>
        {filteredTemplates.length > 0 ? (
          <div className="space-y-3">
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handleSelect(template)}
                className="group flex w-full items-stretch overflow-hidden rounded-xl border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-left transition-all duration-200 hover:border-[var(--brand-primary-300)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              >
                <div className="relative hidden min-h-[130px] w-[140px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-brand-border),transparent_50%)] bg-[var(--brand-background)] sm:block">
                  <TemplateDiagramPreview template={template} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <div className="mb-1.5 text-sm font-semibold text-[var(--brand-text)] group-hover:text-[var(--brand-primary)]">
                    {template.name}
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-[var(--brand-secondary)]">
                    {template.description}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-[var(--brand-secondary)]">
                    <span className="capitalize">{template.category}</span>
                    <div className="h-[3px] w-[3px] rounded-full bg-[color-mix(in_srgb,var(--brand-secondary),transparent_50%)]" />
                    <span>
                      {t('homeTemplates.nodes', '{{count}} nodes', {
                        count: template.nodes.length,
                      })}
                    </span>
                    <ArrowRight
                      className="ml-auto h-4 w-4 text-[var(--brand-secondary)] group-hover:text-[var(--brand-primary)]"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
        {filteredTemplates.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-4 py-10 text-center">
            <SearchX className="mb-3 h-7 w-7 text-[var(--brand-secondary)]" aria-hidden="true" />
            <p className="mb-2 text-sm font-semibold text-[var(--brand-text)]">
              {t('homeTemplates.noResults', 'No matching templates')}
            </p>
            <p className="mb-5 max-w-sm text-xs leading-relaxed text-[var(--brand-secondary)]">
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
      </div>
    </div>
  );
};
