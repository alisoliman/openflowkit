import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { AlertCircle, Copy, Download, Figma, FileCode, FileJson, FileText, Film, GitBranch, Image, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  type CinematicExportResolution,
  type CinematicExportSpeed,
} from '@/services/export/cinematicExport';
import { SegmentedChoice } from './properties/SegmentedChoice';
import { Button } from './ui/Button';
import { Select, type SelectOption } from './ui/Select';
import { getSegmentedTabButtonClass } from './ui/SegmentedTabs';

interface ExportMenuPanelProps {
  id?: string;
  onClose?: () => void;
  pendingAction?: { key: string; action: ExportActionKey } | null;
  errorMessage?: string | null;
  onClearError?: () => void;
  onSelect: (key: string, action: ExportActionKey, options?: ExportSelectionOptions) => void;
  cinematicSpeed?: CinematicExportSpeed;
  onCinematicSpeedChange?: (speed: CinematicExportSpeed) => void;
  cinematicResolution?: CinematicExportResolution;
  onCinematicResolutionChange?: (res: CinematicExportResolution) => void;
}

type ExportCategoryKey = 'image' | 'video' | 'code';
type ExportActionKey = 'download' | 'copy';

interface ExportSelectionOptions {
  transparentBackground?: boolean;
}

interface ExportOption {
  key: string;
  label: string;
  hint: string;
  Icon: ComponentType<{ className?: string }>;
  actions: ExportActionKey[];
}

interface ExportSection {
  key: ExportCategoryKey;
  title: string;
  items: ExportOption[];
}

const CINEMATIC_SPEED_ITEMS = [
  { id: 'slow', label: '0.5×' },
  { id: 'normal', label: '1×' },
  { id: 'fast', label: '2×' },
] as const;

const CINEMATIC_RESOLUTION_ITEMS = [
  { id: '720p', label: '720P' },
  { id: '1080p', label: '1080P' },
  { id: '4k', label: '4K' },
] as const;

function getSectionIcon(sectionKey: ExportCategoryKey): React.ReactElement {
  if (sectionKey === 'image') {
    return <Image className="h-3.5 w-3.5" />;
  }

  if (sectionKey === 'video') {
    return <Film className="h-3.5 w-3.5" />;
  }

  if (sectionKey === 'code') {
    return <FileCode className="h-3.5 w-3.5" />;
  }

  return <Image className="h-3.5 w-3.5" />;
}

function getDefaultOptionKey(section: ExportSection): string {
  return section.items[0]?.key ?? '';
}

function getInitialSelectedKeys(sections: ExportSection[]): Record<ExportCategoryKey, string> {
  return {
    image: getDefaultOptionKey(sections.find((section) => section.key === 'image') ?? sections[0]),
    video: getDefaultOptionKey(sections.find((section) => section.key === 'video') ?? sections[0]),
    code: getDefaultOptionKey(sections.find((section) => section.key === 'code') ?? sections[0]),
  };
}

function getActionIcon(actionKey: ExportActionKey): React.ReactElement {
  if (actionKey === 'download') {
    return <Download className="h-4 w-4" />;
  }

  return <Copy className="h-4 w-4" />;
}

function getActionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  action: ExportActionKey
): string {
  if (action === 'download') {
    return t('export.actionDownload', 'Download');
  }

  return t('export.actionCopy', 'Copy');
}

