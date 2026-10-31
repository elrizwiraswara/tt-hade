const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '—';
  }

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

export function formatKbps(kbps: number | null | undefined): string {
  if (kbps === null || kbps === undefined) {
    return '—';
  }

  return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${kbps} kbps`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return '—';
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;

  return minutes ? `${minutes}m ${rest.toFixed(1)}s` : `${rest.toFixed(2)}s`;
}

export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
  if (width === null || width === undefined || height === null || height === undefined) {
    return '—';
  }

  return `${width}×${height}`;
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) {
    return '—';
  }

  return `${Math.round(fraction * 100)}%`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
