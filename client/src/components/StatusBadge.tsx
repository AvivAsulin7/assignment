import type { FridgeStatus } from '../types';

/** Display labels for the status computed by the server. No rules are evaluated here. */
export const STATUS_LABEL: Record<FridgeStatus | 'none', string> = {
  excursion: 'Above 5 °C',
  warming: 'Warming',
  gaps: 'Data gaps',
  ok: 'OK',
  none: 'No data',
};

export const statusKey = (status: FridgeStatus | null) => status ?? 'none';

export function StatusBadge({ status }: { status: FridgeStatus | null }) {
  const key = statusKey(status);
  return <span className={`badge status-${key}`}>{STATUS_LABEL[key]}</span>;
}
