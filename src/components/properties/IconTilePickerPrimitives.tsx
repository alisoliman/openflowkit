import React from 'react';
import { SearchField } from '@/components/ui/SearchField';

interface IconSearchFieldProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

export function IconSearchField({
  value,
  onChange,
  placeholder,
  disabled = false,
  onKeyDown,
}: IconSearchFieldProps): React.ReactElement {
  return (
    <SearchField
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
      placeholder={placeholder}
      surface="subtle"
      className="h-10 bg-[var(--brand-background)]"
    />
  );
}

interface IconTileScrollGridProps {
  children: React.ReactNode;
  className?: string;
  showLabels?: boolean;
}

export function IconTileScrollGrid({
  children,
  className = '',
  showLabels = false,
}: IconTileScrollGridProps): React.ReactElement {
  return (
    <div className={`max-h-40 overflow-y-auto rounded-[var(--brand-radius)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-2 custom-scrollbar ${className}`.trim()}>
      <div className={`grid gap-2 ${showLabels ? 'grid-cols-2' : 'grid-cols-6'}`}>
        {children}
      </div>
    </div>
  );
}
