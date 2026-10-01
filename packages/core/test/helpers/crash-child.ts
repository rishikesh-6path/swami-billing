// Runs in its own process (started by crash.test.ts): posts sales bills as fast as it can until it is killed.
import { openDatabase } from '../../src/db/connection.ts';
import { postVoucher } from '../../src/domain/posting/post.ts';
import { listItems } from '../../src/masters/items.ts';
import { defaultSeriesId } from '../../src/masters/setup.ts';

const db = openDatabase(process.argv[2] ?? '');
const item = listItems(db)[0]!;
const party = db
  .prepare(
    "SELECT id FROM account WHERE group_id = (SELECT id FROM account_group WHERE name = 'Sundry Debtors') LIMIT 1",
  )
  .get()!;
const seriesId = defaultSeriesId(db, 'sales');
for (let n = 1; ; n++) {
  postVoucher(db, {
    type: 'sales',
    seriesId,
    date: '2026-10-15',
    partyAccountId: Number(party['id']),
    taxMode: 'local',
    lines: [
      {
        itemId: item.id,
        qty: 1000 + (n % 7) * 1000,
        unitId: item.unitId,
        listPricePaise: 4500 + n,
      },
    ],
    createdBy: undefined,
  });
  process.stdout.write(`posted ${n}\n`);
}
