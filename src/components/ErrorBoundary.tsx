import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { withTranslation, WithTranslation } from 'react-i18next';
import { createLogger } from '@/lib/logger';
import { captureAnalyticsException } from '@/services/analytics/analytics';

const logger = createLogger({ scope: 'ErrorBoundary' });

interface Props extends WithTranslation {
    children?: ReactNode;
    fallback?: ReactNode;
    className?: string;
}

interface State {
    hasError: boolean;
    error?: Error;
}

class ErrorBoundaryComponent extends Component<Props, State> {
    private recoveryHeadingRef = React.createRef<HTMLHeadingElement>();

    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.recoveryHeadingRef.current?.focus({ preventScroll: true });
        logger.error('Uncaught error.', { error, componentStack: errorInfo.componentStack });
        captureAnalyticsException(error, {
            surface: 'react-error-boundary',
            has_component_stack: Boolean(errorInfo.componentStack),
        });
    }

    public render() {
        const { t } = this.props;
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className={`flex min-h-0 items-center justify-center overflow-y-auto bg-[var(--brand-background)] p-4 sm:p-6 ${this.props.className || 'min-h-screen'}`}>
                    <div className="my-auto w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] p-6 shadow-[var(--shadow-md)] sm:p-8">
                        <div aria-hidden="true" className="mb-5 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] text-[var(--brand-secondary)]">
                            <AlertTriangle className="h-6 w-6" />
                        </div>

                        <div role="alert">
                            <h1 ref={this.recoveryHeadingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight text-[var(--brand-text)] outline-none">
                                {t('errorBoundary.title', 'Something went wrong')}
                            </h1>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--brand-secondary)]">
                                {t('errorBoundary.description', 'We encountered an unexpected error. Please try refreshing the page.')}
                            </p>
                        </div>

                        <p className="mt-4 text-sm leading-relaxed text-[var(--brand-secondary)]">
                            {t('errorBoundary.recoveryHint', 'Reload to reopen the editor. Reloading does not clear diagrams saved in this browser.')}
                        </p>

                        {import.meta.env.DEV && this.state.error && (
                            <details className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] text-left">
                                <summary className="cursor-pointer rounded-[var(--radius-md)] px-3 py-2.5 text-xs font-medium text-[var(--brand-secondary)]">
                                    {t('errorBoundary.technicalDetails', 'Technical details')}
                                </summary>
                                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-brand-border)] p-3 text-xs leading-relaxed text-[var(--brand-secondary)]">{this.state.error.toString()}</pre>
                            </details>
                        )}

                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--brand-action)] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
                        >
                            <RefreshCcw aria-hidden="true" className="h-4 w-4" />
                            {t('errorBoundary.reloadPage', 'Reload page')}
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryComponent);
