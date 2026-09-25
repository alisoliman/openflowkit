import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  className?: string;
  contentClassName?: string;
}

type TooltipSide = NonNullable<TooltipProps['side']>;

const VIEWPORT_PADDING = 8;
const HIDDEN_POSITION = { top: -9999, left: -9999 };
const CONTROL_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex], [role="button"], [role="link"]';

function resolveTooltipSide(
  side: TooltipSide,
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  sideOffset: number
): TooltipSide {
  if (side === 'top' && triggerRect.top - tooltipRect.height - sideOffset < VIEWPORT_PADDING)
    return 'bottom';
  if (
    side === 'bottom' &&
    triggerRect.bottom + tooltipRect.height + sideOffset > window.innerHeight - VIEWPORT_PADDING
  )
    return 'top';
  if (side === 'left' && triggerRect.left - tooltipRect.width - sideOffset < VIEWPORT_PADDING)
    return 'right';
  if (
    side === 'right' &&
    triggerRect.right + tooltipRect.width + sideOffset > window.innerWidth - VIEWPORT_PADDING
  )
    return 'left';
  return side;
}

function getArrowStyle(side: TooltipSide): React.CSSProperties {
  const fill = 'var(--brand-text)';
  const transparent = 'transparent';

  switch (side) {
    case 'top':
      return {
        bottom: -4,
        left: '50%',
        transform: 'translateX(-50%)',
        borderWidth: '4px 4px 0',
        borderStyle: 'solid',
        borderColor: `${fill} ${transparent} ${transparent}`,
      };
    case 'bottom':
      return {
        top: -4,
        left: '50%',
        transform: 'translateX(-50%)',
        borderWidth: '0 4px 4px',
        borderStyle: 'solid',
        borderColor: `${transparent} ${transparent} ${fill}`,
      };
    case 'left':
      return {
        right: -4,
        top: '50%',
        transform: 'translateY(-50%)',
        borderWidth: '4px 0 4px 4px',
        borderStyle: 'solid',
        borderColor: `${transparent} ${transparent} ${transparent} ${fill}`,
      };
    case 'right':
      return {
        left: -4,
        top: '50%',
        transform: 'translateY(-50%)',
        borderWidth: '4px 4px 4px 0',
        borderStyle: 'solid',
        borderColor: `${transparent} ${fill} ${transparent} ${transparent}`,
      };
  }
}

