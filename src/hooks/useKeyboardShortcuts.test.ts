import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function renderShortcuts(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}): void {
  const baseHandlers = {
    selectedNodeId: 'node-1',
    selectedNodeType: 'process',
    deleteSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    duplicateNode: vi.fn(),
    selectAll: vi.fn(),
    onCommandBar: vi.fn(),
    onSearch: vi.fn(),
    onShortcutsHelp: vi.fn(),
    onFitView: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
  };
  renderHook(() => useKeyboardShortcuts({ ...baseHandlers, ...overrides }));
}

describe('useKeyboardShortcuts', () => {
  it('does not edit the canvas from controls, dialogs, or consumed keyboard events', () => {
    const onNudge = vi.fn();
    const deleteSelection = vi.fn();
    renderShortcuts({ onNudge, deleteSelection });
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    button.remove();
    const consumed = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(onNudge).not.toHaveBeenCalled();
    expect(deleteSelection).not.toHaveBeenCalled();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    useFlowStore.getState().setAgentTurn(null);
  });

  it('triggers duplicate when Cmd/Ctrl+D is pressed outside editable fields', () => {
    const duplicateNode = vi.fn();
    renderShortcuts({ duplicateNode });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));

    expect(duplicateNode).toHaveBeenCalledWith('node-1');
  });

  it('does not trigger duplicate while focused in editable input', () => {
    const duplicateNode = vi.fn();
    renderShortcuts({ duplicateNode });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));

    expect(duplicateNode).not.toHaveBeenCalled();
  });

  it('does not hijack select-all while focused in textarea', () => {
    const selectAll = vi.fn();
    renderShortcuts({ selectAll });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(selectAll).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not open command bar while focused in textarea', () => {
    const onCommandBar = vi.fn();
    renderShortcuts({ onCommandBar });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(onCommandBar).not.toHaveBeenCalled();
  });

  it('dispatches node label edit request when F2 is pressed with selected node', () => {
    renderShortcuts();
    const requestListener = vi.fn();
    window.addEventListener('flowmind:node-label-edit-request', requestListener as EventListener);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }));

    expect(requestListener).toHaveBeenCalledTimes(1);
    window.removeEventListener('flowmind:node-label-edit-request', requestListener as EventListener);
  });

  it('starts node label editing from the first typed printable character', () => {
    renderShortcuts();
    const requestListener = vi.fn();
    window.addEventListener('flowmind:node-label-edit-request', requestListener as EventListener);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(requestListener).toHaveBeenCalledTimes(1);
    const [event] = requestListener.mock.calls[0] as [CustomEvent<{ seedText?: string; replaceExisting?: boolean }>];
    expect(event.detail.seedText).toBe('a');
    expect(event.detail.replaceExisting).toBe(true);
    window.removeEventListener('flowmind:node-label-edit-request', requestListener as EventListener);
  });

  it('triggers fit view on Shift+1', () => {
    const onFitView = vi.fn();
    renderShortcuts({ onFitView });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true }));

    expect(onFitView).toHaveBeenCalledTimes(1);
  });

  it('triggers zoom in on Cmd/Ctrl plus', () => {
    const onZoomIn = vi.fn();
    renderShortcuts({ onZoomIn });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('triggers zoom out on Cmd/Ctrl minus', () => {
    const onZoomOut = vi.fn();
    renderShortcuts({ onZoomOut });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true }));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('shows undo unavailable feedback instead of calling undo at the history boundary', () => {
    const undo = vi.fn();
    const onUndoUnavailable = vi.fn();
    renderShortcuts({ undo, canUndo: false, onUndoUnavailable });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));

    expect(undo).not.toHaveBeenCalled();
    expect(onUndoUnavailable).toHaveBeenCalledTimes(1);
  });

  it('shows redo unavailable feedback instead of calling redo at the history boundary', () => {
    const redo = vi.fn();
    const onRedoUnavailable = vi.fn();
    renderShortcuts({ redo, canRedo: false, onRedoUnavailable });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));

    expect(redo).not.toHaveBeenCalled();
    expect(onRedoUnavailable).toHaveBeenCalledTimes(1);
  });

  it('adds a mindmap child on Tab when a mindmap topic is selected', () => {
    const onAddMindmapChildShortcut = vi.fn();
    renderShortcuts({
      selectedNodeType: 'mindmap',
      onAddMindmapChildShortcut,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(onAddMindmapChildShortcut).toHaveBeenCalledTimes(1);
  });

  it('adds a mindmap sibling on Enter when a mindmap topic is selected', () => {
    const onAddMindmapSiblingShortcut = vi.fn();
    renderShortcuts({
      selectedNodeType: 'mindmap',
      onAddMindmapSiblingShortcut,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(onAddMindmapSiblingShortcut).toHaveBeenCalledTimes(1);
  });

  it('deletes the selection on Delete and Backspace, with or without modifiers', () => {
    const deleteSelection = vi.fn();
    renderShortcuts({ deleteSelection });

    for (const init of [
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'Backspace', metaKey: true },
      { key: 'Backspace', shiftKey: true },
    ]) {
      window.dispatchEvent(new KeyboardEvent('keydown', init));
    }

    expect(deleteSelection).toHaveBeenCalledTimes(4);
  });

  it('leaves Backspace to the field being typed in', () => {
    const deleteSelection = vi.fn();
    renderShortcuts({ deleteSelection });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it('copies style on Cmd/Ctrl+Alt+C outside editable fields', () => {
    const onCopyStyle = vi.fn();
    renderShortcuts({ onCopyStyle });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, altKey: true }));

    expect(onCopyStyle).toHaveBeenCalledTimes(1);
  });

  it('pastes style on Cmd/Ctrl+Alt+V outside editable fields', () => {
    const onPasteStyle = vi.fn();
    renderShortcuts({ onPasteStyle });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, altKey: true }));

    expect(onPasteStyle).toHaveBeenCalledTimes(1);
  });

  it('creates a connected node on Alt+Arrow', () => {
    const onQuickCreateShortcut = vi.fn();
    renderShortcuts({ onQuickCreateShortcut });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }));

    expect(onQuickCreateShortcut).toHaveBeenCalledWith('right');
  });

  it('applies annotation colors with number shortcuts', () => {
    const onAnnotationColorShortcut = vi.fn();
    renderShortcuts({
      selectedNodeType: 'annotation',
      onAnnotationColorShortcut,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));

    expect(onAnnotationColorShortcut).toHaveBeenCalledWith('blue');
  });

  it('toggles pin position on bare P', () => {
    const onTogglePinPositionShortcut = vi.fn();
    renderShortcuts({ onTogglePinPositionShortcut });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));

    expect(onTogglePinPositionShortcut).toHaveBeenCalledTimes(1);
  });

  it('does not toggle pin while focused in an editable field', () => {
    const onTogglePinPositionShortcut = vi.fn();
    renderShortcuts({ onTogglePinPositionShortcut });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));

    expect(onTogglePinPositionShortcut).not.toHaveBeenCalled();
  });

  it('leaves only help, fit view and zoom while a Flowpilot turn edits the page', () => {
    const handlers = {
      deleteSelection: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      duplicateNode: vi.fn(),
      selectAll: vi.fn(),
      onCommandBar: vi.fn(),
      onSearch: vi.fn(),
      onSelectMode: vi.fn(),
      onTogglePinPositionShortcut: vi.fn(),
      onShortcutsHelp: vi.fn(),
      onFitView: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    };
    renderShortcuts(handlers);
    const labelEditRequest = vi.fn();
    window.addEventListener('flowmind:node-label-edit-request', labelEditRequest);
    useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });

    for (const init of [
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'z', ctrlKey: true },
      { key: 'y', ctrlKey: true },
      { key: 'd', ctrlKey: true },
      { key: 'a', ctrlKey: true },
      { key: 'k', ctrlKey: true },
      { key: 'f', ctrlKey: true },
      { key: 'v' },
      { key: 'p' },
      { key: 'F2' },
      { key: 'x' },
      { key: '?' },
      { key: '!', code: 'Digit1', shiftKey: true },
      { key: '=', ctrlKey: true },
      { key: '-', ctrlKey: true },
    ]) {
      window.dispatchEvent(new KeyboardEvent('keydown', init));
    }
    window.removeEventListener('flowmind:node-label-edit-request', labelEditRequest);

    expect(labelEditRequest).not.toHaveBeenCalled();
    for (const [name, handler] of Object.entries(handlers)) {
      const allowed = ['onShortcutsHelp', 'onFitView', 'onZoomIn', 'onZoomOut'].includes(name);
      expect(handler, name).toHaveBeenCalledTimes(allowed ? 1 : 0);
    }
  });
});
