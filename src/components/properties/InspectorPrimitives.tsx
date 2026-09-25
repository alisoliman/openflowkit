import React, { useId } from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface InspectorContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function InspectorSectionDivider(): React.ReactElement {
  return <hr className="mb-2 border-[var(--color-brand-border)]" />;
}

export function InspectorIntro({
  children,
  className = '',
}: InspectorContainerProps): React.ReactElement {
  return (
    <p className={`mb-3 text-xs text-[var(--brand-secondary)] ${className}`.trim()}>{children}</p>
  );
}

export function InspectorFooter({
  children,
  className = '',
}: InspectorContainerProps): React.ReactElement {
  return (
    <div className={`mt-4 border-t border-[var(--color-brand-border)] pt-4 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function InspectorSummaryCard({
  children,
  className = '',
}: InspectorContainerProps): React.ReactElement {
  return (
    <div
      className={`rounded-[var(--brand-radius)] border border-[var(--color-brand-border)] bg-[var(--brand-background)]/70 p-3 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

interface InspectorFieldProps {
  label: string;
  children: React.ReactNode;
  helper?: React.ReactNode;
  className?: string;
}

interface FieldControlProps {
  id?: string;
  children?: React.ReactNode;
  type?: string;
  role?: string;
  label?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

type FieldControl = React.ReactElement<FieldControlProps>;

function findSingleFieldControl(children: React.ReactNode): FieldControl | null {
  const candidates: Array<FieldControl | null> = [];
  function visit(content: React.ReactNode): void {
    React.Children.forEach(content, (child) => {
      if (candidates.length > 1 || !React.isValidElement<FieldControlProps>(child)) return;
      if (
        child.type === Input ||
        child.type === Select ||
        ['input', 'select', 'textarea'].includes(String(child.type))
      ) {
        if (child.props.type !== 'hidden') candidates.push(child);
        return;
      }
      if (
        child.type === 'button' ||
        child.type === 'a' ||
        child.props.role === 'button' ||
        child.props.role === 'switch'
      ) {
        candidates.push(null);
        return;
      }
      if (typeof child.type === 'string' || child.type === React.Fragment) {
        visit(child.props.children);
      } else {
        // Composite controls (for example SegmentedChoice) keep their own
        // individual names and receive a labelled group around them.
        candidates.push(null);
      }
    });
  }
  visit(children);
  return candidates.length === 1 ? candidates[0] : null;
}

function attachFieldProps(
  children: React.ReactNode,
  target: FieldControl,
  props: Partial<FieldControlProps>
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement<FieldControlProps>(child)) return child;
    if (child === target) return React.cloneElement(child, props);
    if ((typeof child.type === 'string' || child.type === React.Fragment) && child.props.children) {
      return React.cloneElement(child, {
        children: attachFieldProps(child.props.children, target, props),
      });
    }
    return child;
  });
}

export function InspectorField({
  label,
  children,
  helper,
  className = '',
}: InspectorFieldProps): React.ReactElement {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const helperId = `${fieldId}-helper`;
  const control = findSingleFieldControl(children);
  const controlId = control?.props.id ?? `${fieldId}-control`;
  const hasOwnInputLabel = control?.type === Input && Boolean(control.props.label);
  const grouped = !control || hasOwnInputLabel;
  const controlProps: Partial<FieldControlProps> = control
    ? {
        id: controlId,
        'aria-describedby':
          [control.props['aria-describedby'], helper ? helperId : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
        ...(control.type === Select &&
        !control.props['aria-label'] &&
        !control.props['aria-labelledby']
          ? { 'aria-labelledby': labelId }
          : {}),
      }
    : {};

  return (
    <div
      className={className}
      role={grouped ? 'group' : undefined}
      aria-labelledby={grouped ? labelId : undefined}
      aria-describedby={grouped && helper ? helperId : undefined}
    >
      {grouped ? (
        <span id={labelId} className="text-xs font-semibold text-[var(--brand-secondary)]">
          {label}
        </span>
      ) : (
        <label
          id={labelId}
          htmlFor={controlId}
          className="text-xs font-semibold text-[var(--brand-secondary)]"
        >
          {label}
        </label>
      )}
      <div className="mt-1">
        {control ? attachFieldProps(children, control, controlProps) : children}
      </div>
      {helper ? (
        <div id={helperId} className="mt-2 text-[11px] text-[var(--brand-secondary)]">
          {helper}
        </div>
      ) : null}
    </div>
  );
}

export const INSPECTOR_INPUT_CLASSNAME =
  'w-full rounded-[var(--brand-radius)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3 py-2 text-sm text-[var(--brand-text)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]';
export const INSPECTOR_INPUT_COMPACT_CLASSNAME =
  'w-full rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-2 py-1.5 text-sm text-[var(--brand-text)] disabled:cursor-not-allowed disabled:bg-[var(--brand-background)] disabled:text-[var(--brand-secondary)]';
export const INSPECTOR_BUTTON_CLASSNAME =
  'rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-2 py-1.5 text-xs font-medium text-[var(--brand-text)] hover:border-[var(--brand-secondary)] hover:bg-[var(--brand-background)] disabled:cursor-not-allowed disabled:opacity-50';
export const INSPECTOR_BUTTON_ACCENT_CLASSNAME =
  'rounded-[var(--radius-sm)] border border-[var(--brand-primary-200)] bg-[var(--brand-primary-50)] px-2 py-1.5 text-xs font-medium text-[var(--brand-primary)] hover:border-[var(--brand-primary-300)] disabled:cursor-not-allowed disabled:opacity-50';
