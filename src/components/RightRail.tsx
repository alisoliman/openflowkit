import React from 'react';

interface RightRailProps {
  children: React.ReactNode;
}

export function RightRail({ children }: RightRailProps): React.ReactElement {
  return (
    <aside className="h-full min-h-0 w-[clamp(320px,30vw,420px)] shrink-0 border-l border-[var(--color-brand-border)]/80 bg-[var(--brand-surface)]/95 backdrop-blur-xl animate-in slide-in-from-right duration-200">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
    </aside>
  );
}
