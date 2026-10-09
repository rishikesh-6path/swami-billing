import { writeAudit, type Ctx } from '../audit.ts';
import type { Db } from '../db/connection.ts';
import { showDate } from '../dates.ts';
import type { VoucherDetail } from '../domain/posting/detail.ts';
import { previewItemVoucher } from '../domain/posting/preview.ts';
import type { ItemVoucherInput } from '../domain/posting/types.ts';
import { ValidationError } from '../errors.ts';
import type { Company } from '../users/company.ts';
import { renderDocument, type PaperSize } from './invoice.ts';

/** How long the prices on an estimate are offered for. */
export const ESTIMATE_DAYS = 7;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * An estimate (quotation) of a sale that is still on the screen. The figures are worked out exactly
 * as the bill would be, but nothing is saved: it has no number and touches no account or stock.
 */
export function buildEstimate(db: Db, draft: ItemVoucherInput): VoucherDetail {
  // every row with an item must be complete, as saving would demand: an estimate never quietly
  // leaves out a line the customer asked about
  const unit = db.prepare('SELECT decimals FROM unit WHERE id = ?');
  draft.lines.forEach((l, i) => {
    if (l.itemId <= 0) return;
    if (l.qty <= 0) throw new ValidationError(`Row ${i + 1}: please enter the quantity.`);
    if (Number(unit.get(l.unitId)?.['decimals']) === 0 && l.qty % 1000 !== 0) {
      throw new ValidationError(`Row ${i + 1}: this item is sold in whole units.`);
    }
  });
  const preview = previewItemVoucher(db, draft);
  // a missing GST rate or figures that cannot be worked out would give a wrong price; the HSN code
  // and stock are not needed for a quotation
  const blocking = preview.problems.find((p) => p.kind === 'error' && !/HSN/.test(p.message));
  if (blocking) throw new ValidationError(blocking.message);
  const item = db.prepare(
    'SELECT i.name, i.alias, i.hsn, u.name AS unit_name FROM item i JOIN unit u ON u.id = i.unit_id WHERE i.id = ?',
  );
  const lines: VoucherDetail['lines'] = [];
  draft.lines.forEach((l, i) => {
    const p = preview.lines[i];
    if (!p || l.itemId <= 0 || l.qty <= 0) return;
    const it = item.get(l.itemId);
    if (!it) return;
    lines.push({
      lineNo: lines.length + 1,
      itemId: l.itemId,
      itemName: String(it['name']),
      alias: it['alias'] === null ? null : String(it['alias']),
      unitId: l.unitId,
      unitName: String(it['unit_name']),
      hsn: l.hsn ?? (it['hsn'] === null ? null : String(it['hsn'])),
      qty: l.qty,
      listPricePaise: l.listPricePaise,
      discBp: l.discBp ?? 0,
      pricePaise: p.pricePaise,
      amountPaise: p.amountPaise,
      taxRateBp: p.rateBp,
      taxablePaise: p.taxablePaise,
      cgstPaise: p.cgstPaise,
      sgstPaise: p.sgstPaise,
      igstPaise: p.igstPaise,
    });
  });
  if (lines.length === 0) {
    throw new ValidationError(
      'Please add at least one item with a quantity before making an estimate.',
    );
  }
  const party = db
    .prepare(
      'SELECT id, name, gstin, state_code, address, phone, is_system FROM account WHERE id = ?',
    )
    .get(draft.partyAccountId);
  const sundryName = db.prepare('SELECT name FROM bill_sundry WHERE id = ?');
  return {
    id: 0,
    voucherType: 'estimate',
    number: 0,
    displayNumber: '',
    seriesId: 0,
    seriesName: '',
    date: draft.date,
    status: 'draft',
    // the shared Cash customer is not named on an estimate
    party:
      party && !party['is_system']
        ? {
            id: Number(party['id']),
            name: String(party['name']),
            gstin: party['gstin'] === null ? null : String(party['gstin']),
            stateCode: party['state_code'] === null ? null : String(party['state_code']),
            address: party['address'] === null ? null : String(party['address']),
            phone: party['phone'] === null ? null : String(party['phone']),
          }
        : null,
    saleTypeName: null,
    broker: null,
    narration: draft.narration ?? null,
    subtotalPaise: preview.subtotalPaise,
    taxablePaise: preview.taxablePaise,
    taxPaise: preview.taxPaise,
    roundOffPaise: preview.roundOffPaise,
    totalPaise: preview.totalPaise,
    posStateCode: null,
    taxMode: draft.taxMode,
    partyBillNo: null,
    partyBillDate: null,
    company: null,
    refVoucher: null,
    modifiedFromId: null,
    createdByName: null,
    createdAt: '',
    lines,
    sundries: preview.sundries
      .filter((x) => x.signedPaise !== 0)
      .map((x) => ({
        billSundryId: x.billSundryId,
        name: String(sundryName.get(x.billSundryId)?.['name'] ?? 'Charge'),
        sign: x.signedPaise < 0 ? (-1 as const) : (1 as const),
        amountPaise: Math.abs(x.signedPaise),
      })),
    settlements: [],
    entries: [],
  };
}

/** The estimate as a page to print or save. */
export function renderEstimate(
  db: Db,
  draft: ItemVoucherInput,
  company: Company,
  size: PaperSize,
): { html: string; totalPaise: number; partyName: string | null } {
  const estimate = buildEstimate(db, draft);
  const until = showDate(addDays(draft.date, ESTIMATE_DAYS));
  const html = renderDocument(
    estimate,
    company,
    size,
    `This is an estimate, not a bill. Prices are offered until ${until}.`,
  );
  return { html, totalPaise: estimate.totalPaise, partyName: estimate.party?.name ?? null };
}

/** Records in Who Did What that an estimate was printed or saved (not when it was only shown). */
export function recordEstimate(
  db: Db,
  ctx: Ctx,
  given: { partyName: string | null; totalPaise: number },
): void {
  writeAudit(db, ctx, {
    action: 'estimate_printed',
    table: 'voucher',
    rowId: 0,
    after: { party: given.partyName ?? 'Cash', totalPaise: given.totalPaise },
  });
}
