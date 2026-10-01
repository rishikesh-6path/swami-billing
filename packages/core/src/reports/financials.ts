import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoney } from '../money.ts';
import { toCsv } from './csv.ts';
import { stockStatus } from './stock.ts';

/** Earlier than any real voucher; used to ask for "everything since the books began". */
export const BOOKS_START = '1970-01-01';

export interface AmountLine {
  accountId: number;
  name: string;
  amountPaise: Paise;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  sales: AmountLine[];
  directIncomes: AmountLine[];
  purchases: AmountLine[];
  directExpenses: AmountLine[];
  indirectIncomes: AmountLine[];
  indirectExpenses: AmountLine[];
  openingStockPaise: Paise;
  closingStockPaise: Paise;
  grossProfitPaise: Paise;
  netProfitPaise: Paise;
}

interface AccountInfo {
  id: number;
  name: string;
  rootName: string;
  rootNature: string;
  /** Signed opening balance, Dr positive. */
  opening: Paise;
}

function accounts(db: Db): AccountInfo[] {
  return db
    .prepare(
      `WITH RECURSIVE tree(id, root_id) AS (
         SELECT id, id FROM account_group WHERE parent_id IS NULL
         UNION ALL SELECT g.id, t.root_id FROM account_group g JOIN tree t ON g.parent_id = t.id)
       SELECT a.id, a.name, r.name AS root_name, r.nature AS root_nature,
              a.opening_balance_paise * CASE a.opening_is_dr WHEN 1 THEN 1 ELSE -1 END AS opening
       FROM account a JOIN tree t ON t.id = a.group_id JOIN account_group r ON r.id = t.root_id
       ORDER BY a.name`,
    )
    .all()
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      rootName: String(r['root_name']),
      rootNature: String(r['root_nature']),
      opening: Number(r['opening']),
    }));
}

/** Net debit minus credit per account for posted vouchers in [from, to]. */
function movement(db: Db, from: string, to: string): Map<number, Paise> {
  const map = new Map<number, Paise>();
  for (const r of db
    .prepare(
      `SELECT j.account_id, SUM(j.dr_paise) - SUM(j.cr_paise) AS net
       FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
       WHERE v.status = 'posted' AND v.date BETWEEN ? AND ? GROUP BY j.account_id`,
    )
    .all(from, to)) {
    map.set(Number(r['account_id']), Number(r['net']));
  }
  return map;
}

function previousDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const sumOf = (lines: AmountLine[]) => lines.reduce((t, l) => t + l.amountPaise, 0);

/**
 * Trading and profit & loss account. Income and expense accounts are classified by the root
 * of their account group. Stock is valued at weighted-average cost (see stockStatus), the
 * opening figure as of the day before `from` and the closing figure as of `to`.
 */
export function profitAndLoss(db: Db, args: { from: string; to: string }): ProfitAndLoss {
  const net = movement(db, args.from, args.to);
  const bucket = (roots: string[], nature: 'income' | 'expense', fallback = false) =>
    accounts(db)
      .filter((a) => a.rootNature === nature && (roots.includes(a.rootName) || fallback))
      .map((a): AmountLine => {
        const dr = net.get(a.id) ?? 0;
        return { accountId: a.id, name: a.name, amountPaise: nature === 'income' ? -dr + 0 : dr };
      })
      .filter((l) => l.amountPaise !== 0);

  const known = ['Sales Accounts', 'Direct Incomes', 'Purchase Accounts', 'Direct Expenses'];
  const sales = bucket(['Sales Accounts'], 'income');
  const directIncomes = bucket(['Direct Incomes'], 'income');
  const purchases = bucket(['Purchase Accounts'], 'expense');
  const directExpenses = bucket(['Direct Expenses'], 'expense');
  // Indirect = Busy-style "everything else" of that nature, so custom root groups are not lost
  const indirectIncomes = accounts(db)
    .filter((a) => a.rootNature === 'income' && !known.includes(a.rootName))
    .map((a) => ({ accountId: a.id, name: a.name, amountPaise: -(net.get(a.id) ?? 0) + 0 }))
    .filter((l) => l.amountPaise !== 0);
  const indirectExpenses = accounts(db)
    .filter((a) => a.rootNature === 'expense' && !known.includes(a.rootName))
    .map((a) => ({ accountId: a.id, name: a.name, amountPaise: net.get(a.id) ?? 0 }))
    .filter((l) => l.amountPaise !== 0);

  const openingStockPaise = stockStatus(db, { asOn: previousDay(args.from) }).totalValuePaise;
  const closingStockPaise = stockStatus(db, { asOn: args.to }).totalValuePaise;
  const grossProfitPaise =
    sumOf(sales) +
    sumOf(directIncomes) +
    closingStockPaise -
    openingStockPaise -
    sumOf(purchases) -
    sumOf(directExpenses);
  return {
    from: args.from,
    to: args.to,
    sales,
    directIncomes,
    purchases,
    directExpenses,
    indirectIncomes,
    indirectExpenses,
    openingStockPaise,
    closingStockPaise,
    grossProfitPaise,
    netProfitPaise: grossProfitPaise + sumOf(indirectIncomes) - sumOf(indirectExpenses),
  };
}

