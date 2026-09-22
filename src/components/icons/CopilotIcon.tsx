import React from 'react';

export function CopilotIcon({ className = 'h-6 w-6' }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        mask: 'url("/logos/github-copilot.svg") center / contain no-repeat',
        WebkitMask: 'url("/logos/github-copilot.svg") center / contain no-repeat',
      }}
    />
  );
}
