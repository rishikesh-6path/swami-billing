import type { Db } from '../../src/db/connection.ts';
import type { VoucherType } from '../../src/domain/posting/types.ts';
import { freshDb } from './db.ts';

export const VOUCHER_TYPES: VoucherType[] = [
  'sales',
  'sales_return',
  'purchase',
  'purchase_return',
  'receipt',
  'payment',
  'journal',
  'contra',
  'debit_note',
  'credit_note',
];

export interface Shop {
  db: Db;
  seriesId: Record<VoucherType, number>;
  fyId: number;
  cash: number;
  gpay: number;
  partyA: number;
  partyB: number;
  items: number[];
  sundry: { discount: number; freight: number; packing: number };
}

/** In-memory shop with one FY, a series per voucher type, parties, items, rates and sundries. */
export function seedShop(): Shop {
  const db = freshDb();
  db.exec(`
    INSERT INTO financial_year (id, start_date, end_date) VALUES (1, '2026-04-01', '2027-03-31');
    INSERT INTO setting (key, value) VALUES ('company.state_code', '33');
    INSERT INTO account (id, name, group_id, state_code) VALUES
      (11, 'AYAPPAN PIPE KUTTALAM', 12, '29'), (12, 'SELVAM TRADERS', 12, '29'), (13, 'GPAY SELVAM', 11, NULL),
      (14, 'Discount Allowed', 9, NULL), (15, 'Freight Income', 8, NULL), (16, 'Packing Income', 8, NULL);
    INSERT INTO item_group (id, name) VALUES (1, 'GI FITTING');
    INSERT INTO item (id, name, alias, group_id, unit_id, hsn) VALUES
      (1, 'GI CLAMP', '1500', 1, 1, '73079990'),
      (2, 'FINOLEX PIPE', '8450', 1, 2, '39172190'),
      (3, 'EXEMPT ITEM', 'E1', 1, 1, '4901');
    INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES
      (1, '2020-01-01', 2800), (1, '2025-09-22', 1800),
      (2, '2025-09-22', 1800), (3, '2025-09-22', 500);
    INSERT INTO bill_sundry (id, name, sign, affects_taxable, account_id) VALUES
      (1, 'Discount', -1, 1, 14), (2, 'Freight & Forwarding', 1, 1, 15), (3, 'Packing', 1, 0, 16);
  `);
  const seriesId = {} as Record<VoucherType, number>;
  const insertSeries = db.prepare('INSERT INTO voucher_series (voucher_type, name) VALUES (?, ?)');
  for (const type of VOUCHER_TYPES) {
    seriesId[type] = Number(insertSeries.run(type, 'Main').lastInsertRowid);
  }
  return {
    db,
    seriesId,
    fyId: 1,
    cash: 1,
    gpay: 13,
    partyA: 11,
    partyB: 12,
    items: [1, 2, 3],
    sundry: { discount: 1, freight: 2, packing: 3 },
  };
}

export function count(db: Db, sql: string, ...params: (string | number)[]): number {
  return Number(db.prepare(sql).get(...params)?.['n']);
}
