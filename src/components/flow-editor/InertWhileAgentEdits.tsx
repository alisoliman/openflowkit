import React from 'react';
import { useIsAgentEditing } from '@/store/selectionHooks';

// Keeps editing controls on screen but out of reach while a Flowpilot turn edits the page.
export function InertWhileAgentEdits({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="contents" inert={useIsAgentEditing()}>
      {children}
    </div>
  );
}
