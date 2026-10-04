import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import {
  applyPriceChange,
  can,
  getItem,
  previewPriceChange,
  stockSheetToCsv,
  stockStatus,
  ValidationError,
} from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

function priced(): Shop {
  const s = seedShop();
  s.db.exec(`
    UPDATE item SET sale_price_paise = 4500, mrp_paise = 5000 WHERE id = 1;
    UPDATE item SET sale_price_paise = 2233, mrp_paise = 0 WHERE id = 2;
    UPDATE item SET sale_price_paise = 0 WHERE id = 3;
    INSERT INTO item_group (id, name, parent_id) VALUES (2, 'SMALL FITTINGS', 1);
    INSERT INTO item (id, name, alias, group_id, unit_id, sale_price_paise) VALUES (4, 'SMALL ELBOW', 'S1', 2, 1, 1000);
  `);
  return s;
}

describe('bulk price change', () => {
  it('adds a percentage to every selling price and rounds to the nearest rupee', () => {
    const s = priced();
    const rows = previewPriceChange(s.db, { percentBp: 1000 }); // +10%
    const byId = Object.fromEntries(rows.map((r) => [r.itemId, r]));
    expect(byId[1]).toMatchObject({ oldSalePaise: 4500, newSalePaise: 5000 }); // 4950 -> 50.00
    expect(byId[2]).toMatchObject({ oldSalePaise: 2233, newSalePaise: 2500 }); // 2456.3 -> 25.00
    expect(byId[3]).toBeUndefined(); // no price, nothing to change
    expect(byId[1]!.newMrpPaise).toBe(5000); // MRP left alone unless asked
  });

  it('can round to 50 paise or to the paisa, and change the printed price too', () => {
    const s = priced();
    const fifty = previewPriceChange(s.db, { percentBp: 1000, rounding: 'fifty' });
    expect(fifty.find((r) => r.itemId === 2)?.newSalePaise).toBe(2450); // 2456 -> 24.50
    const exact = previewPriceChange(s.db, { percentBp: 1000, rounding: 'exact', alsoMrp: true });
    expect(exact.find((r) => r.itemId === 1)).toMatchObject({
      newSalePaise: 4950,
      newMrpPaise: 5500,
    });
    expect(exact.find((r) => r.itemId === 2)?.newMrpPaise).toBe(0); // no MRP stays none
  });

  it('takes a percentage off, never below one rounding step, and refuses silly changes', () => {
    const s = priced();
    const down = previewPriceChange(s.db, { percentBp: -9000, rounding: 'rupee' });
    expect(down.find((r) => r.itemId === 4)?.newSalePaise).toBe(100); // 1.00, not 0
    for (const percentBp of [0, -9001, 100001, 1.5])
      expect(() => previewPriceChange(s.db, { percentBp })).toThrow(ValidationError);
  });

  it('limits the change to one group and the groups inside it', () => {
    const s = priced();
    const small = previewPriceChange(s.db, { groupId: 2, percentBp: 1000 });
    expect(small.map((r) => r.itemId)).toEqual([4]);
    const all = previewPriceChange(s.db, { groupId: 1, percentBp: 1000 });
    expect(all.map((r) => r.itemId).sort()).toEqual([1, 2, 4]);
  });

  it('applies in one step with an audit row per item, and old bills keep their price', () => {
    const s = priced();
    const old = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: '2026-10-05',
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 4500 }],
    });
    const before = s.db.prepare('SELECT total_paise FROM voucher WHERE id = ?').get(old.voucherId);
    expect(applyPriceChange(s.db, { percentBp: 1000 }, { userId: undefined })).toEqual({
      changed: 3,
    });
    expect(getItem(s.db, 1)?.salePricePaise).toBe(5000);
    const after = s.db.prepare('SELECT total_paise FROM voucher WHERE id = ?').get(old.voucherId);
    expect(after).toEqual(before);
    const audits = s.db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'price_change'")
      .get();
    expect(Number(audits?.['n'])).toBe(3);
    // a second run of the same preview has changes too (it is a fresh percentage), but nothing is left half done
    expect(() => applyPriceChange(s.db, { groupId: 99, percentBp: 1000 })).toThrow(
      /No price would change/,
    );
  });

  it('is for the owner only', () => {
    expect(can('owner', 'change_prices')).toBe(true);
    expect(can('staff', 'change_prices')).toBe(false);
  });
});

describe('stock counting sheet', () => {
  it('lists every item with an empty Counted column and no values', () => {
    const s = priced();
    const csv = stockSheetToCsv(stockStatus(s.db, { asOn: '2026-10-31' }));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Group,Item,Alias,Unit,In the books,Counted');
    expect(lines.length).toBe(1 + 4);
    expect(lines.every((l) => l.split(',').length === 6)).toBe(true);
    expect(lines[1]).toMatch(/,$/);
    expect(csv).not.toMatch(/Value/);
  });
});