export interface BalanceSheetSection {
  groupName: string;
  accounts: AmountLine[];
  totalPaise: Paise;
}

export interface BalanceSheet {
  asOn: string;
  liabilities: BalanceSheetSection[];
  assets: BalanceSheetSection[];
  closingStockPaise: Paise;
  /** Profit of all periods up to the date (nominal accounts are never closed out in this system). */
  netProfitPaise: Paise;
  /**
   * Entered opening balances plus opening stock should net to zero. A non-zero figure is shown
   * as its own line so the sheet always balances and the mistake stays visible.
   * Positive = more on the asset side was entered than the liability side.
   */
  openingDifferencePaise: Paise;
  totalLiabilitiesPaise: Paise;
  totalAssetsPaise: Paise;
}

/** Balance sheet as on a date, from the opening balances and every posted voucher up to it. */
export function balanceSheet(db: Db, args: { asOn: string }): BalanceSheet {
  const net = movement(db, BOOKS_START, args.asOn);
  const all = accounts(db);
  const sections = (nature: 'asset' | 'liability') => {
    const byRoot = new Map<string, BalanceSheetSection>();
    for (const a of all.filter((x) => x.rootNature === nature)) {
      const signed = a.opening + (net.get(a.id) ?? 0); // Dr positive
      const amountPaise = (nature === 'asset' ? signed : -signed) + 0;
      if (amountPaise === 0) continue;
      const section = byRoot.get(a.rootName) ?? {
        groupName: a.rootName,
        accounts: [],
        totalPaise: 0,
      };
      section.accounts.push({ accountId: a.id, name: a.name, amountPaise });
      section.totalPaise += amountPaise;
      byRoot.set(a.rootName, section);
    }
    return [...byRoot.values()];
  };

  const liabilities = sections('liability');
  const assets = sections('asset');
  const closingStockPaise = stockStatus(db, { asOn: args.asOn }).totalValuePaise;
  const netProfitPaise = profitAndLoss(db, { from: BOOKS_START, to: args.asOn }).netProfitPaise;

  const assetTotal = assets.reduce((t, s) => t + s.totalPaise, 0) + closingStockPaise;
  const liabilityTotal = liabilities.reduce((t, s) => t + s.totalPaise, 0) + netProfitPaise;
  // Whatever is left over is exactly the unbalanced part of the opening entries.
  const openingDifferencePaise = assetTotal - liabilityTotal;
  return {
    asOn: args.asOn,
    liabilities,
    assets,
    closingStockPaise,
    netProfitPaise,
    openingDifferencePaise,
    totalLiabilitiesPaise: liabilityTotal + Math.max(openingDifferencePaise, 0),
    totalAssetsPaise: assetTotal + Math.max(-openingDifferencePaise, 0),
  };
}

export function profitAndLossToCsv(p: ProfitAndLoss): string {
  const lines = (title: string, list: AmountLine[]) =>
    list.map((l) => [title, l.name, formatMoney(l.amountPaise)]);
  return toCsv(
    ['Section', 'Account', 'Amount'],
    [
      ...lines('Sales', p.sales),
      ...lines('Direct income', p.directIncomes),
      ['Stock', 'Opening stock', formatMoney(p.openingStockPaise)],
      ...lines('Purchases', p.purchases),
      ...lines('Direct expenses', p.directExpenses),
      ['Stock', 'Closing stock', formatMoney(p.closingStockPaise)],
      ['Result', 'Gross profit', formatMoney(p.grossProfitPaise)],
      ...lines('Other income', p.indirectIncomes),
      ...lines('Expenses', p.indirectExpenses),
      ['Result', 'Net profit', formatMoney(p.netProfitPaise)],
    ],
  );
}

export function balanceSheetToCsv(b: BalanceSheet): string {
  const side = (title: string, list: BalanceSheetSection[]) =>
    list.flatMap((s) =>
      s.accounts.map((a) => [title, s.groupName, a.name, formatMoney(a.amountPaise)]),
    );
  return toCsv(
    ['Side', 'Group', 'Account', 'Amount'],
    [
      ...side('Liabilities', b.liabilities),
      ['Liabilities', 'Profit', 'Profit and loss (all periods)', formatMoney(b.netProfitPaise)],
      ...(b.openingDifferencePaise > 0
        ? [
            [
              'Liabilities',
              'Check',
              'Difference in opening balances',
              formatMoney(b.openingDifferencePaise),
            ],
          ]
        : []),
      ['Liabilities', '', 'Total', formatMoney(b.totalLiabilitiesPaise)],
      ...side('Assets', b.assets),
      ['Assets', 'Stock', 'Closing stock', formatMoney(b.closingStockPaise)],
      ...(b.openingDifferencePaise < 0
        ? [
            [
              'Assets',
              'Check',
              'Difference in opening balances',
              formatMoney(-b.openingDifferencePaise),
            ],
          ]
        : []),
      ['Assets', '', 'Total', formatMoney(b.totalAssetsPaise)],
    ],
  );
}
