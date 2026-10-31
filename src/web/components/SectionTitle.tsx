import type { ReactNode } from 'react';

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="section-title">
      <span className="slashes" aria-hidden="true">
        //{' '}
      </span>
      {children}
    </h2>
  );
}
