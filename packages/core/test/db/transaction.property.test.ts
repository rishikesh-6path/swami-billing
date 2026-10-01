import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { openDatabase, transaction } from '../../src/db/connection.ts';

describe('transaction (property)', () => {
  it('keeps exactly the rows of transactions that completed, however others fail', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, v INTEGER NOT NULL)');

    const batch = fc.record({
      values: fc.array(fc.integer(), { minLength: 1, maxLength: 8 }),
      // index at which the transaction throws, or null if it completes
      failAt: fc.option(fc.nat({ max: 7 }), { nil: null }),
    });

    fc.assert(
      fc.property(fc.array(batch, { maxLength: 10 }), (batches) => {
        db.exec('DELETE FROM t');
        const insert = db.prepare('INSERT INTO t (batch, v) VALUES (?, ?)');
        let expected = 0;

        batches.forEach((b, batchNo) => {
          const fails = b.failAt !== null && b.failAt < b.values.length;
          try {
            transaction(db, () => {
              b.values.forEach((v, i) => {
                if (fails && i === b.failAt) throw new Error('injected failure');
                insert.run(batchNo, v);
              });
            });
            expected += b.values.length;
          } catch {
            // rolled back: contributes nothing
          }
        });

        const row = db.prepare('SELECT COUNT(*) AS n FROM t').get();
        expect(row?.['n']).toBe(expected);
        expect(db.isTransaction).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});
