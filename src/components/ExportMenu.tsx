import React, { Suspense, lazy, useId, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createDefaultCinematicExportRequest,
  type CinematicExportRequest,
  type CinematicExportResolution,
  type CinematicExportSpeed,
  type CinematicThemeMode,
} from '@/services/export/cinematicExport';
import { Tooltip } from './Tooltip';
import { Button } from './ui/Button';
import { useExportMenu } from './useExportMenu';

const LazyExportMenuPanel = lazy(async () => {
  const module = await import('./ExportMenuPanel');
  return { default: module.ExportMenuPanel };
});

interface ExportMenuProps {
  onExportPNG: (format: 'png' | 'jpeg', options?: { transparentBackground?: boolean }) => void;
  onCopyImage: (format: 'png' | 'jpeg', options?: { transparentBackground?: boolean }) => void;
  onExportSVG: () => void;
  onCopySVG: () => void;
  onExportPDF: () => void;
  onExportCinematic: (request: CinematicExportRequest) => void;
  onExportJSON: () => void;
  onCopyJSON: () => void;
  onExportMermaid: () => void;
  onDownloadMermaid: () => void;
  onDownloadPlantUML: () => void;
  onExportOpenFlowDSL: () => void;
  onDownloadOpenFlowDSL: () => void;
  onExportFigma: () => void;
  onDownloadFigma: () => void;
  cinematicSpeed?: CinematicExportSpeed;
  onCinematicSpeedChange?: (speed: CinematicExportSpeed) => void;
  cinematicResolution?: CinematicExportResolution;
  onCinematicResolutionChange?: (res: CinematicExportResolution) => void;
  cinematicThemeMode: CinematicThemeMode;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  onExportPNG,
  onCopyImage,
  onExportSVG,
  onCopySVG,
  onExportPDF,
  onExportCinematic,
  onExportJSON,
  onCopyJSON,
  onExportMermaid,
  onDownloadMermaid,
  onDownloadPlantUML,
  onExportOpenFlowDSL,
  onDownloadOpenFlowDSL,
  onExportFigma,
  onDownloadFigma,
  cinematicSpeed,
  onCinematicSpeedChange,
  cinematicResolution,
  onCinematicResolutionChange,
  cinematicThemeMode,
}) => {
  const { t } = useTranslation();
  const panelId = useId();
  const exportLabel = t('export.title', 'Export');
  const defaultRequest = createDefaultCinematicExportRequest(cinematicThemeMode);
  const [cinematicSpeedState, setCinematicSpeedState] = useState<CinematicExportSpeed>(
    defaultRequest.speed
  );
  const [cinematicResolutionState, setCinematicResolutionState] =
    useState<CinematicExportResolution>(defaultRequest.resolution);
  const effectiveSpeed = cinematicSpeed ?? cinematicSpeedState;
  const effectiveSpeedChange = onCinematicSpeedChange ?? setCinematicSpeedState;
  const effectiveResolution = cinematicResolution ?? cinematicResolutionState;
  const effectiveResolutionChange = onCinematicResolutionChange ?? setCinematicResolutionState;
  const cinematicExportRequest: CinematicExportRequest = {
    format: 'cinematic-video',
    speed: effectiveSpeed,
    resolution: effectiveResolution,
    themeMode: cinematicThemeMode,
  };
  const {
    isOpen,
    pendingAction,
    errorMessage,
    triggerRef,
    closeMenu,
    clearError,
    menuRef,
    toggleMenu,
    handleSelect,
  } = useExportMenu({
    onExportPNG,
    onCopyImage,
    onExportSVG,
    onCopySVG,
    onExportPDF,
    onExportCinematic,
    getCinematicExportRequest: () => cinematicExportRequest,
    onExportJSON,
    onCopyJSON,
    onExportMermaid,
    onDownloadMermaid,
    onDownloadPlantUML,
    onExportOpenFlowDSL,
    onDownloadOpenFlowDSL,
    onExportFigma,
    onDownloadFigma,
  });

  return (
    <div className="relative" ref={menuRef}>
      <Tooltip text={t('export.exportDiagram', 'Export Diagram')} side="bottom">
        <Button
          ref={triggerRef}
          onClick={toggleMenu}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          aria-busy={pendingAction !== null}
          data-testid="topnav-export"
          size="sm"
          aria-label={exportLabel}
          className="h-10 w-10 px-0 sm:h-9 sm:w-auto sm:px-3"
        >
          {pendingAction ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="h-4 w-4" />}
          <span className="hidden sm:inline">{exportLabel}</span>
        </Button>
      </Tooltip>

      {isOpen && (
        <Suspense fallback={null}>
          <LazyExportMenuPanel
            id={panelId}
            onClose={() => closeMenu(true)}
            pendingAction={pendingAction}
            errorMessage={errorMessage}
            onClearError={clearError}
            onSelect={handleSelect}
            cinematicSpeed={effectiveSpeed}
            onCinematicSpeedChange={effectiveSpeedChange}
            cinematicResolution={effectiveResolution}
            onCinematicResolutionChange={effectiveResolutionChange}
          />
        </Suspense>
      )}
    </div>
  );
};
