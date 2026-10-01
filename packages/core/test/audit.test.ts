import { describe, expect, it } from 'vitest';
import { listAudit } from '../src/audit.ts';
import { createAccount } from '../src/masters/accounts.ts';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { seedShop } from './helpers/shop.ts';

describe('listAudit', () => {
  it('describes vouchers and masters in plain words, newest first, with the cancel reason', () => {
    const s = seedShop();
    s.db.exec("INSERT INTO user (id, name, pin_hash, role) VALUES (1, 'Murugan', 'x', 'staff')");
    createAccount(
      s.db,
      { name: 'New Party', groupId: 12 },
      { userId: 1, now: '2026-10-01T08:00:00Z' },
    );
    const v = postVoucher(
      s.db,
      {
        type: 'receipt',
        seriesId: s.seriesId.receipt,
        date: '2026-10-01',
        createdBy: 1,
        entries: [
          { accountId: s.cash, side: 'dr', amountPaise: 100 },
          { accountId: s.partyA, side: 'cr', amountPaise: 100 },
        ],
      },
      { now: '2026-10-01T09:00:00Z' },
    );
    cancelVoucher(s.db, v.voucherId, {
      userId: 1,
      reason: 'Entered twice',
      now: '2026-10-01T10:00:00Z',
    });

    const rows = listAudit(s.db);
    expect(rows.map((r) => r.action)).toEqual(['cancel', 'create', 'create']);
    expect(rows[0]).toMatchObject({
      userName: 'Murugan',
      description: 'receipt 1 on 2026-10-01',
      reason: 'Entered twice',
    });
    expect(rows[2]).toMatchObject({ description: 'account New Party', userName: 'Murugan' });
    expect(listAudit(s.db, { text: 'murugan' })).toHaveLength(3);
    expect(listAudit(s.db, { text: 'cancel' })).toHaveLength(1);
    expect(listAudit(s.db, { from: '2026-10-02' })).toEqual([]);
  });
});