export function Tooltip({
  children,
  text,
  side = 'top',
  sideOffset = 8,
  className = '',
  contentClassName = '',
}: TooltipProps): React.ReactElement {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const rafRef = useRef<number | null>(null);
  const controlRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerHoveredRef = useRef(false);
  const tooltipHoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const [isOpen, setIsOpen] = useState(false);
  const [resolvedSide, setResolvedSide] = useState(side);
  const [position, setPosition] = useState<{ top: number; left: number }>(HIDDEN_POSITION);
  const [isVisible, setIsVisible] = useState(false);

  const triggerClassName = className.trim();

  const updatePosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const tr = trigger.getBoundingClientRect();
    const tt = tooltip.getBoundingClientRect();
    const preferred = resolveTooltipSide(side, tr, tt, sideOffset);
    setResolvedSide(preferred);

    let top = 0,
      left = 0;
    switch (preferred) {
      case 'bottom':
        top = tr.bottom + sideOffset;
        left = tr.left + (tr.width - tt.width) / 2;
        break;
      case 'left':
        top = tr.top + (tr.height - tt.height) / 2;
        left = tr.left - tt.width - sideOffset;
        break;
      case 'right':
        top = tr.top + (tr.height - tt.height) / 2;
        left = tr.right + sideOffset;
        break;
      default:
        top = tr.top - tt.height - sideOffset;
        left = tr.left + (tr.width - tt.width) / 2;
        break;
    }

    const maxL = window.innerWidth - tt.width - VIEWPORT_PADDING;
    const maxT = window.innerHeight - tt.height - VIEWPORT_PADDING;
    setPosition({
      left: Math.min(Math.max(left, VIEWPORT_PADDING), Math.max(maxL, VIEWPORT_PADDING)),
      top: Math.min(Math.max(top, VIEWPORT_PADDING), Math.max(maxT, VIEWPORT_PADDING)),
    });
    setIsVisible(true);
  }, [side, sideOffset]);

  const cancelScheduledClose = useCallback((): void => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openTooltip = useCallback((): void => {
    cancelScheduledClose();
    setIsOpen(true);
  }, [cancelScheduledClose]);

  const closeTooltip = useCallback((): void => {
    cancelScheduledClose();
    tooltipHoveredRef.current = false;
    setIsOpen(false);
    setIsVisible(false);
    setPosition(HIDDEN_POSITION);
  }, [cancelScheduledClose]);

  const scheduleClose = useCallback((): void => {
    cancelScheduledClose();
    if (focusedRef.current || triggerHoveredRef.current || tooltipHoveredRef.current) return;
    closeTimerRef.current = setTimeout(closeTooltip, 120);
  }, [cancelScheduledClose, closeTooltip]);

  // Resolve the DOM control rather than cloning children: callers include forwarded
  // buttons, disabled-button wrappers, and info icons nested inside another button.
  useLayoutEffect(() => {
    const wrapper = triggerRef.current;
    if (!wrapper) return;
    const control =
      wrapper.querySelector<HTMLElement>(CONTROL_SELECTOR) ??
      wrapper.parentElement?.closest<HTMLElement>(CONTROL_SELECTOR) ??
      null;
    controlRef.current = control;
    if (!control) return;
    focusedRef.current = document.activeElement === control;
    const hasName =
      control.getAttribute('aria-label') ||
      control.getAttribute('aria-labelledby') ||
      control.getAttribute('title') ||
      control.textContent?.trim() ||
      control.querySelector('img[alt]:not([alt=""])');
    const addedLabel =
      !hasName && control.matches('button, a[href], [role="button"], [role="link"]');
    if (addedLabel) control.setAttribute('aria-label', text);

    const handleFocus = (): void => {
      focusedRef.current = true;
      openTooltip();
    };
    const handleBlur = (): void => {
      focusedRef.current = false;
      if (!triggerHoveredRef.current && !tooltipHoveredRef.current) closeTooltip();
      else scheduleClose();
    };
    control.addEventListener('focus', handleFocus);
    control.addEventListener('blur', handleBlur);
    return () => {
      control.removeEventListener('focus', handleFocus);
      control.removeEventListener('blur', handleBlur);
      if (addedLabel && control.getAttribute('aria-label') === text)
        control.removeAttribute('aria-label');
      controlRef.current = null;
    };
  }, [children, text, openTooltip, closeTooltip, scheduleClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const control = controlRef.current;
    if (!control) return;
    const controlName = control.getAttribute('aria-label') || control.textContent?.trim();
    // A tooltip that repeats an accessible name should not announce it twice.
    if (controlName === text) return;
    const describedBy =
      control.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
    control.setAttribute('aria-describedby', [...new Set([...describedBy, tooltipId])].join(' '));
    return () => {
      const remaining =
        control
          .getAttribute('aria-describedby')
          ?.split(/\s+/)
          .filter((id) => id && id !== tooltipId) ?? [];
      if (remaining.length) control.setAttribute('aria-describedby', remaining.join(' '));
      else control.removeAttribute('aria-describedby');
    };
  }, [children, isOpen, text, tooltipId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeTooltip();
    };
    // Dismiss the hover description before Escape reaches an enclosing dialog.
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, closeTooltip]);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!isOpen) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      updatePosition();
      rafRef.current = null;
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, text, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (): void => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [isOpen, updatePosition]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      cancelScheduledClose();
    },
    [cancelScheduledClose]
  );

  return (
    <div
      ref={triggerRef}
      className={triggerClassName}
      onMouseEnter={() => {
        triggerHoveredRef.current = true;
        openTooltip();
      }}
      onMouseLeave={() => {
        triggerHoveredRef.current = false;
        scheduleClose();
      }}
      onClick={closeTooltip}
    >
      {children}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            // Portals retain React ancestry, including enclosing action buttons.
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="fixed z-[9999] max-w-[min(320px,calc(100vw-16px))]"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onMouseEnter={() => {
                tooltipHoveredRef.current = true;
                cancelScheduledClose();
              }}
              onMouseLeave={() => {
                tooltipHoveredRef.current = false;
                scheduleClose();
              }}
              style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
                opacity: isVisible ? 1 : 0,
                transition: isVisible ? 'opacity 150ms ease' : 'none',
              }}
            >
              <div
                className={`relative break-words rounded-md px-2.5 py-1.5 text-xs font-medium leading-relaxed ${contentClassName}`.trim()}
                style={{
                  background: 'var(--brand-text)',
                  color: 'var(--brand-surface)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2), 0 1px 4px rgba(0,0,0,0.12)',
                }}
              >
                {text}
                <span
                  aria-hidden="true"
                  className="absolute h-0 w-0"
                  style={getArrowStyle(resolvedSide)}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
