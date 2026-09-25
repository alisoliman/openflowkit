import React from 'react';
import { Globe2, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/context/ThemeContext';
import { useVisualSettingsActions } from '@/store/viewHooks';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
];

export function SidebarFooter(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const { setViewSettings } = useVisualSettingsActions();
  const [languageError, setLanguageError] = React.useState(false);
  const currentLanguage = i18n.language.split('-')[0];
  const themeLabel =
    resolvedTheme === 'dark'
      ? t('home.switchToLight', 'Switch to light mode')
      : t('home.switchToDark', 'Switch to dark mode');

  async function changeLanguage(code: string): Promise<void> {
    setLanguageError(false);
    try {
      await i18n.changeLanguage(code);
      setViewSettings({ language: code });
    } catch {
      setLanguageError(true);
    }
  }

  return (
    <div className="border-t border-[var(--color-brand-border)] p-3">
      <div className="flex items-center gap-2">
        <label className="relative flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2 text-[var(--brand-secondary)] transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--brand-background)]">
          <Globe2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t('home.changeLanguage', 'Change language')}</span>
          <select
            value={
              LANGUAGES.some((language) => language.code === currentLanguage)
                ? currentLanguage
                : 'en'
            }
            onChange={(event) => void changeLanguage(event.target.value)}
            className="h-full min-w-0 flex-1 cursor-pointer bg-transparent text-sm text-[var(--brand-text)]"
          >
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code} lang={language.code}>
                {language.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
          aria-label={themeLabel}
          title={themeLabel}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
      {languageError && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {t('home.languageError', 'Could not change language. Please try again.')}
        </p>
      )}
    </div>
  );
}
