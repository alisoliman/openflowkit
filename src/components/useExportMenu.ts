import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ExportCallbackResult } from '@/services/export/exportResult';
import type { CinematicExportRequest } from '@/services/export/cinematicExport';
import { captureAnalyticsEvent } from '@/services/analytics/analytics';
import { recordOnboardingEvent } from '@/services/onboarding/events';
import { useToast } from './ui/ToastContext';

interface UseExportMenuParams {
  onExportPNG: (format: 'png' | 'jpeg', options?: ExportImageActionOptions) => ExportCallbackResult;
  onCopyImage: (format: 'png' | 'jpeg', options?: ExportImageActionOptions) => ExportCallbackResult;
  onExportSVG: () => ExportCallbackResult;
  onCopySVG: () => ExportCallbackResult;
  onExportPDF: () => ExportCallbackResult;
  onExportCinematic: (request: CinematicExportRequest) => ExportCallbackResult;
  getCinematicExportRequest: () => CinematicExportRequest;
  onExportJSON: () => ExportCallbackResult;
  onCopyJSON: () => ExportCallbackResult;
  onExportMermaid: () => ExportCallbackResult;
  onDownloadMermaid: () => ExportCallbackResult;
  onDownloadPlantUML: () => ExportCallbackResult;
  onExportOpenFlowDSL: () => ExportCallbackResult;
  onDownloadOpenFlowDSL: () => ExportCallbackResult;
  onExportFigma: () => ExportCallbackResult;
  onDownloadFigma: () => ExportCallbackResult;
}

type ExportActionKey = 'download' | 'copy';
type ExportActionHandler = () => ExportCallbackResult;
type ExportActionHandlers = Partial<Record<ExportActionKey, ExportActionHandler>>;

interface ExportImageActionOptions {
  transparentBackground?: boolean;
}
type ExportSelectionOptions = ExportImageActionOptions;

interface UseExportMenuResult {
  isOpen: boolean;
  pendingAction: { key: string; action: ExportActionKey } | null;
  errorMessage: string | null;
  triggerRef: RefObject<HTMLButtonElement>;
  menuRef: RefObject<HTMLDivElement>;
  toggleMenu: () => void;
  closeMenu: (restoreFocus?: boolean) => void;
  clearError: () => void;
  handleSelect: (
    key: string,
    action: ExportActionKey,
    options?: ExportSelectionOptions
  ) => Promise<void>;
}

function isSelectPortalTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-floating-select-root="true"]'));
}

function isInsideMenu(menuRef: RefObject<HTMLDivElement>, target: EventTarget | null): boolean {
  return target instanceof Node && Boolean(menuRef.current?.contains(target));
}

export function useExportMenu({
  onExportPNG,
  onCopyImage,
  onExportSVG,
  onCopySVG,
  onExportPDF,
  onExportCinematic,
  getCinematicExportRequest,
  onExportJSON,
  onCopyJSON,
  onExportMermaid,
  onDownloadMermaid,
  onDownloadPlantUML,
  onExportOpenFlowDSL,
  onDownloadOpenFlowDSL,
  onExportFigma,
  onDownloadFigma,
}: UseExportMenuParams): UseExportMenuResult {
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<UseExportMenuResult['pendingAction']>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const actionInFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  const closeMenu = useCallback((restoreFocus = false): void => {
    isOpenRef.current = false;
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function shouldCloseForTarget(target: EventTarget | null): boolean {
      return !isSelectPortalTarget(target) && !isInsideMenu(menuRef, target);
    }

    function handleOutsideInteraction(target: EventTarget | null): void {
      if (shouldCloseForTarget(target)) {
        closeMenu();
      }
    }

    function handlePointerDownOutside(event: PointerEvent): void {
      handleOutsideInteraction(event.target);
    }

    function handleFocusOutside(event: FocusEvent): void {
      handleOutsideInteraction(event.target);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closeMenu(true);
      }
    }

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    document.addEventListener('focusin', handleFocusOutside);
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      document.removeEventListener('focusin', handleFocusOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closeMenu]);

  function getHandlers(options?: ExportSelectionOptions): Record<string, ExportActionHandlers> {
    return {
      png: {
        download: () => onExportPNG('png', options),
        copy: () => onCopyImage('png', options),
      },
      jpeg: {
        download: () => onExportPNG('jpeg', options),
        copy: () => onCopyImage('jpeg', options),
      },
      svg: { download: onExportSVG, copy: onCopySVG },
      pdf: { download: onExportPDF },
      'cinematic-video': {
        download: () => onExportCinematic(getCinematicExportRequest()),
      },
      json: { download: onExportJSON, copy: onCopyJSON },
      openflow: { download: onDownloadOpenFlowDSL, copy: onExportOpenFlowDSL },
      mermaid: { download: onDownloadMermaid, copy: onExportMermaid },
      plantuml: { download: onDownloadPlantUML },
      figma: { download: onDownloadFigma, copy: onExportFigma },
    };
  }

  function toggleMenu(): void {
    setErrorMessage(null);
    isOpenRef.current = !isOpenRef.current;
    setIsOpen(isOpenRef.current);
  }

  function recordSelection(key: string, action: ExportActionKey): void {
    recordOnboardingEvent('first_export_completed', { format: `${key}:${action}` });
    captureAnalyticsEvent('export_used', {
      format: key,
      action,
    });
  }

  async function handleSelect(
    key: string,
    action: ExportActionKey,
    options?: ExportSelectionOptions
  ): Promise<void> {
    if (actionInFlightRef.current) return;
    const actionHandler = getHandlers(options)[key]?.[action];
    if (!actionHandler) {
      return;
    }

    actionInFlightRef.current = true;
    setPendingAction({ key, action });
    setErrorMessage(null);

    try {
      const result = await actionHandler();
      if (result && result.status === 'error') {
        setErrorMessage(result.message);
        return;
      }
      if (result && result.status === 'cancelled') return;
      recordSelection(key, action);
      closeMenu(isOpenRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      const failureMessage = `Failed to complete ${key} ${action}: ${message}`;
      setErrorMessage(failureMessage);
      addToast(failureMessage, 'error', 5000);
    } finally {
      actionInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  return {
    isOpen,
    pendingAction,
    errorMessage,
    triggerRef,
    menuRef,
    toggleMenu,
    closeMenu,
    clearError: () => setErrorMessage(null),
    handleSelect,
  };
}
