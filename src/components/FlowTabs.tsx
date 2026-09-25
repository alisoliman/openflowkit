import React, { useEffect, useId, useRef, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { IS_BEVELED } from '@/lib/brand';
import { useTranslation } from 'react-i18next';
import { getSegmentedTabButtonClass } from './ui/SegmentedTabs';
import type { EditorPage } from '@/store/editorPageHooks';

interface FlowTabsProps {
  pages: EditorPage[];
  activePageId: string;
  onSwitchPage: (pageId: string) => void;
  onAddPage: () => void;
  onClosePage: (pageId: string) => void;
  onRenamePage: (pageId: string, newName: string) => void;
  onReorderPage: (draggedPageId: string, targetPageId: string) => void;
}

export const FlowTabs: React.FC<FlowTabsProps> = ({
  pages,
  activePageId,
  onSwitchPage,
  onAddPage,
  onClosePage,
  onRenamePage,
  onReorderPage,
}) => {
  const { t } = useTranslation();
  const helpId = useId();
  const tabsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const editingTabIdRef = useRef<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTargetPageId, setDropTargetPageId] = useState<string | null>(null);
  useEffect(() => {
    tabsRef.current.get(activePageId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activePageId]);
  const activeTabClassName = `${getSegmentedTabButtonClass(true, 'sm')} h-10 border-[var(--brand-primary-200)] bg-[var(--brand-primary-50)] text-[var(--brand-primary)]`;
  const inactiveTabClassName = `${getSegmentedTabButtonClass(false, 'sm')} h-10 border-transparent bg-transparent text-[var(--brand-secondary)] hover:border-[var(--color-brand-border)] hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]`;

  function handleStartEdit(page: EditorPage): void {
    editingTabIdRef.current = page.id;
    setEditingTabId(page.id);
    setEditName(page.name);
  }

  function finishEdit(commit: boolean, restoreFocus: boolean): void {
    // Clear synchronously so the input's blur cannot commit again after Enter or Escape.
    const pageId = editingTabIdRef.current;
    editingTabIdRef.current = null;
    if (commit && pageId && editName.trim()) {
      onRenamePage(pageId, editName.trim());
    }
    setEditingTabId(null);
    setEditName('');
    if (restoreFocus && pageId) tabsRef.current.get(pageId)?.focus();
  }

  function focusPage(page: EditorPage): void {
    onSwitchPage(page.id);
    const tab = tabsRef.current.get(page.id);
    tab?.focus();
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>, page: EditorPage): void {
    // Keep tab navigation, rename and close key presses away from canvas shortcuts.
    event.stopPropagation();
    if (event.target !== event.currentTarget) return;
    const index = pages.findIndex((item) => item.id === page.id);
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (offset && event.altKey && event.shiftKey) {
      event.preventDefault();
      const target = pages[index + offset];
      if (target) onReorderPage(page.id, target.id);
      return;
    }
    if (offset) {
      event.preventDefault();
      focusPage(pages[(index + offset + pages.length) % pages.length]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusPage(pages[event.key === 'Home' ? 0 : pages.length - 1]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSwitchPage(page.id);
    } else if (event.key === 'F2') {
      event.preventDefault();
      handleStartEdit(page);
    }
  }

  function handleDrop(targetPageId: string): void {
    if (draggedPageId && draggedPageId !== targetPageId) {
      onReorderPage(draggedPageId, targetPageId);
    }
    setDraggedPageId(null);
    setDropTargetPageId(null);
  }

  return (
    <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1.5">
      <span id={helpId} className="sr-only">
        {t('flowTabs.keyboardHelp', 'Use arrow keys to switch pages, F2 to rename, and Alt+Shift+arrow keys to reorder.')}
      </span>
      <div
        role="tablist"
        aria-label={t('flowTabs.pages', 'Diagram pages')}
        className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto p-1 no-scrollbar"
      >
        {pages.map((page) => (
          <div
            key={page.id}
            ref={(element) => {
              if (element) tabsRef.current.set(page.id, element);
              else tabsRef.current.delete(page.id);
            }}
            data-testid="flow-page-tab"
            role="tab"
            tabIndex={activePageId === page.id ? 0 : -1}
            aria-label={page.name}
            aria-describedby={helpId}
            aria-selected={activePageId === page.id}
            className={`group relative flex cursor-pointer select-none items-center gap-1.5 !px-2 transition-colors ${
              dropTargetPageId === page.id && draggedPageId !== page.id ? 'ring-2 ring-[var(--brand-primary)] ring-offset-1 ring-offset-transparent' : ''
            } ${activePageId === page.id ? activeTabClassName : inactiveTabClassName}`}
            draggable={editingTabId !== page.id}
            onDragStart={() => setDraggedPageId(page.id)}
            onDragOver={(event) => {
              if (!draggedPageId || draggedPageId === page.id) return;
              event.preventDefault();
              setDropTargetPageId(page.id);
            }}
            onDragLeave={() => {
              if (dropTargetPageId === page.id) setDropTargetPageId(null);
            }}
            onDrop={(event) => { event.preventDefault(); handleDrop(page.id); }}
            onDragEnd={() => { setDraggedPageId(null); setDropTargetPageId(null); }}
            onClick={() => onSwitchPage(page.id)}
            onDoubleClick={() => handleStartEdit(page)}
            onKeyDown={(event) => handleTabKeyDown(event, page)}
            title={page.name}
          >
            {editingTabId === page.id ? (
              <input
                type="text"
                aria-label={t('flowTabs.pageName', 'Page name')}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                onBlur={() => finishEdit(true, false)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault();
                    finishEdit(event.key === 'Enter', true);
                  }
                }}
                className="h-7 w-28 rounded-[var(--radius-xs)] border border-[var(--brand-primary)] bg-[var(--brand-surface)] px-1.5 text-xs font-medium text-[var(--brand-text)] outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              />
            ) : (
              <span className="max-w-[100px] truncate text-xs sm:max-w-[160px]">{page.name}</span>
            )}
            {activePageId === page.id && editingTabId !== page.id && (
              <button
                type="button"
                aria-label={`${t('flowTabs.renamePage', 'Rename page')}: ${page.name}`}
                title={t('flowTabs.renamePageHint', 'Rename page (F2)')}
                onClick={(event) => { event.stopPropagation(); handleStartEdit(page); }}
                onDoubleClick={(event) => event.stopPropagation()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--brand-secondary)] hover:bg-[var(--brand-primary-100)] hover:text-[var(--brand-primary)]"
              >
                <Pencil aria-hidden="true" className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              aria-label={`${t('flowTabs.closeTab', 'Close page')}: ${page.name}`}
              title={t('flowTabs.closeTab', 'Close page')}
              onClick={(event) => { event.stopPropagation(); onClosePage(page.id); }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--brand-secondary)] transition-colors hover:bg-[var(--color-brand-border)] hover:text-[var(--brand-text)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAddPage}
        data-testid="flow-page-add"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-[var(--brand-secondary)] transition-colors hover:border-[var(--brand-primary-200)] hover:bg-[var(--brand-primary-50)] hover:text-[var(--brand-primary)] ${IS_BEVELED ? 'btn-beveled-secondary' : ''}`}
        title={t('flowTabs.newFlowTab', 'New page')}
        aria-label={t('flowTabs.newFlowTab', 'New page')}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
};
