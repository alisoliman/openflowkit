import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { EDITOR_FIELD_DEFAULT_CLASS } from './editorFieldStyles';

export interface SelectOption {
    value: string;
    label: string;
    hint?: string;
    badge?: string;
    group?: string;
}

interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    className?: string;
    id?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    disabled?: boolean;
}

const GROUP_ORDER = ['Flagship', 'Reasoning', 'Speed', 'Legacy', 'Custom', 'Other'];
function sortGroups(a: string, b: string): number {
    const aIndex = GROUP_ORDER.indexOf(a);
    const bIndex = GROUP_ORDER.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
}

export function Select({ value, onChange, options, placeholder = 'Select...', className = '', id, disabled = false, ...aria }: SelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 256 });
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef({ query: '', time: 0 });
    const listId = useId();
    const reduceMotion = useReducedMotion();
    const grouped = options.reduce<Record<string, SelectOption[]>>((groups, option) => {
        (groups[option.group ?? 'Other'] ??= []).push(option);
        return groups;
    }, {});
    const groups = Object.keys(grouped).sort(sortGroups);
    const hasGroups = groups.length > 1 || (groups.length === 1 && groups[0] !== 'Other');
    const ordered = groups.flatMap(group => grouped[group]);
    const selectedOption = options.find(option => option.value === value);
    const open = isOpen && !disabled;

    useLayoutEffect(() => {
        if (!open) return;
        function updatePosition(): void {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const below = window.innerHeight - rect.bottom - 12;
            const above = rect.top - 12;
            const flip = below < 220 && above > below;
            const maxHeight = Math.max(80, Math.min(320, flip ? above : below));
            const menuHeight = Math.min(menuRef.current?.scrollHeight ?? maxHeight, maxHeight);
            const width = Math.min(rect.width, window.innerWidth - 16);
            setPosition({ top: flip ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight });
        }
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open, options.length]);

    useEffect(() => {
        if (!open) return;
        menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }, [open, activeIndex]);

    useEffect(() => {
        if (!open) return;
        function outside(event: PointerEvent): void {
            const target = event.target as Node;
            if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false);
        }
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open]);

    function openMenu(): void {
        setActiveIndex(Math.max(0, ordered.findIndex(option => option.value === value)));
        setIsOpen(true);
    }
    function selectOption(option: SelectOption | undefined): void {
        if (!option) return;
        onChange(option.value);
        setIsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
    }
    function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
        } else if (event.key === 'Tab') {
            setIsOpen(false);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (!open) openMenu();
            else setActiveIndex(index => Math.max(0, Math.min(ordered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if ((event.key === 'Home' || event.key === 'End') && open) {
            event.preventDefault();
            event.stopPropagation();
            setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, ordered.length - 1));
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (open) selectOption(ordered[activeIndex]);
            else openMenu();
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const time = Date.now();
            const query = `${time - searchRef.current.time < 700 ? searchRef.current.query : ''}${event.key.toLowerCase()}`;
            searchRef.current = { query, time };
            const nextIndex = ordered.findIndex(option => option.label.toLowerCase().startsWith(query));
            if (nextIndex >= 0) { setActiveIndex(nextIndex); setIsOpen(true); }
        }
    }

    return (
        <div className={`relative min-w-0 ${className}`} ref={containerRef}>
            <button
                ref={triggerRef}
                id={id}
                type="button"
                role="combobox"
                {...aria}
                aria-labelledby={aria['aria-labelledby'] ?? (aria['aria-label'] ? undefined : `${listId}-value`)}
                disabled={disabled}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open && ordered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                onClick={() => open ? setIsOpen(false) : openMenu()}
                onKeyDown={handleKeyDown}
                onBlur={() => setIsOpen(false)}
                className={`${EDITOR_FIELD_DEFAULT_CLASS} flex min-h-10 items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${open ? 'border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]/15' : 'hover:border-[var(--brand-secondary)]'}`}
            >
                <span className="flex min-w-0 flex-col">
                    <span id={`${listId}-value`} className="truncate font-medium text-[var(--brand-text)]">{selectedOption?.label ?? placeholder}</span>
                    {selectedOption?.hint && <span className="truncate text-xs text-[var(--brand-secondary)]">{selectedOption.hint}</span>}
                </span>
                <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--brand-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && createPortal(
                <motion.div
                    ref={menuRef}
                    id={listId}
                    role="listbox"
                    aria-label={aria['aria-label'] ?? placeholder}
                    aria-labelledby={aria['aria-labelledby']}
                    initial={reduceMotion ? false : { opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.12 }}
                    data-floating-select-root="true"
                    className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] py-1 shadow-[var(--shadow-md)] custom-scrollbar"
                    style={position}
                    onMouseDown={event => event.preventDefault()}
                >
                    {groups.map(group => (
                        <div key={group} role={hasGroups ? 'group' : undefined} aria-label={hasGroups ? group : undefined}>
                            {hasGroups && <div className="sticky top-0 bg-[var(--brand-surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-secondary)]">{group}</div>}
                            {grouped[group].map(option => {
                                const index = ordered.indexOf(option);
                                const selected = option.value === value;
                                return (
                                    <div
                                        key={option.value}
                                        id={`${listId}-${index}`}
                                        role="option"
                                        aria-selected={selected}
                                        data-option-index={index}
                                        onPointerMove={() => setActiveIndex(index)}
                                        onClick={() => selectOption(option)}
                                        className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${index === activeIndex ? 'bg-[var(--brand-primary-50)]' : ''} ${selected ? 'font-medium text-[var(--brand-primary)]' : 'text-[var(--brand-text)]'}`}
                                    >
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-words">{option.label}</span>{option.badge && <span className="rounded border border-[var(--color-brand-border)] px-1.5 py-0.5 text-[10px] text-[var(--brand-secondary)]">{option.badge}</span>}</span>
                                            {option.hint && <span className="mt-0.5 block text-xs font-normal leading-relaxed text-[var(--brand-secondary)]">{option.hint}</span>}
                                        </span>
                                        {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                    {options.length === 0 && <div className="px-3 py-6 text-center text-sm text-[var(--brand-secondary)]">No options available</div>}
                </motion.div>, document.body
            )}
        </div>
    );
}
