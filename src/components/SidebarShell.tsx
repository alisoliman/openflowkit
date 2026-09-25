import React, { createContext, useContext, useId } from 'react';
import { handleTabNavigation } from './ui/SegmentedTabs';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SidebarTabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

interface SidebarShellProps {
  children: React.ReactNode;
}

interface SidebarHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  onClose?: () => void;
}

interface SidebarBodyProps {
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
}

interface SidebarSegmentedTabsProps {
  tabs: SidebarTabItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  getTabTestId?: (tab: SidebarTabItem) => string | undefined;
  ariaLabel?: string;
}

const SidebarHeadingContext = createContext<string | undefined>(undefined);

function getSidebarTabButtonClass(isActive: boolean): string {
  if (isActive) {
    return 'bg-[var(--brand-surface)] text-[var(--brand-primary)] shadow-sm ring-1 ring-[var(--color-brand-border)]/70';
  }

  return 'text-[var(--brand-secondary)] hover:text-[var(--brand-text)]';
}

export function SidebarShell({ children }: SidebarShellProps): React.ReactElement {
  const headingId = useId();
  return (
    <SidebarHeadingContext.Provider value={headingId}>
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--brand-surface)]/95 animate-in fade-in duration-150"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </SidebarHeadingContext.Provider>
  );
}

export function SidebarHeader({
  title,
  description,
  meta,
  onClose,
}: SidebarHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const headingId = useContext(SidebarHeadingContext);
  return (
    <div className="border-b border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-semibold text-[var(--brand-text)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-xs text-[var(--brand-secondary)]">{description}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)]"
          >
            <span className="sr-only">{t('sidebar.close', 'Close sidebar')}</span>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {meta ? <div className="mt-3">{meta}</div> : null}
    </div>
  );
}

export function SidebarBody({
  children,
  className = '',
  scrollable = true,
}: SidebarBodyProps): React.ReactElement {
  const overflowClassName = scrollable ? 'overflow-y-auto' : 'overflow-hidden';

  return (
    <div
      className={`min-h-0 flex-1 ${overflowClassName} px-4 py-3 custom-scrollbar ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function SidebarSegmentedTabs({
  tabs,
  activeTab,
  onTabChange,
  getTabTestId,
  ariaLabel,
}: SidebarSegmentedTabsProps): React.ReactElement {
  const headingId = useContext(SidebarHeadingContext);
  const tabbableId =
    tabs.find((tab) => tab.id === activeTab && !tab.disabled)?.id ??
    tabs.find((tab) => !tab.disabled)?.id;
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : headingId}
      aria-orientation="horizontal"
      className="flex gap-1 overflow-x-auto rounded-[var(--brand-radius)] border border-[var(--color-brand-border)]/60 bg-[var(--brand-background)]/70 p-1"
    >
      {tabs.map((tab) => {
        const { id, label, icon, badge, disabled } = tab;
        return (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            disabled={disabled}
            data-tab-id={id}
            tabIndex={tabbableId === id ? 0 : -1}
            onKeyDown={(event) => handleTabNavigation(event, onTabChange)}
            onClick={() => onTabChange(id)}
            data-testid={getTabTestId?.(tab)}
            className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-xs)] px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${getSidebarTabButtonClass(activeTab === id)}`}
          >
            {icon && (
              <span className="shrink-0" aria-hidden="true">
                {icon}
              </span>
            )}
            <span>{label}</span>
            {badge && (
              <>
                {' '}
                <span className="rounded bg-[var(--brand-primary-100)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-primary)]">
                  {badge}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
