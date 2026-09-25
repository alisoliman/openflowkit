import React from 'react';

export interface SegmentedTabItem {
  id: string;
  label: React.ReactNode;
  count?: number;
  icon?: React.ReactNode;
  disabled?: boolean;
  panelId?: string;
}

interface SegmentedTabsProps {
  items: SegmentedTabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  listClassName?: string;
  size?: 'sm' | 'md';
  fill?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export function getSegmentedTabButtonClass(
  selected: boolean,
  size: 'sm' | 'md' = 'md',
  fill = false
): string {
  const sizeClassName =
    size === 'sm'
      ? 'h-9 rounded-[var(--radius-sm)] px-3 text-xs [@media(pointer:coarse)]:h-11'
      : 'h-11 rounded-[var(--radius-sm)] px-3 text-xs';
  return `${sizeClassName} inline-flex items-center gap-2 whitespace-nowrap border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-surface)] ${
    fill ? 'min-w-0 flex-1 justify-center' : 'shrink-0'
  }`;
}

export function getSegmentedTabCountClass(selected: boolean): string {
  return selected ? 'text-[var(--brand-primary)]' : 'text-[var(--brand-secondary)]';
}

export function SegmentedTabs({
  items,
  value,
  onChange,
  className = '',
  listClassName = '',
  size = 'md',
  fill = false,
  ariaLabel,
  ariaLabelledBy,
}: SegmentedTabsProps): React.ReactElement {
  const tabbableId =
    items.find((item) => item.id === value && !item.disabled)?.id ??
    items.find((item) => !item.disabled)?.id;
  return (
    <div className={`overflow-x-auto pb-1 no-scrollbar ${className}`.trim()}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-orientation="horizontal"
        className={`flex ${fill ? 'w-full min-w-0' : 'min-w-max'} gap-2 ${listClassName}`.trim()}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={item.panelId}
              data-tab-id={item.id}
              tabIndex={item.id === tabbableId ? 0 : -1}
              onKeyDown={(event) => handleTabNavigation(event, onChange)}
              onClick={() => onChange(item.id)}
              disabled={item.disabled}
              className={`${getSegmentedTabButtonClass(selected, size, fill)} ${
                selected
                  ? 'border-[var(--brand-primary-200)] bg-[var(--brand-primary-50)] text-[var(--brand-primary)]'
                  : 'border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-[var(--brand-secondary)] hover:border-[var(--brand-secondary)] hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]'
              } ${item.disabled ? 'cursor-not-allowed opacity-50' : ''}`.trim()}
            >
              {item.icon ? (
                <span
                  aria-hidden="true"
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                >
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
              {typeof item.count === 'number' ? (
                <>
                  {' '}
                  <span className={`text-xs tabular-nums ${getSegmentedTabCountClass(selected)}`}>
                    {item.count}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Shared by catalog filters and sidebar views. Keep a tablist to a single Tab stop. */
export function handleTabNavigation(
  event: React.KeyboardEvent<HTMLButtonElement>,
  onChange: (id: string) => void
): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const list = event.currentTarget.closest('[role="tablist"]');
  if (!list) return;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(
    (tab) => !tab.disabled && !tab.hidden
  );
  if (!tabs.length) return;
  const currentIndex = tabs.indexOf(event.currentTarget);
  const rtl = window.getComputedStyle(event.currentTarget).direction === 'rtl';
  let nextIndex: number;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else {
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
  }
  const target = tabs[nextIndex];
  const id = target.dataset.tabId;
  if (!id) return;
  event.preventDefault();
  event.stopPropagation();
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (target.getAttribute('aria-selected') !== 'true') onChange(id);
}
