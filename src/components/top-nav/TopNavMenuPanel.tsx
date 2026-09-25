import React, { useEffect, useRef } from 'react';
import { Clock, FolderOpen, Home, Moon, Settings, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useTheme } from '@/context/ThemeContext';

interface TopNavMenuPanelProps {
    id?: string;
    onEscape?: () => void;
    onClose: () => void;
    onGoHome: () => void;
    onOpenSettings: () => void;
    onHistory: () => void;
    onImportJSON: () => void;
}

export function TopNavMenuPanel({
    id,
    onEscape,
    onClose,
    onGoHome,
    onOpenSettings,
    onHistory,
    onImportJSON,
}: TopNavMenuPanelProps): React.ReactElement {
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => { panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }, []);
    const { t } = useTranslation();
    const { resolvedTheme, setTheme } = useTheme();
    const menuItemClass = 'flex min-h-10 items-center gap-3 px-3 py-2.5 text-sm text-[var(--brand-secondary)] hover:bg-[var(--brand-primary-50)] hover:text-[var(--brand-primary)] rounded-[var(--radius-sm)] transition-all font-medium';
    const themeToggleLabel = resolvedTheme === 'dark' ? t('nav.switchToLight', 'Light mode') : t('nav.switchToDark', 'Dark mode');

    function handleAction(action: () => void): void {
        action();
        onClose();
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            (onEscape ?? onClose)();
            return;
        }
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let nextIndex: number | undefined;
        if (event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
        if (event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = buttons.length - 1;
        if (nextIndex !== undefined) {
            event.preventDefault();
            buttons[nextIndex]?.focus();
        }
    }

    return (
        <>
            <button
                type="button"
                tabIndex={-1}
                className="fixed inset-0 z-40 bg-transparent"
                onClick={onClose}
                aria-label={t('nav.closeMenu', 'Close menu')}
            />
            <div id={id} ref={panelRef} role="menu" aria-label={t('nav.menu', 'Menu')} onKeyDown={handleKeyDown} className="absolute top-full left-0 mt-3 w-56 bg-[var(--brand-surface)]/94 backdrop-blur-xl rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] border border-[var(--color-brand-border)]/80 ring-1 ring-black/5 p-2 flex flex-col gap-1 z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-left motion-reduce:animate-none">
                <div className="px-3 py-2 text-xs font-bold text-[var(--brand-secondary)] uppercase tracking-widest">
                    {t('nav.menu', 'Menu')}
                </div>
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleAction(onGoHome)}
                    className={menuItemClass}
                >
                    <Home aria-hidden="true" className="w-4 h-4" />
                    {t('nav.goToDashboard', 'Go to Dashboard')}
                </button>
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleAction(onHistory)}
                    data-testid="topnav-history"
                    className={menuItemClass}
                >
                    <Clock aria-hidden="true" className="w-4 h-4" />
                    {t('nav.versionHistory', 'Version History')}
                </button>
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleAction(onImportJSON)}
                    className={menuItemClass}
                >
                    <FolderOpen aria-hidden="true" className="w-4 h-4" />
                    {t('nav.loadJSON', 'Load JSON')}
                </button>
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleAction(onOpenSettings)}
                    className={menuItemClass}
                >
                    <Settings aria-hidden="true" className="w-4 h-4" />
                    {t('nav.canvasSettings', 'Canvas Settings')}
                </button>

                {/* Single divider before preferences */}
                <div className="my-1 border-t border-[var(--color-brand-border)]" />

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                        className={`${menuItemClass} flex-1`}
                    >
                        {resolvedTheme === 'dark' ? <Sun aria-hidden="true" className="w-4 h-4" /> : <Moon aria-hidden="true" className="w-4 h-4" />}
                        {themeToggleLabel}
                    </button>
                    <LanguageSelector variant="minimal" placement="bottom" />
                </div>
            </div>
        </>
    );
}
