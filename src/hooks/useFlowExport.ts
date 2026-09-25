import { useCallback, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { useReactFlow } from '@/lib/reactflowCompat';
import { toJpeg } from 'html-to-image';
import { useFlowStore } from '../store';
import { useCanvasActions, useCanvasState } from '@/store/canvasHooks';
import { useActiveTabId, useTabActions } from '@/store/tabHooks';
import { useViewSettings } from '@/store/viewHooks';
import { useToast } from '../components/ui/ToastContext';
import { resolveFlowExportViewport } from './flowExportViewport';
import { notifyOperationOutcome } from '@/services/operationFeedback';
import { createPdfFromJpeg } from '@/services/export/pdfDocument';
import { buildExportFileName } from '@/lib/exportFileName';
import { createDownload, createExportOptions } from './flow-export/exportCapture';
import {
  buildDiagramDocumentJson,
  importDiagramDocumentJson,
} from './flow-export/diagramDocumentTransfer';
import { useStaticExport } from './useStaticExport';
import { useCinematicExport } from './useCinematicExport';
import type { ExportResult } from '@/services/export/exportResult';
import type { ImportFidelityReport } from '@/services/importFidelity';

interface ImportRecoveryState {
  fileName: string;
  report: ImportFidelityReport;
}

const logger = createLogger({ scope: 'useFlowExport' });

interface AnimatedPlaybackControls {
  stopPlayback: () => void;
}

export const useFlowExport = (
  recordHistory: () => void,
  reactFlowWrapper: React.RefObject<HTMLDivElement>,
  animatedPlayback: AnimatedPlaybackControls
) => {
  const tabs = useFlowStore((state) => state.tabs);
  const { nodes, edges } = useCanvasState();
  const { setNodes, setEdges } = useCanvasActions();
  const viewSettings = useViewSettings();
  const activeTabId = useActiveTabId();
  const { updateTab } = useTabActions();
  const { fitView } = useReactFlow();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importRecoveryState, setImportRecoveryState] = useState<ImportRecoveryState | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const exportBaseName = activeTab?.name;

  const { handleExport, handleCopyImage, handleSvgExport, handleCopySvg } = useStaticExport(
    nodes,
    reactFlowWrapper,
    addToast,
    exportBaseName
  );
  const { handleCinematicExport } = useCinematicExport({
    nodes,
    edges,
    reactFlowWrapper,
    animatedPlayback,
    addToast,
    exportBaseName,
  });

  const handlePdfExport = useCallback(async (): Promise<ExportResult> => {
    const { viewport: flowViewport, message } = resolveFlowExportViewport(reactFlowWrapper.current);
    if (!flowViewport) {
      const failureMessage = message ?? 'The canvas viewport could not be found.';
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    }
    const wrapper = reactFlowWrapper.current;
    wrapper.classList.add('exporting');
    addToast('Preparing PDF download…', 'info');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
      const { width, height, options } = createExportOptions(nodes, 'jpeg');
      const jpegDataUrl = await toJpeg(flowViewport, options);
      const pdfBlob = createPdfFromJpeg({ jpegDataUrl, width, height, title: exportBaseName ?? 'OpenFlowKit Diagram' });
      createDownload(pdfBlob, buildExportFileName(exportBaseName, 'pdf'));
      addToast('Diagram exported as PDF!', 'success');
      return { status: 'success' };
    } catch (error) {
      const failureMessage = 'Failed to export PDF. Please try again.';
      logger.error('PDF export failed.', { error });
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    } finally {
      wrapper.classList.remove('exporting');
    }
  }, [nodes, reactFlowWrapper, addToast, exportBaseName]);

  // --- JSON Export ---
  const handleExportJSON = useCallback(async (): Promise<ExportResult> => {
    addToast('Preparing JSON download…', 'info');
    try {
      const documentJson = await buildDiagramDocumentJson({ nodes, edges, exportSerializationMode: viewSettings.exportSerializationMode, activeTab });
      createDownload(new Blob([documentJson], { type: 'application/json' }), buildExportFileName(exportBaseName, 'json'));
      addToast('Diagram JSON downloaded!', 'success');
      return { status: 'success' };
    } catch (error) {
      const failureMessage = 'Failed to export JSON. Please try again.';
      logger.error('JSON export failed.', { error });
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    }
  }, [nodes, edges, viewSettings.exportSerializationMode, activeTab, addToast, exportBaseName]);

  const handleCopyJSON = useCallback(async (): Promise<ExportResult> => {
    addToast('Preparing JSON copy…', 'info');
    try {
      const documentJson = await buildDiagramDocumentJson({ nodes, edges, exportSerializationMode: viewSettings.exportSerializationMode, activeTab });
      await navigator.clipboard.writeText(documentJson);
      addToast('Diagram JSON copied to clipboard!', 'success');
      return { status: 'success' };
    } catch (error) {
      const failureMessage = 'Failed to copy JSON. Please try again.';
      logger.error('JSON clipboard export failed.', { error });
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    }
  }, [nodes, edges, viewSettings.exportSerializationMode, activeTab, addToast]);

  // --- JSON Import ---
  const handleImportJSON = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const dismissImportRecovery = useCallback(() => {
    setImportRecoveryState(null);
  }, []);

  const onFileImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImportRecoveryState(null);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const importStart = performance.now();
        void (async () => {
          const result = await importDiagramDocumentJson({
            json: ev.target?.result as string,
            importStart,
          });

          if (result.ok) {
            // A Flowpilot turn that started during the layout owns the page, so the import is dropped.
            if (useFlowStore.getState().agentTurn) {
              addToast('Flowpilot is editing this page. Try again after it finishes.', 'warning');
              return;
            }
            setImportRecoveryState(null);
            recordHistory();
            setNodes(result.nodes);
            setEdges(result.edges);
            updateTab(activeTabId, { diagramType: result.diagramType, playback: result.playback });
            result.warnings.forEach((message) => addToast(message, 'warning'));
            notifyOperationOutcome(addToast, result.outcome);
            setTimeout(() => fitView({ duration: 800, padding: 0.2 }), 100);
            return;
          }

          setImportRecoveryState({
            fileName: file.name,
            report: result.report,
          });
          notifyOperationOutcome(addToast, result.outcome);
        })();
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [recordHistory, setNodes, setEdges, fitView, addToast, activeTabId, updateTab]
  );

  return {
    fileInputRef,
    handleExport,
    handleCopyImage,
    handleSvgExport,
    handleCopySvg,
    handlePdfExport,
    handleCinematicExport,
    handleExportJSON,
    handleCopyJSON,
    handleImportJSON,
    onFileImport,
    importRecoveryState,
    dismissImportRecovery,
  };
};
