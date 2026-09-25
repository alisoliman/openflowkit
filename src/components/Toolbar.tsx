import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, WandSparkles, Workflow } from 'lucide-react';
import { Button } from './ui/Button';
import { Tooltip } from './Tooltip';
import { ToolbarAddMenu } from './toolbar/ToolbarAddMenu';
import { ToolbarHistoryControls } from './toolbar/ToolbarHistoryControls';
import { ToolbarModeControls } from './toolbar/ToolbarModeControls';
import { getToolbarIconButtonClass, TOOLBAR_DIVIDER_CLASS } from './toolbar/toolbarButtonStyles';
import { AssetsIcon } from './icons/AssetsIcon';
import { useIsAgentEditing } from '@/store/selectionHooks';
import {
  getDefaultToolbarAddItemId,
  type AddItemId,
} from '@/components/add-items/addItemRegistry';

interface ToolbarProps {
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
  onToggleSelectMode: () => void;
  isSelectMode: boolean;
  onTogglePanMode: () => void;
  onCommandBar: () => void;
  isCommandBarOpen: boolean;
  onToggleStudio: () => void;
  isStudioOpen: boolean;
  onOpenAssets: () => void;
  onAddShape: (
    shape: import('@/lib/types').NodeData['shape'],
    position: { x: number; y: number }
  ) => void;
  onAddAnnotation: (position: { x: number; y: number }) => void;
  onAddSection: (position: { x: number; y: number }) => void;
  onAddTextNode: (position: { x: number; y: number }) => void;
  onAddClassNode: (position: { x: number; y: number }) => void;
  onAddEntityNode: (position: { x: number; y: number }) => void;
  onAddMindmapNode: (position: { x: number; y: number }) => void;
  onAddJourneyNode: (position: { x: number; y: number }) => void;
  onAddArchitectureNode: (position: { x: number; y: number }) => void;
  onAddSequenceParticipant: (position: { x: number; y: number }) => void;
  onAddWireframe: (variant: 'browser' | 'mobile', position: { x: number; y: number }) => void;
  onLayout: () => void;
  getCenter: () => { x: number; y: number };
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onToggleSelectMode,
  isSelectMode,
  onTogglePanMode,
  onCommandBar,
  isCommandBarOpen,
  onToggleStudio,
  isStudioOpen,
  onOpenAssets,
  onAddShape,
  onAddAnnotation,
  onAddSection,
  onAddTextNode,
  onAddClassNode,
  onAddEntityNode,
  onAddMindmapNode,
  onAddJourneyNode,
  onAddArchitectureNode,
  onAddSequenceParticipant,
  onAddWireframe,
  onLayout,
  getCenter,
}) => {
  const { t } = useTranslation();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [currentAddItemId, setCurrentAddItemId] = useState<AddItemId>(getDefaultToolbarAddItemId);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const flowPilotIconClass = `w-4 h-4 transition-transform ${isStudioOpen ? 'scale-110 text-[var(--brand-primary)]' : 'group-hover:scale-110'}`;
  const shouldShowAddMenu = showAddMenu && !isCommandBarOpen && !isStudioOpen;

  // Close add menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as globalThis.Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Interaction guard: If command bar is open or a Flowpilot turn edits the page, disable all toolbar
  // interactions. The Flowpilot toggle stays live during a turn so a closed studio, and its Stop, can reopen.
  const isAgentEditing = useIsAgentEditing();
  const isInteractive = !isCommandBarOpen && !isAgentEditing;
  const containerClasses = [
    'flex w-max max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-y-1 p-1.5 bg-[var(--brand-surface)]/95 backdrop-blur-xl shadow-[var(--shadow-md)] rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] transition-colors duration-150',
    isCommandBarOpen ? 'pointer-events-none' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div role="group" aria-label={t('toolbar.diagramTools', 'Diagram tools')} className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-40 sm:bottom-8 ${containerClasses}`}>
      {/* Group 1: Tools */}
      <ToolbarModeControls
        isInteractive={isInteractive}
        isSelectMode={isSelectMode}
        onToggleSelectMode={onToggleSelectMode}
        onTogglePanMode={onTogglePanMode}
      />

      <div className={`mx-1.5 ${TOOLBAR_DIVIDER_CLASS}`} />

      {/* Group 2: Actions */}
      <div className="flex items-center gap-1">
        <div ref={addMenuRef}>
          <ToolbarAddMenu
            currentItemId={currentAddItemId}
            isInteractive={isInteractive}
            showAddMenu={shouldShowAddMenu}
            onToggleMenu={() => setShowAddMenu((previouslyShown) => !previouslyShown)}
            onCloseMenu={() => setShowAddMenu(false)}
            onCurrentItemChange={setCurrentAddItemId}
            onAddShape={onAddShape}
            onAddAnnotation={onAddAnnotation}
            onAddSection={onAddSection}
            onAddTextNode={onAddTextNode}
            onAddClassNode={onAddClassNode}
            onAddEntityNode={onAddEntityNode}
            onAddMindmapNode={onAddMindmapNode}
            onAddJourneyNode={onAddJourneyNode}
            onAddArchitectureNode={onAddArchitectureNode}
            onAddSequenceParticipant={onAddSequenceParticipant}
            onAddWireframe={onAddWireframe}
            getCenter={getCenter}
          />
        </div>

        <Tooltip text={t('toolbar.assets', 'Assets')}>
          <Button
            onClick={onOpenAssets}
            aria-label={t('toolbar.assets', 'Assets')}
            disabled={!isInteractive}
            variant="ghost"
            size="icon"
            className={getToolbarIconButtonClass()}
            icon={<AssetsIcon className="w-4 h-4 transition-transform group-hover:scale-110" />}
          />
        </Tooltip>

        <Tooltip text={t('toolbar.commandCenter', 'Open Command Center')}>
          <Button
            onClick={onCommandBar}
            aria-label={t('toolbar.commandCenter', 'Open Command Center')}
            aria-keyshortcuts="Meta+K Control+K"
            aria-haspopup="dialog"
            aria-expanded={isCommandBarOpen}
            disabled={!isInteractive}
            variant="primary"
            size="icon"
            className={`group h-10 w-10 rounded-[var(--radius-md)] shadow-[var(--shadow-sm)] transition-colors ${isCommandBarOpen ? 'bg-[var(--brand-text)] hover:bg-[var(--brand-text)]' : 'bg-[var(--brand-action)] hover:bg-[var(--brand-action-hover)]'}`}
            icon={
              <Plus
                aria-hidden="true"
                className={`w-5 h-5 text-white transition-transform duration-200 ${isCommandBarOpen ? 'rotate-45' : 'group-hover:rotate-90'}`}
              />
            }
          />
        </Tooltip>

        <Tooltip text={t('toolbar.autoLayout')}>
          <Button
            onClick={onLayout}
            aria-label={t('toolbar.autoLayout', 'Auto Layout')}
            disabled={!isInteractive}
            variant="ghost"
            size="icon"
            className={getToolbarIconButtonClass()}
            icon={<Workflow aria-hidden="true" className="w-4 h-4 transition-transform group-hover:scale-110" />}
          />
        </Tooltip>

        <Tooltip text={t('toolbar.flowpilot', 'Flowpilot')}>
          <Button
            data-testid="toolbar-flowpilot-toggle"
            aria-label={t('toolbar.flowpilot', 'Flowpilot')}
            onClick={onToggleStudio}
            aria-expanded={isStudioOpen}
            aria-pressed={isStudioOpen}
            disabled={isCommandBarOpen}
            variant="ghost"
            size="icon"
            className={`${getToolbarIconButtonClass({ active: isStudioOpen })} group relative overflow-hidden`}
          >
            <WandSparkles aria-hidden="true" className={flowPilotIconClass} />
          </Button>
        </Tooltip>
      </div>

      <div className={`mx-1.5 ${TOOLBAR_DIVIDER_CLASS}`} />

      {/* Group 3: History */}
      <ToolbarHistoryControls
        isInteractive={isInteractive}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </div>
  );
};
