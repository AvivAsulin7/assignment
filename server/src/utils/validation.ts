// Request-shape checks for API input. Business rules (blank metadata, columns
// outside the file, empty files) are checked by the import service.

export const isString = (v: unknown): v is string => typeof v === 'string';

// Columns are zero-based indexes into the file's header (see parsing/columns.ts).
export const isColumnIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export const isColumns = (v: unknown): v is { timestamp: number; temperature: number } =>
  typeof v === 'object' &&
  v !== null &&
  isColumnIndex((v as Record<string, unknown>).timestamp) &&
  isColumnIndex((v as Record<string, unknown>).temperature);
