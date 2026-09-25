import { useCallback } from 'react';
import { createLogger } from '@/lib/logger';
import { toPng, toJpeg, toSvg } from 'html-to-image';
import { buildExportFileName } from '@/lib/exportFileName';
import { copyDataUrlToClipboard, createExportOptions } from './flow-export/exportCapture';
import { resolveFlowExportViewport } from './flowExportViewport';
import type { FlowNode } from '@/lib/types';
import type { ExportResult } from '@/services/export/exportResult';

const logger = createLogger({ scope: 'useStaticExport' });

export interface StaticImageExportOptions {
  transparentBackground?: boolean;
}

export const useStaticExport = (
  nodes: FlowNode[],
  reactFlowWrapper: React.RefObject<HTMLDivElement>,
  addToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void,
  exportBaseName: string | undefined
) => {
  const capture = useCallback(async (
    format: 'png' | 'jpeg' | 'svg',
    action: 'download' | 'copy',
    exportOptions?: StaticImageExportOptions
  ): Promise<ExportResult> => {
    const { viewport: flowViewport, message } = resolveFlowExportViewport(reactFlowWrapper.current);
    if (!flowViewport) {
      const failureMessage = message ?? 'The canvas viewport could not be found.';
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    }
    const wrapper = reactFlowWrapper.current;
    wrapper.classList.add('exporting');
    addToast(`Preparing ${format.toUpperCase()} ${action}…`, 'info');
    try {
      // Allow export-only canvas styles to paint before capturing the viewport.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
      const { options } = createExportOptions(nodes, format === 'jpeg' ? 'jpeg' : 'png', exportOptions);
      const dataUrl = format === 'svg'
        ? await toSvg(flowViewport, { ...options, backgroundColor: null })
        : format === 'png' ? await toPng(flowViewport, options) : await toJpeg(flowViewport, options);
      if (action === 'copy') {
        await copyDataUrlToClipboard(dataUrl);
        addToast(`Diagram copied as ${format.toUpperCase()}!`, 'success');
      } else {
        const link = document.createElement('a');
        link.download = buildExportFileName(exportBaseName, format === 'jpeg' ? 'jpg' : format);
        link.href = dataUrl;
        link.click();
        addToast(`Diagram exported as ${format.toUpperCase()}!`, 'success');
      }
      return { status: 'success' };
    } catch (error) {
      const failureMessage = action === 'copy'
        ? `Failed to copy ${format === 'svg' ? 'SVG' : 'image'}. Please try again.`
        : format === 'svg' ? 'Failed to export SVG. Please try again.' : 'Failed to export. Please try again.';
      logger.error('Image export failed.', { error, format, action });
      addToast(failureMessage, 'error');
      return { status: 'error', message: failureMessage };
    } finally {
      wrapper.classList.remove('exporting');
    }
  }, [nodes, reactFlowWrapper, addToast, exportBaseName]);

  const handleExport = useCallback(
    (format: 'png' | 'jpeg' = 'png', options?: StaticImageExportOptions) => capture(format, 'download', options),
    [capture]
  );
  const handleCopyImage = useCallback(
    (format: 'png' | 'jpeg' = 'png', options?: StaticImageExportOptions) => capture(format, 'copy', options),
    [capture]
  );
  const handleSvgExport = useCallback(() => capture('svg', 'download'), [capture]);
  const handleCopySvg = useCallback(() => capture('svg', 'copy'), [capture]);

  return { handleExport, handleCopyImage, handleSvgExport, handleCopySvg };
};
