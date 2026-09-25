import React from 'react';
import { Keyboard, LayoutTemplate, Plus, WandSparkles } from 'lucide-react';
import { Button } from './ui/Button';
import { useShortcutHelpActions } from '@/store/viewHooks';

interface FlowEditorEmptyStateProps {
    title: string;
    description: string;
    generateLabel: string;
    templatesLabel: string;
    addNodeLabel: string;
    onGenerate: () => void;
    onTemplates: () => void;
    onAddNode: () => void;
    onSuggestionClick?: (prompt: string) => void;
}

export function FlowEditorEmptyState({
    title,
    description,
    generateLabel,
    templatesLabel,
    addNodeLabel,
    onGenerate,
    onTemplates,
    onAddNode,
}: FlowEditorEmptyStateProps): React.ReactElement {
    const { setShortcutsHelpOpen } = useShortcutHelpActions();

    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto px-5 pb-24 pt-6 pointer-events-none animate-[fadeIn_200ms_ease-out]">
            <div className="pointer-events-auto my-auto w-full max-w-[440px]">
                <div className="rounded-[var(--radius-xl)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] p-6 text-center shadow-[var(--shadow-sm)] sm:p-8">
                    
                    <div aria-hidden="true" className="mx-auto mb-5 w-40 text-[var(--brand-primary)]">
                        <svg className="h-20 w-full" viewBox="0 0 160 80" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M44 40h20m32 0h20" strokeDasharray="3 4" opacity=".5" />
                            <rect x="4" y="25" width="40" height="30" rx="7" fill="var(--brand-background)" stroke="var(--brand-border)" />
                            <rect x="64" y="20" width="32" height="40" rx="8" fill="var(--brand-primary-50)" />
                            <rect x="116" y="25" width="40" height="30" rx="7" fill="var(--brand-background)" stroke="var(--brand-border)" />
                            <path d="M18 36h12m-12 8h8M74 40h12m-6-6v12m50-10h12m-12 8h8" strokeLinecap="round" />
                        </svg>
                    </div>

                    <h3 className="mb-2 text-xl font-semibold tracking-tight text-[var(--brand-text)]">
                        {title}
                    </h3>
                    
                    <p className="mx-auto mb-6 max-w-[32ch] text-sm leading-relaxed text-[var(--brand-secondary)]">
                        {description}
                    </p>

                    <div className="flex flex-col gap-3">
                        <Button
                            onClick={onGenerate}
                            variant="primary"
                            size="lg"
                            className="w-full"
                            data-testid="empty-generate-ai"
                            icon={<WandSparkles className="h-4 w-4" />}
                        >
                            {generateLabel}
                        </Button>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Button
                            onClick={onTemplates}
                            variant="secondary"
                            size="md"
                            className="w-full px-3 text-xs"
                            data-testid="empty-browse-templates"
                            icon={<LayoutTemplate className="h-4 w-4" />}
                        >
                            {templatesLabel}
                        </Button>

                        <Button
                            onClick={onAddNode}
                            variant="secondary"
                            size="md"
                            className="w-full px-3 text-xs"
                            data-testid="empty-add-node"
                            icon={<Plus className="h-4 w-4" />}
                        >
                            {addNodeLabel}
                        </Button>
                        </div>
                    </div>

                    <button
                        onClick={() => setShortcutsHelpOpen(true)}
                        className="group mt-5 flex min-h-9 w-full items-center justify-center gap-2 rounded-md text-[var(--brand-secondary)] transition-colors duration-150 hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
                        data-testid="empty-state-shortcuts"
                        type="button"
                    >
                        <Keyboard aria-hidden="true" className="h-[13px] w-[13px]" strokeWidth={2} />
                        <span className="text-[12px] text-[var(--brand-secondary)]">View keyboard shortcuts</span>
                        <kbd className="inline-flex h-[18px] items-center justify-center rounded-[4px] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-[5px] font-mono text-[10px] font-bold text-[var(--brand-secondary)]">
                            ?
                        </kbd>
                    </button>
                </div>
            </div>
        </div>
    );
}
