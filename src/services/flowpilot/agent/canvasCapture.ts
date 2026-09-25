import { toJpeg } from 'html-to-image';
import type { NodeBounds } from '@/hooks/node-operations/sectionBounds';
import { AGENT_MAX_TOOL_IMAGE_CHARS } from '@/services/copilot/agentProtocol';

// Pictures of the canvas for the agent: what the user sees, drawn from the live DOM.

// Vision models downscale anything much larger, and legible node text needs about this much.
const MAX_IMAGE_SIDE = 1600;
const MAX_SCALE = 2;
const JPEG_QUALITY = 0.85;
const SHRINK_STEP = 0.7;
const MAX_ATTEMPTS = 4;
// Controls and editing chrome the user sees only while pointing at things.
const HIDDEN_CLASS_NAMES = [
  'flow-edge-route-controls',
  'react-flow__handle',
  'react-flow__edgeupdater',
  'react-flow__resize-control',
  'react-flow__nodesselection',
  'react-flow__selection',
  'react-flow__controls',
  'react-flow__minimap',
  'react-flow__attribution',
  'react-flow__background',
];

export interface CanvasCapture {
  /** Base64 JPEG data, without the data: prefix. */
  data: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  /** Image px per canvas px. */
  scale: number;
}

function isShown(node: HTMLElement): boolean {
  return !node.classList || !HIDDEN_CLASS_NAMES.some((name) => node.classList.contains(name));
}

/**
 * Draws a region of the canvas (in canvas px) as a JPEG on the given background. Only nodes the canvas
 * has rendered appear, so the region should be in view. Null when there is no canvas to draw.
 */
export async function captureCanvasRegion(region: NodeBounds, background: string): Promise<CanvasCapture | null> {
  const viewport = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || region.width <= 0 || region.height <= 0) return null;

  let scale = Math.min(MAX_SCALE, MAX_IMAGE_SIDE / Math.max(region.width, region.height));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(region.width * scale));
    const height = Math.max(1, Math.round(region.height * scale));
    const dataUrl = await toJpeg(viewport, {
      backgroundColor: background,
      width,
      height,
      pixelRatio: 1,
      quality: JPEG_QUALITY,
      skipFonts: true,
      filter: isShown,
      // The viewport scales from its top-left corner, so this maps the region's corner to the image's.
      style: {
        transform: `translate(${-region.x * scale}px, ${-region.y * scale}px) scale(${scale})`,
        width: `${width}px`,
        height: `${height}px`,
      },
    });
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (data.length <= AGENT_MAX_TOOL_IMAGE_CHARS) {
      return { data, mimeType: 'image/jpeg', width, height, scale };
    }
    scale *= SHRINK_STEP;
  }
  return null;
}
