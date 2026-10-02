import { describe, expect, it } from 'vitest';
import { toNameKey } from '../../src/domain/names.js';

describe('toNameKey', () => {
  it('matches branch names that differ only in case (sample: "Tel Aviv" vs "tel aviv")', () => {
    expect(toNameKey('Tel Aviv')).toBe(toNameKey('tel aviv'));
  });

  it('trims and collapses whitespace', () => {
    expect(toNameKey('  Rishon   LeZion ')).toBe('rishon lezion');
  });

  it('treats tabs and non-breaking spaces as whitespace', () => {
    expect(toNameKey('Cream\tcakes')).toBe('cream cakes');
    expect(toNameKey('Display 2')).toBe('display 2');
  });

  it('keeps distinct names distinct', () => {
    expect(toNameKey('Walk-in')).not.toBe(toNameKey('Display 2'));
  });

  it('returns an empty string for blank input', () => {
    expect(toNameKey('   ')).toBe('');
  });
});
