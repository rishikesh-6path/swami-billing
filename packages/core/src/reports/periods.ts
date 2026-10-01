import type { Db } from '../db/connection.ts';

/** Start of the financial year containing `date`; the date itself if no year covers it. */
export function financialYearStart(db: Db, date: string): string {
  const row = db
    .prepare('SELECT start_date FROM financial_year WHERE start_date <= ? AND end_date >= ?')
    .get(date, date);
  return row ? String(row['start_date']) : date;
}

/** Income and expense accounts, which start every financial year at zero. */
export function nominalAccountIds(db: Db): Set<number> {
  return new Set(
    db
      .prepare(
        `WITH RECURSIVE tree(id, root_id) AS (
           SELECT id, id FROM account_group WHERE parent_id IS NULL
           UNION ALL SELECT g.id, t.root_id FROM account_group g JOIN tree t ON g.parent_id = t.id)
         SELECT a.id FROM account a JOIN tree t ON t.id = a.group_id
         JOIN account_group r ON r.id = t.root_id WHERE r.nature IN ('income', 'expense')`,
      )
      .all()
      .map((r) => Number(r['id'])),
  );
}
