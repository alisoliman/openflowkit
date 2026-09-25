import React from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Tooltip } from '../Tooltip';
import { getToolbarIconButtonClass } from './toolbarButtonStyles';

interface ToolbarHistoryControlsProps {
    isInteractive: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
}

export function ToolbarHistoryControls({
    isInteractive,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
}: ToolbarHistoryControlsProps): React.ReactElement {
    const { t } = useTranslation();

    return (
        <div role="group" aria-label={t('toolbar.history', 'Edit history')} className="flex items-center gap-0.5">
            <Tooltip text={t('toolbar.undo')}>
                <Button
                    onClick={onUndo}
                    aria-keyshortcuts="Meta+Z Control+Z"
                    aria-label={t('toolbar.undo')}
                    disabled={!canUndo || !isInteractive}
                    variant="ghost"
                    size="icon"
                    className={getToolbarIconButtonClass()}
                    icon={<Undo2 aria-hidden="true" className="w-4 h-4 transition-transform group-hover:scale-110" />}
                />
            </Tooltip>
            <Tooltip text={t('toolbar.redo')}>
                <Button
                    onClick={onRedo}
                    aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
                    aria-label={t('toolbar.redo')}
                    disabled={!canRedo || !isInteractive}
                    variant="ghost"
                    size="icon"
                    className={getToolbarIconButtonClass()}
                    icon={<Redo2 aria-hidden="true" className="w-4 h-4 transition-transform group-hover:scale-110" />}
                />
            </Tooltip>
        </div>
    );
}
