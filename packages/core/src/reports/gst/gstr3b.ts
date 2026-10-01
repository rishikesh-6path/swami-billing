import type { Db } from '../../db/connection.ts';
import type { Paise } from '../../money.ts';
import { toCsv, formatMoneyOrEmpty } from '../csv.ts';
import { companyStateCode, gstLines, isRegistered, type GstPeriod } from './common.ts';

export interface Gstr3b {
  period: GstPeriod;
  /** 3.1(a): outward taxable supplies (rate above zero), net of credit notes. */
  taxableOutward: { taxablePaise: Paise; igstPaise: Paise; cgstPaise: Paise; sgstPaise: Paise };
  /** 3.1(c): nil-rated and exempt outward supplies. */
  nilExemptOutward: { taxablePaise: Paise };
  /** 3.2: inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: { pos: string; taxablePaise: Paise; igstPaise: Paise }[];
  /** 4(A)(5): all other input tax credit, net of purchase returns. */
  itc: { igstPaise: Paise; cgstPaise: Paise; sgstPaise: Paise };
  /** Total output tax minus total ITC; set-off order between heads is applied when filing. */
  netTaxPayablePaise: Paise;
}

export function gstr3b(db: Db, period: GstPeriod): Gstr3b {
  const home = companyStateCode(db);
  const lines = gstLines(db, period);
  const outward = lines.filter(
    (l) => l.voucherType === 'sales' || l.voucherType === 'sales_return',
  );
  const inward = lines.filter(
    (l) => l.voucherType === 'purchase' || l.voucherType === 'purchase_return',
  );
  const sum = (src: typeof lines, pick: (l: (typeof lines)[number]) => number) =>
    src.reduce((t, l) => t + l.sign * pick(l), 0);

  const taxable = outward.filter((l) => l.rateBp > 0);
  const taxableOutward = {
    taxablePaise: sum(taxable, (l) => l.taxablePaise),
    igstPaise: sum(taxable, (l) => l.igstPaise),
    cgstPaise: sum(taxable, (l) => l.cgstPaise),
    sgstPaise: sum(taxable, (l) => l.sgstPaise),
  };

  const inter = new Map<string, { pos: string; taxablePaise: Paise; igstPaise: Paise }>();
  // 3.2 only breaks down supplies already shown in 3.1(a), i.e. taxable ones
  for (const l of taxable.filter((l) => !isRegistered(l.gstin) && l.pos !== '' && l.pos !== home)) {
    const row = inter.get(l.pos) ?? { pos: l.pos, taxablePaise: 0, igstPaise: 0 };
    row.taxablePaise += l.sign * l.taxablePaise;
    row.igstPaise += l.sign * l.igstPaise;
    inter.set(l.pos, row);
  }

  const itc = {
    igstPaise: sum(inward, (l) => l.igstPaise),
    cgstPaise: sum(inward, (l) => l.cgstPaise),
    sgstPaise: sum(inward, (l) => l.sgstPaise),
  };
  const outputTax = taxableOutward.igstPaise + taxableOutward.cgstPaise + taxableOutward.sgstPaise;
  return {
    period,
    taxableOutward,
    nilExemptOutward: {
      taxablePaise: sum(
        outward.filter((l) => l.rateBp === 0),
        (l) => l.taxablePaise,
      ),
    },
    interStateUnregistered: [...inter.values()].sort((a, b) => a.pos.localeCompare(b.pos)),
    itc,
    netTaxPayablePaise: outputTax - (itc.igstPaise + itc.cgstPaise + itc.sgstPaise),
  };
}

export function gstr3bToCsv(r: Gstr3b): string {
  const f = formatMoneyOrEmpty;
  const t = r.taxableOutward;
  return toCsv(
    [
      'Table',
      'Description',
      'Taxable value',
      'Integrated tax',
      'Central tax',
      'State/UT tax',
      'Total tax',
    ],
    [
      [
        '3.1(a)',
        'Outward taxable supplies (other than zero rated, nil rated and exempted)',
        f(t.taxablePaise),
        f(t.igstPaise),
        f(t.cgstPaise),
        f(t.sgstPaise),
        f(t.igstPaise + t.cgstPaise + t.sgstPaise),
      ],
      [
        '3.1(c)',
        'Other outward supplies (nil rated, exempted)',
        f(r.nilExemptOutward.taxablePaise),
        '',
        '',
        '',
        '',
      ],
      ...r.interStateUnregistered.map((x) => [
        '3.2',
        `Inter-State supplies to unregistered persons, place of supply ${x.pos}`,
        f(x.taxablePaise),
        f(x.igstPaise),
        '',
        '',
        f(x.igstPaise),
      ]),
      [
        '4(A)(5)',
        'All other ITC',
        '',
        f(r.itc.igstPaise),
        f(r.itc.cgstPaise),
        f(r.itc.sgstPaise),
        f(r.itc.igstPaise + r.itc.cgstPaise + r.itc.sgstPaise),
      ],
      ['', 'Net tax payable (output tax minus ITC)', '', '', '', '', f(r.netTaxPayablePaise)],
    ],
  );
}
