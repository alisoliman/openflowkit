import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface ModalDialogOptions {
  isOpen?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const openDialogs: symbol[] = [];
let previousBodyOverflow = '';
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** Keeps keyboard interaction in the topmost dialog and restores its opening control on close. */
export function useModalDialog({ isOpen = true, onClose, initialFocusRef }: ModalDialogOptions): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol('dialog');
    if (openDialogs.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(token);
    const isTopmost = () => openDialogs.at(-1) === token;
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    (initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent): void {
      if (!isTopmost() || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements(dialog!);
      const first = elements[0];
      const last = elements.at(-1);
      const current = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        dialog!.focus();
      } else if (event.shiftKey && (current === first || current === dialog || !dialog!.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog!.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }

    // Child widgets get first refusal of Escape (for example an open select list).
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const wasTopmost = isTopmost();
      const index = openDialogs.indexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
      if (openDialogs.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (wasTopmost) {
        const restoreTarget = previouslyFocused?.isConnected && previouslyFocused !== document.body
          ? previouslyFocused
          : document.getElementById('main-content');
        restoreTarget?.focus({ preventScroll: true });
      }
    };
  }, [isOpen, initialFocusRef]);

  return dialogRef;
}
