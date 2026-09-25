import React from 'react';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  className = '',
  disabled = false,
  ...aria
}) => {
  return (
    <label
      className={`flex min-h-10 shrink-0 items-center gap-3 px-1 group ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${className}`}
    >
      <div className="relative">
        <input
          type="checkbox"
          {...aria}
          role="switch"
          aria-checked={checked}
          aria-disabled={disabled}
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <div
          className={`w-9 h-5 rounded-full border border-[var(--brand-secondary)]/30 transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[var(--brand-primary)] ${checked ? 'bg-[var(--brand-primary)]' : 'bg-[var(--brand-secondary)]/35'}`}
        ></div>
        <div
          className={`absolute top-1 left-1 h-3 w-3 rounded-full bg-[var(--brand-surface)] shadow-sm transform transition-transform duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        ></div>
      </div>
      {label && (
        <span className={`text-sm font-medium text-[var(--brand-secondary)] transition-colors ${disabled ? '' : 'group-hover:text-[var(--brand-text)]'}`}>
          {label}
        </span>
      )}
    </label>
  );
};
