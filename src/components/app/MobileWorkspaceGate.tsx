import React from 'react';
import { ArrowLeft, Monitor } from 'lucide-react';
import { OpenFlowLogo } from '@/components/icons/OpenFlowLogo';
import { MOBILE_WORKSPACE_GATE_COPY } from './mobileWorkspaceGateCopy';

interface MobileWorkspaceGateProps {
    children: React.ReactNode;
    onOpenDocs: () => void;
    onGoHome: () => void;
}

export function MobileWorkspaceGate({
    children,
    onOpenDocs,
    onGoHome,
}: MobileWorkspaceGateProps): React.ReactElement {
    return (
        <>
            <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[var(--brand-background)] px-5 py-5 text-center md:hidden">
                <div className="my-auto w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-6 py-7 shadow-[var(--shadow-lg)]">
                    <OpenFlowLogo className="mx-auto mb-8 h-14 w-14" />

                    <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary/5">
                        <Monitor className="h-6 w-6 text-brand-primary" />
                    </div>

                    <h2 className="text-2xl font-bold tracking-tight text-brand-dark">
                        {MOBILE_WORKSPACE_GATE_COPY.title}
                    </h2>

                    <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-brand-secondary">
                        {MOBILE_WORKSPACE_GATE_COPY.description}
                    </p>

                    <div className="mt-6 rounded-2xl border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-4 py-3 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-secondary)]">
                            {MOBILE_WORKSPACE_GATE_COPY.recommendedLabel}
                        </p>
                        <p className="mt-1 text-sm text-[var(--brand-secondary)]">
                            {MOBILE_WORKSPACE_GATE_COPY.recommendedBody}
                        </p>
                    </div>

                    <div className="mt-8 flex flex-col gap-3">
                        <button
                            onClick={onOpenDocs}
                            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-action)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-action-hover)]"
                        >
                            {MOBILE_WORKSPACE_GATE_COPY.openDocs}
                        </button>

                        <button
                            onClick={onGoHome}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-brand-primary/20 px-5 py-2.5 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-primary/5"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {MOBILE_WORKSPACE_GATE_COPY.goHome}
                        </button>
                    </div>
                </div>
            </div>

            <div className="hidden md:contents">{children}</div>
        </>
    );
}
