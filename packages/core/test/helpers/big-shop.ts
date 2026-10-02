import { join } from 'node:path';
import { openDatabase, transaction, type Db } from '../../src/index.ts';
import { loadMigrationsFromDir, migrate } from '../../src/db/migrations.ts';
import { seedDemoShop } from '../../src/demo/seed.ts';
import { importItemsCsv, importPartiesCsv } from '../../src/import/csv.ts';
import { postVoucher } from '../../src/domain/posting/post.ts';
import { defaultSeriesId } from '../../src/masters/setup.ts';
import { MIGRATIONS_DIR } from './db.ts';

export interface BigShopSize {
  items: number;
  parties: number;
  vouchers: number;
}

/**
 * A shop several years into use, for timing the screens: the demo shop plus many items, customers
 * and posted bills, receipts and purchases. Built in one transaction so it is quick to create.
 * Dates run from 1 April 2026 to 15 October 2026 (the demo's pinned "today").
 */
export function buildBigShop(dir: string, size: BigShopSize): Db {
  const db = openDatabase(join(dir, 'big.db'));
  migrate(db, loadMigrationsFromDir(MIGRATIONS_DIR));
  seedDemoShop(db, { today: '2026-10-15' });
  const itemRows = ['Name,Alias,Group,Unit,HSN,GST %,Price,Min stock'];
  for (let i = 1; i <= size.items; i++) {
    itemRows.push(
      `Bulk Item ${i},Z${i},Group ${i % 40},Pcs,7307,${i % 3 === 0 ? 5 : 18},${50 + (i % 200)},10`,
    );
  }
  importItemsCsv(db, itemRows.join('\n'));
  const partyRows = ['Name,Type,GSTIN,State,Credit days'];
  for (let i = 1; i <= size.parties; i++) {
    partyRows.push(`Bulk Party ${i},${i % 5 === 0 ? 'Supplier' : 'Customer'},,33,30`);
  }
  importPartiesCsv(db, partyRows.join('\n'));

  const items = db
    .prepare("SELECT id, unit_id FROM item WHERE name LIKE 'Bulk Item %' ORDER BY id")
    .all();
  const customers = db
    .prepare(
      "SELECT a.id FROM account a JOIN account_group g ON g.id = a.group_id WHERE a.name LIKE 'Bulk Party %' AND g.name = 'Sundry Debtors' ORDER BY a.id",
    )
    .all();
  const suppliers = db
    .prepare(
      "SELECT a.id FROM account a JOIN account_group g ON g.id = a.group_id WHERE a.name LIKE 'Bulk Party %' AND g.name = 'Sundry Creditors' ORDER BY a.id",
    )
    .all();
  const cash = Number(
    db.prepare("SELECT id FROM account WHERE name = 'Cash' AND is_system = 1").get()?.['id'],
  );
  const sales = defaultSeriesId(db, 'sales');
  const purchases = defaultSeriesId(db, 'purchase');
  const receipts = defaultSeriesId(db, 'receipt');

  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const dateOf = (i: number) =>
    new Date(Date.UTC(2026, 3, 1 + Math.floor((i / size.vouchers) * 197)))
      .toISOString()
      .slice(0, 10);

  transaction(db, () => {
    // first buy plenty of every item so sales do not run short
    const bulkBuy = items.length;
    for (let i = 0; i < size.vouchers; i++) {
      const date = dateOf(i);
      const kind = i % 10;
      if (kind === 0) {
        const item = items[rnd(bulkBuy)]!;
        postVoucher(db, {
          type: 'purchase',
          seriesId: purchases,
          date,
          partyAccountId: Number(suppliers[rnd(suppliers.length)]!['id']),
          taxMode: 'local',
          partyBillNo: `P${i}`,
          partyBillDate: date,
          lines: [
            {
              itemId: Number(item['id']),
              qty: 50_000,
              unitId: Number(item['unit_id']),
              listPricePaise: 4000,
            },
          ],
        });
      } else if (kind === 1) {
        postVoucher(db, {
          type: 'receipt',
          seriesId: receipts,
          date,
          entries: [
            { accountId: cash, side: 'dr', amountPaise: 50_000 },
            {
              accountId: Number(customers[rnd(customers.length)]!['id']),
              side: 'cr',
              amountPaise: 50_000,
            },
          ],
        });
      } else {
        const lines = [0, 1].map(() => {
          const item = items[rnd(bulkBuy)]!;
          return {
            itemId: Number(item['id']),
            qty: 1000 * (1 + rnd(5)),
            unitId: Number(item['unit_id']),
            listPricePaise: 5000 + rnd(5000),
          };
        });
        const unique = lines.filter((l, k) => lines.findIndex((x) => x.itemId === l.itemId) === k);
        postVoucher(
          db,
          {
            type: 'sales',
            seriesId: sales,
            date,
            partyAccountId: Number(customers[rnd(customers.length)]!['id']),
            taxMode: 'local',
            lines: unique,
          },
          { legacyImport: true },
        );
      }
    }
  });
  return db;
}
