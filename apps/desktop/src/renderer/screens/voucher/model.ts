import type { ItemSearchRow, PartyHit, VoucherDetail } from '@shopledger/core';
import { call } from '../../lib/api.ts';
import { formatMoney, formatQty, parseMoney, parsePercent, parseQty } from '../../lib/format.ts';

export type ItemVoucherKind = 'sales' | 'purchase' | 'sales_return' | 'purchase_return';

export interface KindConfig {
  title: string;
  partyLabel: string;
  partyKind: 'customer' | 'supplier';
  /** Which price is filled in when an item is picked. */
  priceFrom: 'sale' | 'cost';
  settleLabel: string;
  /** The original bill type a return must refer to. */
  returnsAgainst?: 'sales' | 'purchase';
  cashDefault: boolean;
}

export const KINDS: Record<ItemVoucherKind, KindConfig> = {
  sales: {
    title: 'New Sale',
    partyLabel: 'Customer',
    partyKind: 'customer',
    priceFrom: 'sale',
    settleLabel: 'Received now',
    cashDefault: true,
  },
  purchase: {
    title: 'New Purchase',
    partyLabel: 'Supplier',
    partyKind: 'supplier',
    priceFrom: 'cost',
    settleLabel: 'Paid now',
    cashDefault: false,
  },
  sales_return: {
    title: 'Sales Return',
    partyLabel: 'Customer',
    partyKind: 'customer',
    priceFrom: 'sale',
    settleLabel: 'Refunded now',
    returnsAgainst: 'sales',
    cashDefault: false,
  },
  purchase_return: {
    title: 'Purchase Return',
    partyLabel: 'Supplier',
    partyKind: 'supplier',
    priceFrom: 'cost',
    settleLabel: 'Refund received now',
    returnsAgainst: 'purchase',
    cashDefault: false,
  },
};

export interface Row {
  key: number;
  item: ItemSearchRow | null;
  /** What is typed in the item box (the search text, or the picked item's name). */
  text: string;
  qty: string;
  price: string;
  disc: string;
}

let nextKey = 1;
export const blankRow = (): Row => ({
  key: nextKey++,
  item: null,
  text: '',
  qty: '',
  price: '',
  disc: '',
});

export const isBlank = (r: Row): boolean =>
  r.item === null && r.text.trim() === '' && r.qty === '' && r.price === '';

/** Fills a row from a picked item; the price depends on the kind of bill. */
export function pickItem(row: Row, item: ItemSearchRow, kind: KindConfig): Row {
  const price = kind.priceFrom === 'sale' ? item.salePricePaise : item.costPaise;
  return { ...row, item, text: item.name, price: price > 0 ? formatMoney(price) : row.price };
}

export interface ParsedRow {
  qty: number;
  price: number;
  disc: number;
}

/** Reads the typed numbers of a row. `error` explains the first thing that is wrong, in plain words. */
export function parseRow(row: Row, index: number): { parsed: ParsedRow; error: string | null } {
  const label = `Row ${index + 1}`;
  const qty = row.qty === '' ? 0 : parseQty(row.qty);
  const price = row.price === '' ? 0 : parseMoney(row.price);
  const disc = row.disc === '' ? 0 : parsePercent(row.disc);
  let error: string | null = null;
  if (qty === null || qty < 0) error = `${label}: the quantity is not a valid number.`;
  else if (row.item && row.item.unitDecimals === 0 && qty % 1000 !== 0) {
    error = `${label}: ${row.item.name} is counted in whole ${row.item.unitName}, so the quantity cannot have decimals.`;
  } else if (price === null || price < 0) error = `${label}: the price is not a valid amount.`;
  else if (disc === null || disc < 0 || disc > 10000)
    error = `${label}: the discount must be between 0 and 100.`;
  return { parsed: { qty: qty ?? 0, price: price ?? 0, disc: disc ?? 0 }, error };
}

/** Loads the lines of an earlier bill as rows, looking the items up again so prices and units are current. */
export async function rowsFromDetail(
  detail: VoucherDetail,
  onDate: string,
  useDetailPrices: boolean,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const line of detail.lines) {
    const found = (
      await call('item.search', { text: line.alias ?? line.itemName, onDate, limit: 10 })
    ).find((i) => i.id === line.itemId);
    const item: ItemSearchRow = found ?? {
      id: line.itemId,
      name: line.itemName,
      alias: line.alias,
      unitId: line.unitId,
      unitName: line.unitName,
      unitDecimals: line.qty % 1000 === 0 ? 0 : 3,
      hsn: line.hsn,
      salePricePaise: line.pricePaise,
      costPaise: line.pricePaise,
      rateBp: line.taxRateBp,
      stockQty: 0,
    };
    rows.push({
      key: nextKey++,
      item,
      text: item.name,
      qty: formatQty(line.qty),
      price: formatMoney(
        useDetailPrices ? line.listPricePaise : (found?.salePricePaise ?? line.listPricePaise),
      ),
      disc: useDetailPrices && line.discBp > 0 ? String(line.discBp / 100) : '',
    });
  }
  return rows;
}

export type Party = Pick<PartyHit, 'id' | 'name'> &
  Partial<Pick<PartyHit, 'stateCode' | 'balancePaise' | 'creditDays'>>;
