import Papa from 'papaparse';

/** One data row from the file. Cells are the raw strings exactly as parsed. */
export interface CsvRow {
  /** 1-based line number in the original file (see note on parseCsv). */
  line: number;
  cells: string[];
}

export interface CsvIssue {
  /** 1-based line number, when the issue can be tied to a line. */
  line: number | null;
  message: string;
}

export interface ParsedCsv {
  /** Header cells from the first non-blank line, as written (BOM removed). */
  headers: string[];
  /** Data rows after the header, blank lines skipped. */
  rows: CsvRow[];
  /** Malformed-CSV problems reported by the parser (e.g. an unclosed quote). */
  issues: CsvIssue[];
}

/**
 * Parses raw CSV text into a header and rows of raw strings (requirements A1).
 *
 * - No value interpretation: no number, date or unit parsing (that is normalization).
 * - The delimiter is detected by PapaParse; comma is the fallback.
 * - The first non-blank line is the header (A2 relies on header names).
 * - Blank lines (empty or whitespace-only cells) carry no data and are skipped.
 * - Line numbers assume one record per physical line; a quoted value that
 *   spans several lines shifts the numbers of the rows after it.
 */
export function parseCsv(content: string): ParsedCsv {
  const text = content.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(text, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });

  const issues: CsvIssue[] = result.errors
    // Reported for single-column or trivially small files; PapaParse falls back to comma.
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => ({
      line: typeof e.row === 'number' ? e.row + 1 : null,
      message: e.message,
    }));

  const nonBlank: CsvRow[] = [];
  result.data.forEach((cells, index) => {
    if (cells.some((cell) => cell.trim() !== '')) {
      nonBlank.push({ line: index + 1, cells });
    }
  });

  const [header, ...rows] = nonBlank;
  return { headers: header ? header.cells : [], rows, issues };
}
