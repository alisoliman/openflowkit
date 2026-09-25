import React, { useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useTranslation } from 'react-i18next';
import { useAnalyticsPreference } from '@/hooks/useAnalyticsPreference';
import { OpenFlowLogo } from './icons/OpenFlowLogo';
import { Switch } from './ui/Switch';
import { Button } from './ui/Button';
import { writeLocalStorageString } from '@/services/storage/uiLocalStorage';
import { shouldShowWelcomeModal, WELCOME_SEEN_STORAGE_KEY } from './home/welcomeModalState';
import { recordOnboardingEvent } from '@/services/onboarding/events';
import { WandSparkles, FileCode2, MonitorPlay, Paintbrush } from 'lucide-react';

export interface WelcomeModalProps {
  onOpenTemplates: () => void;
  onPromptWithAI: () => void;
  onImport: () => void;
  onBlankCanvas: () => void;
}

export function WelcomeModal({
  onOpenTemplates,
  onPromptWithAI,
  onImport,
  onBlankCanvas,
}: WelcomeModalProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(() => shouldShowWelcomeModal());
  const [analyticsEnabled, setAnalyticsEnabled] = useAnalyticsPreference();

  const dismiss = () => {
    setIsOpen(false);
    writeLocalStorageString(WELCOME_SEEN_STORAGE_KEY, 'true');
  };

  const dialogRef = useModalDialog({ isOpen, onClose: dismiss });

  if (!isOpen) return null;

  const handleAction = (action: () => void) => {
    action();
    dismiss();
  };

  function handleTrackedAction(
    eventName:
      | 'welcome_blank_selected'
      | 'welcome_prompt_selected'
      | 'welcome_import_selected'
      | 'welcome_template_selected',
    action: () => void
  ): void {
    recordOnboardingEvent(eventName, { source: 'welcome-modal' });
    handleAction(action);
  }

  const features = [
    {
      icon: <Paintbrush className="h-5 w-5 text-blue-500" />,
      title: t('welcome.feature1Title', 'Create amazing diagrams'),
      description: t(
        'welcome.feature1Desc',
        'Design beautiful, enterprise-grade architecture visually.'
      ),
      action: () => handleTrackedAction('welcome_blank_selected', onBlankCanvas),
    },
    {
      icon: <WandSparkles className="h-5 w-5 text-amber-500" />,
      title: t('welcome.feature2Title', 'Use AI'),
      description: t(
        'welcome.feature2Desc',
        'Generate complete architectures with a single intelligent prompt.'
      ),
      action: () => handleTrackedAction('welcome_prompt_selected', onPromptWithAI),
    },
    {
      icon: <FileCode2 className="h-5 w-5 text-emerald-500" />,
      title: t('welcome.feature3Title', 'Code to diagram'),
      description: t(
        'welcome.feature3Desc',
        'Instantly construct stunning visual infrastructure from text.'
      ),
      action: () => handleTrackedAction('welcome_import_selected', onImport),
    },
    {
      icon: <MonitorPlay className="h-5 w-5 text-purple-500" />,
      title: t('welcome.feature4Title', 'Start from a template'),
      description: t(
        'welcome.feature4Desc',
        'Explore ready-made diagrams and make one your own.'
      ),
      action: () => handleTrackedAction('welcome_template_selected', onOpenTemplates),
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="w-full max-w-[460px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200">
        <div className="px-8 pb-3 pt-10 text-center">
          <OpenFlowLogo className="mx-auto mb-5 h-12 w-12 text-[var(--brand-primary)]" />
          <h2 id="welcome-title" className="text-[24px] font-bold tracking-tight text-[var(--brand-text)] mb-2">
            {t('welcome.title', 'Welcome to OpenFlowKit')}
          </h2>
        </div>

        <div className="px-8 py-4">
          <div className="flex flex-col gap-[22px]">
            {features.map((f, i) => (
              <button
                type="button"
                key={i}
                onClick={f.action}
                className="flex flex-row items-center gap-4 cursor-pointer rounded-xl p-2 -m-2 hover:bg-[var(--brand-background)] transition-colors"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--brand-background)] border border-[var(--color-brand-border)] shadow-sm">
                  {f.icon}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <h3 className="text-[15px] font-semibold text-[var(--brand-text)] mb-[1px]">
                    {f.title}
                  </h3>
                  <p className="text-[13px] leading-snug text-[var(--brand-secondary)]">
                    {f.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-[var(--color-brand-border)] bg-[var(--brand-background)]/40 px-8 py-6">
          <div className="mb-5 flex items-center justify-between rounded-xl border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-4 py-3 shadow-sm">
            <div className="flex flex-col text-left mr-4">
              <span className="text-[12px] font-semibold text-[var(--brand-text)]">
                {t('welcome.analyticsTitle', 'Anonymous Analytics')}
              </span>
              <span className="text-[11px] text-[var(--brand-secondary)] mt-0.5 leading-snug">
                {t(
                  'welcome.analyticsDesc',
                  'We collect diagnostic data. We never read your diagrams or prompts.'
                )}
              </span>
            </div>
            <Switch
              checked={analyticsEnabled}
              aria-label={t('welcome.analyticsTitle', 'Anonymous Analytics')}
              onCheckedChange={setAnalyticsEnabled}
              className="scale-90"
            />
          </div>
          <Button size="xl" className="w-full font-semibold shadow-sm" onClick={dismiss}>
            {t('welcome.getStarted', 'Get Started')}
          </Button>
        </div>
      </div>
    </div>
  );
}