export function ExportMenuPanel({
  id,
  onClose,
  pendingAction = null,
  errorMessage,
  onClearError,
  onSelect,
  cinematicSpeed = 'normal',
  onCinematicSpeedChange,
  cinematicResolution = '1080p',
  onCinematicResolutionChange,
}: ExportMenuPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const headingId = useId();
  const contentId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const isPending = pendingAction !== null;
  useEffect(() => { panelRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus(); }, []);

  const sections = useMemo<ExportSection[]>(
    () => [
      {
        key: 'image',
        title: t('export.sectionImage', 'Image'),
        items: [
          {
            key: 'png',
            label: 'PNG',
            hint: t('export.hintPng', 'High-resolution image with optional transparency'),
            Icon: Image,
            actions: ['download', 'copy'],
          },
          {
            key: 'jpeg',
            label: 'JPG',
            hint: t('export.hintJpg', 'High-resolution image with a white background'),
            Icon: Image,
            actions: ['download', 'copy'],
          },
          {
            key: 'svg',
            label: 'SVG',
            hint: t('export.hintSvgScalable', 'Scalable vector file'),
            Icon: Image,
            actions: ['download', 'copy'],
          },
          {
            key: 'pdf',
            label: 'PDF',
            hint: t('export.hintPdf', 'Document for printing and sharing'),
            Icon: FileText,
            actions: ['download'],
          },
        ],
      },
      {
        key: 'video',
        title: t('export.sectionVideo', 'Video'),
        items: [
          {
            key: 'cinematic-video',
            label: t('export.cinematicVideo', 'Cinematic Build Video'),
            hint: t('export.hintCinematicVideo', 'Presentation-ready animated export'),
            Icon: Film,
            actions: ['download'],
          },
        ],
      },
      {
        key: 'code',
        title: t('export.sectionCode', 'Code'),
        items: [
          {
            key: 'json',
            label: t('export.jsonLabel', 'JSON File'),
            hint: t('export.hintJsonBackup', 'Editable diagram backup for this app'),
            Icon: FileJson,
            actions: ['download', 'copy'],
          },
          {
            key: 'openflow',
            label: t('export.openflowLabel', 'OpenFlow DSL'),
            hint: t('export.hintOpenflow', 'Native diagram source with layout and styling'),
            Icon: FileCode,
            actions: ['download', 'copy'],
          },
          {
            key: 'mermaid',
            label: t('export.mermaid', 'Mermaid'),
            hint: t('export.hintMermaid', 'Text source for Markdown and documentation'),
            Icon: GitBranch,
            actions: ['download', 'copy'],
          },
          {
            key: 'plantuml',
            label: t('export.plantuml', 'PlantUML'),
            hint: t('export.hintPlantuml', 'Text source for PlantUML tools'),
            Icon: FileCode,
            actions: ['download'],
          },
          {
            key: 'figma',
            label: t('export.figmaEditable', 'Figma Editable'),
            hint: t('export.hintEditableSvg', 'Editable SVG'),
            Icon: Figma,
            actions: ['download', 'copy'],
          },
        ],
      },
    ],
    [t]
  );

  const [activeSectionKey, setActiveSectionKey] = useState<ExportCategoryKey>('image');
  const [selectedKeys, setSelectedKeys] = useState<Record<ExportCategoryKey, string>>(() =>
    getInitialSelectedKeys(sections)
  );
  const [transparentBackground, setTransparentBackground] = useState(false);

  const activeSection = sections.find((section) => section.key === activeSectionKey) ?? sections[0];
  const selectedItem =
    activeSection.items.find((item) => item.key === selectedKeys[activeSectionKey]) ??
    activeSection.items[0];
  const shouldShowFormatSelect = activeSection.items.length > 1;
  const shouldShowTransparentBackgroundToggle =
    activeSectionKey === 'image' && selectedItem.key === 'png';
  const selectOptions: SelectOption[] = activeSection.items.map((item) => ({
    value: item.key,
    label: item.label,
    hint: item.hint,
  }));

  function handleSectionChange(nextTab: string): void {
    onClearError?.();
    setActiveSectionKey(nextTab as ExportCategoryKey);
  }

  function handleOptionChange(nextKey: string): void {
    onClearError?.();
    setSelectedKeys((current) => ({
      ...current,
      [activeSectionKey]: nextKey,
    }));
  }

  function handleCategoryKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = sections.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      handleSectionChange(sections[nextIndex].key);
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
    }
  }

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose?.(); }
      }}
      className="absolute right-0 top-full z-50 mt-2 flex max-h-[calc(100dvh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] origin-top-right flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-[var(--shadow-overlay)] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-brand-border)] px-4 py-3">
        <div>
          <h3 id={headingId} className="text-sm font-semibold text-[var(--brand-text)]">{t('export.exportDiagram', 'Export diagram')}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--brand-secondary)]">{t('export.subtitle', 'Choose a format and action.')}</p>
        </div>
        {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('export.close', 'Close export')} className="h-8 w-8 shrink-0"><X aria-hidden="true" className="h-4 w-4" /></Button>}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 custom-scrollbar">
        <div role="tablist" aria-label={t('export.category', 'Export category')} className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-1">
          {sections.map((section, index) => {
            const selected = activeSectionKey === section.key;
            return <button
              key={section.key}
              type="button"
              role="tab"
              id={`${contentId}-${section.key}-tab`}
              aria-selected={selected}
              aria-controls={`${contentId}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={isPending}
              onClick={() => handleSectionChange(section.key)}
              onKeyDown={(event) => handleCategoryKeyDown(event, index)}
              className={`${getSegmentedTabButtonClass(selected, 'md', true)} ${selected ? 'border-[var(--brand-primary-200)] bg-[var(--brand-surface)] text-[var(--brand-primary)] shadow-sm' : 'border-transparent text-[var(--brand-secondary)] hover:text-[var(--brand-text)]'}`}
            >
              <span aria-hidden="true">{getSectionIcon(section.key)}</span>{section.title}
            </button>;
          })}
        </div>
        <fieldset disabled={isPending} className="mt-4 min-w-0 border-0 p-0">
          <div id={`${contentId}-panel`} role="tabpanel" aria-labelledby={`${contentId}-${activeSectionKey}-tab`}>
        {shouldShowFormatSelect ? (
          <div data-testid="export-format-select">
            <label htmlFor={`${contentId}-format`} className="mb-2 block text-xs font-medium text-[var(--brand-text)]">{t('export.format', 'Format')}</label>
            <Select
              id={`${contentId}-format`}
              aria-label={t('export.format', 'Format')}
              disabled={isPending}
              value={selectedItem.key}
              onChange={handleOptionChange}
              options={selectOptions}
              placeholder={t('export.chooseFormat', 'Choose format')}
            />
          </div>
        ) : (
          <div
            data-testid="export-format-summary"
            className="rounded-[var(--radius-md)] border border-[var(--color-brand-border)]/70 bg-[var(--brand-surface)]/80 px-3 py-2.5"
          >
            <p className="text-sm font-medium text-[var(--brand-text)]">{selectedItem.label}</p>
            <p className="mt-1 text-xs text-[var(--brand-secondary)]">{selectedItem.hint}</p>
          </div>
        )}

        {shouldShowTransparentBackgroundToggle ? (
          <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium text-[var(--brand-text)]">
            <input
              type="checkbox"
              checked={transparentBackground}
              onChange={(event) => setTransparentBackground(event.target.checked)}
              className="h-4 w-4 rounded border border-[var(--color-brand-border)] text-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              aria-label={t('export.transparentBackground', 'Transparent background')}
            />
            <span>{t('export.transparentBackground', 'Transparent background')}</span>
          </label>
        ) : null}

        {activeSectionKey === 'video' && onCinematicSpeedChange && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-secondary)] mb-1.5">
              {t('export.speed', 'Speed')}
            </p>
            <SegmentedChoice
              selectedId={cinematicSpeed}
              onSelect={(speed) => onCinematicSpeedChange(speed as CinematicExportSpeed)}
              items={CINEMATIC_SPEED_ITEMS}
              columns={3}
              size="sm"
            />
          </div>
        )}

        {activeSectionKey === 'video' && onCinematicResolutionChange && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-secondary)] mb-1.5">
              {t('export.resolution', 'Resolution')}
            </p>
            <SegmentedChoice
              selectedId={cinematicResolution}
              onSelect={(res) => onCinematicResolutionChange(res as CinematicExportResolution)}
              items={CINEMATIC_RESOLUTION_ITEMS}
              columns={3}
              size="sm"
            />
          </div>
        )}

        <div
          className={`mt-3 grid gap-2 ${selectedItem.actions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
        >
          {selectedItem.actions.map((action) => (
            <Button
              key={`${selectedItem.key}-${action}`}
              type="button"
              variant={action === 'download' ? 'primary' : 'secondary'}
              onClick={() =>
                onSelect(selectedItem.key, action, {
                  transparentBackground:
                    selectedItem.key === 'png' ? transparentBackground : undefined,
                })
              }
              data-testid={`export-action-${selectedItem.key}-${action}`}
              aria-label={`${getActionLabel(t, action)} ${selectedItem.label}`}
              isLoading={pendingAction?.key === selectedItem.key && pendingAction.action === action}
              disabled={isPending}
              className="h-11 w-full"
            >
              {!isPending && <span aria-hidden="true">{getActionIcon(action)}</span>}
              {pendingAction?.key === selectedItem.key && pendingAction.action === action ? t('export.preparing', 'Preparing…') : getActionLabel(t, action)}
            </Button>
          ))}
        </div>
          </div>
        </fieldset>
        {isPending && <p role="status" className="mt-3 text-xs leading-5 text-[var(--brand-secondary)]">{t('export.preparingHelp', 'Preparing your export. You can close this panel while it finishes.')}</p>}
        {errorMessage && <div role="alert" className="mt-3 flex gap-2 rounded-[var(--radius-md)] border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-[var(--brand-text)]"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p>{errorMessage}</p></div>}
      </div>
    </div>
  );
}
