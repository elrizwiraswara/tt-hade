import type { VerificationCheck } from '../../shared/api.js';

export function isCheckList(value: unknown): value is VerificationCheck[] {
  return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && 'ok' in entry && 'name' in entry);
}

export function ChecksList({ checks }: { checks: VerificationCheck[] }) {
  return (
    <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {checks.map((check) => (
        <li key={check.name} className="row small">
          <span className={`badge ${check.ok ? 'badge-success' : 'badge-danger'}`}>{check.ok ? 'Pass' : 'Fail'}</span>
          <strong>{check.name}</strong>
          <span className="muted">{check.detail}</span>
        </li>
      ))}
    </ul>
  );
}
