import type { ReportResult } from '../../../ipc/contract.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Card } from '../../components/ui.tsx';
import {
  formatBalance,
  formatDate,
  formatMoney,
  formatPercent,
  formatQty,
  rupees,
  VOUCHER_LABELS,
} from '../../lib/format.ts';

const m = (paise: number) => (paise === 0 ? '' : formatMoney(paise));
const dr = (signed: number) => (signed > 0 ? formatMoney(signed) : '');
const cr = (signed: number) => (signed < 0 ? formatMoney(-signed) : '');

/** Shows one report's result as plain tables. */
export function ReportBody({ result }: { result: ReportResult }) {
  switch (result.kind) {
    case 'ledger': {
      const l = result.data;
      return (
        <>
          <p className="muted">
            Opening balance: <strong>{formatBalance(l.openingPaise)}</strong>
          </p>
          <DataTable
            rowKey={(r) => r.voucherId}
            rows={l.rows}
            empty="No entries for this account in this period."
            columns={[
              { header: 'Date', cell: (r) => formatDate(r.date) },
              { header: 'Type', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
              { header: 'No.', cell: (r) => r.number },
              { header: 'Particulars', cell: (r) => r.particulars },
              { header: 'Debit', num: true, cell: (r) => m(r.drPaise) },
              { header: 'Credit', num: true, cell: (r) => m(r.crPaise) },
              { header: 'Balance', num: true, cell: (r) => formatBalance(r.balancePaise) },
            ]}
            footer={[
              '',
              '',
              '',
              'Total',
              m(l.totalDrPaise),
              m(l.totalCrPaise),
              formatBalance(l.closingPaise),
            ]}
          />
        </>
      );
    }
    case 'stock':
      if (result.countSheet) {
        return (
          <DataTable
            rowKey={(r) => r.itemId}
            rows={result.data.rows}
            empty="No items to show."
            columns={[
              { header: 'Group', cell: (r) => r.groupName },
              { header: 'Item', cell: (r) => r.name },
              { header: 'Code', cell: (r) => r.alias },
              {
                header: 'In the books',
                num: true,
                cell: (r) => `${formatQty(r.qty)} ${r.unitName}`,
              },
              { header: 'Counted', cell: () => <span className="count-box" /> },
            ]}
          />
        );
      }
      return (
        <>
          <p className="muted">
            Total stock value: <strong>{rupees(result.data.totalValuePaise)}</strong> (at average
            purchase cost)
          </p>
          <DataTable
            rowKey={(r) => r.itemId}
            rows={result.data.rows}
            empty="No items to show."
            rowClass={(r) => (r.isNegative ? 'row-bad' : r.isBelowMinimum ? 'row-warn' : '')}
            columns={[
              { header: 'Group', cell: (r) => r.groupName },
              { header: 'Item', cell: (r) => r.name },
              { header: 'Code', cell: (r) => r.alias },
              { header: 'Quantity', num: true, cell: (r) => `${formatQty(r.qty)} ${r.unitName}` },
              { header: 'Value', num: true, cell: (r) => m(r.valuePaise) },
              {
                header: 'Note',
                cell: (r) =>
                  r.isNegative ? 'Stock is below zero' : r.isBelowMinimum ? 'Running low' : '',
              },
            ]}
          />
        </>
      );
    case 'itemLedger': {
      const l = result.data;
      return (
        <>
          <p className="muted">
            Quantity at start: <strong>{formatQty(l.openingQty)}</strong>
          </p>
          <DataTable
            rowKey={(r, i) => `${r.voucherId}-${i}`}
            rows={l.rows}
            empty="No stock movement for this item in this period."
            columns={[
              { header: 'Date', cell: (r) => formatDate(r.date) },
              { header: 'Type', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
              { header: 'No.', cell: (r) => r.number },
              { header: 'Party', cell: (r) => r.partyName },
              { header: 'In', num: true, cell: (r) => (r.qtyIn ? formatQty(r.qtyIn) : '') },
              { header: 'Out', num: true, cell: (r) => (r.qtyOut ? formatQty(r.qtyOut) : '') },
              { header: 'Rate', num: true, cell: (r) => m(r.ratePaise) },
              { header: 'Balance', num: true, cell: (r) => formatQty(r.balanceQty) },
            ]}
            footer={['', '', '', '', '', '', 'Closing', formatQty(l.closingQty)]}
          />
        </>
      );
    }
    case 'trialBalance': {
      const t = result.data;
      return (
        <>
          {t.openingDifferencePaise !== 0 && (
            <p className="diff-note">
              The opening balances you entered do not balance by{' '}
              {rupees(Math.abs(t.openingDifferencePaise))}. Please check them under Customers,
              Suppliers and Items.
            </p>
          )}
          <DataTable
            rowKey={(r) => r.accountId}
            rows={t.rows}
            columns={[
              { header: 'Group', cell: (r) => r.groupName },
              { header: 'Account', cell: (r) => r.accountName },
              { header: 'Opening Dr', num: true, cell: (r) => dr(r.openingPaise) },
              { header: 'Opening Cr', num: true, cell: (r) => cr(r.openingPaise) },
              { header: 'Debit', num: true, cell: (r) => m(r.drPaise) },
              { header: 'Credit', num: true, cell: (r) => m(r.crPaise) },
              { header: 'Closing Dr', num: true, cell: (r) => dr(r.closingPaise) },
              { header: 'Closing Cr', num: true, cell: (r) => cr(r.closingPaise) },
            ]}
            footer={[
              '',
              'Total',
              '',
              '',
              m(t.totalDrPaise),
              m(t.totalCrPaise),
              m(t.closingDrPaise),
              m(t.closingCrPaise),
            ]}
          />
        </>
      );
    }
    case 'dayBook':
      return (
        <DataTable
          rowKey={(r) => r.voucherId}
          rows={result.data}
          rowClass={(r) => (r.isCancelled ? 'row-muted' : '')}
          columns={[
            { header: 'Date', cell: (r) => formatDate(r.date) },
            { header: 'Type', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
            { header: 'No.', cell: (r) => r.number },
            { header: 'Party', cell: (r) => r.partyName },
            { header: 'Note', cell: (r) => r.narration },
            { header: 'Amount', num: true, cell: (r) => m(r.totalPaise) },
            { header: '', cell: (r) => (r.isCancelled ? 'Cancelled' : '') },
          ]}
        />
      );
    case 'daySummary': {
      const d = result.data;
      return (
        <div className="stat-row">
          <Card className="stat">
            <span className="stat-label">Cash received</span>
            <span className="stat-value">{rupees(d.cashInPaise)}</span>
          </Card>
          <Card className="stat">
            <span className="stat-label">Cash paid out</span>
            <span className="stat-value">{rupees(d.cashOutPaise)}</span>
          </Card>
          <Card className="stat">
            <span className="stat-label">Cash in hand at end of day</span>
            <span className="stat-value">{rupees(d.cashClosingPaise)}</span>
          </Card>
          <Card className="stat">
            <span className="stat-label">Cancelled bills</span>
            <span className="stat-value">{d.cancelledCount}</span>
          </Card>
          <div className="wide-card">
            <DataTable
              rowKey={(r) => r.voucherType}
              rows={d.byType}
              empty="No entries on this day."
              columns={[
                { header: 'What', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
                { header: 'How many', num: true, cell: (r) => r.count },
                { header: 'Amount', num: true, cell: (r) => formatMoney(r.totalPaise) },
              ]}
            />
          </div>
        </div>
      );
    }
    case 'outstanding':
      return (
        <DataTable
          rowKey={(r) => r.accountId}
          rows={result.data}
          empty="Nothing is outstanding."
          columns={[
            { header: 'Party', cell: (r) => r.accountName },
            { header: 'Phone', cell: (r) => r.phone },
            { header: 'Outstanding', num: true, cell: (r) => formatMoney(r.outstandingPaise) },
            { header: '0-30 days', num: true, cell: (r) => m(r.buckets.upTo30) },
            { header: '31-60', num: true, cell: (r) => m(r.buckets.upTo60) },
            { header: '61-90', num: true, cell: (r) => m(r.buckets.upTo90) },
            { header: 'Over 90', num: true, cell: (r) => m(r.buckets.over90) },
            { header: 'Advance', num: true, cell: (r) => m(r.advancePaise) },
          ]}
          footer={[
            'Total',
            '',
            formatMoney(result.data.reduce((t, r) => t + r.outstandingPaise, 0)),
            '',
            '',
            '',
            '',
            '',
          ]}
        />
      );
    case 'reorder':
      return (
        <DataTable
          rowKey={(r) => r.itemId}
          rows={result.data}
          empty="Nothing is running low."
          columns={[
            { header: 'Group', cell: (r) => r.groupName },
            { header: 'Item', cell: (r) => r.name },
            { header: 'Code', cell: (r) => r.alias },
            { header: 'In stock', num: true, cell: (r) => `${formatQty(r.qty)} ${r.unitName}` },
            { header: 'Minimum', num: true, cell: (r) => formatQty(r.minStockQty) },
            { header: 'Needed', num: true, cell: (r) => formatQty(r.shortfallQty) },
            { header: 'Last bought from', cell: (r) => r.lastSupplier },
            {
              header: 'Last cost',
              num: true,
              cell: (r) => (r.lastCostPaise === null ? '' : formatMoney(r.lastCostPaise)),
            },
          ]}
        />
      );
    case 'purchasesForCa': {
      const p = result.data;
      return (
        <DataTable
          rowKey={(r, i) => `${r.voucherId}-${r.rateBp}-${i}`}
          rows={p.rows}
          empty="No purchases in this period."
          columns={[
            { header: 'Supplier', cell: (r) => r.supplierName },
            { header: 'GST number', cell: (r) => r.supplierGstin },
            { header: 'Invoice', cell: (r) => r.invoiceNumber },
            {
              header: 'Invoice date',
              cell: (r) => (r.invoiceDate ? formatDate(r.invoiceDate) : ''),
            },
            { header: 'Corrects invoice', cell: (r) => r.originalInvoiceNumber },
            { header: 'Kind', cell: (r) => r.kind },
            { header: 'GST %', num: true, cell: (r) => formatPercent(r.rateBp) },
            { header: 'Taxable', num: true, cell: (r) => m(r.taxablePaise) },
            { header: 'CGST', num: true, cell: (r) => m(r.cgstPaise) },
            { header: 'SGST', num: true, cell: (r) => m(r.sgstPaise) },
            { header: 'IGST', num: true, cell: (r) => m(r.igstPaise) },
          ]}
          footer={[
            'Total (returns and notes taken off)',
            '',
            '',
            '',
            '',
            '',
            '',
            m(p.totals.taxablePaise),
            m(p.totals.cgstPaise),
            m(p.totals.sgstPaise),
            m(p.totals.igstPaise),
          ]}
        />
      );
    }
    case 'salesRegister':
    case 'purchaseRegister': {
      const reg = result.data;
      const supplierColumn =
        result.kind === 'purchaseRegister'
          ? [
              {
                header: "Supplier's invoice",
                cell: (r: (typeof reg.rows)[number]) =>
                  r.partyBillNo
                    ? `${r.partyBillNo}${r.partyBillDate ? ` (${formatDate(r.partyBillDate)})` : ''}`
                    : '',
              },
            ]
          : [];
      return (
        <DataTable
          rowKey={(r) => r.voucherId}
          rows={reg.rows}
          rowClass={(r) => (r.isCancelled ? 'row-muted' : '')}
          columns={[
            { header: 'Date', cell: (r) => formatDate(r.date) },
            { header: 'Type', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
            { header: 'No.', cell: (r) => r.number },
            { header: 'Party', cell: (r) => r.partyName },
            { header: 'GST number', cell: (r) => r.partyGstin },
            ...supplierColumn,
            { header: 'Taxable', num: true, cell: (r) => m(r.taxablePaise) },
            { header: 'CGST', num: true, cell: (r) => m(r.cgstPaise) },
            { header: 'SGST', num: true, cell: (r) => m(r.sgstPaise) },
            { header: 'IGST', num: true, cell: (r) => m(r.igstPaise) },
            { header: 'Total', num: true, cell: (r) => m(r.totalPaise) },
          ]}
          footer={[
            '',
            '',
            '',
            'Total (returns taken off)',
            '',
            ...(supplierColumn.length ? [''] : []),
            m(reg.totals.taxablePaise),
            m(reg.totals.cgstPaise),
            m(reg.totals.sgstPaise),
            m(reg.totals.igstPaise),
            m(reg.totals.totalPaise),
          ]}
        />
      );
    }
    case 'gstSummary': {
      const g = result.data;
      const side = (title: string, rows: typeof g.output) => (
        <>
          <h2>{title}</h2>
          <DataTable
            rowKey={(r) => r.rateBp}
            rows={rows}
            empty="None in this period."
            columns={[
              { header: 'GST rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable value', num: true, cell: (r) => formatMoney(r.taxablePaise) },
              { header: 'CGST', num: true, cell: (r) => m(r.cgstPaise) },
              { header: 'SGST', num: true, cell: (r) => m(r.sgstPaise) },
              { header: 'IGST', num: true, cell: (r) => m(r.igstPaise) },
            ]}
          />
        </>
      );
      return (
        <>
          {side('Sales (tax you collected)', g.output)}
          {side('Purchases (tax you paid)', g.input)}
          <Card className="stat">
            <span className="stat-label">
              {g.netPayablePaise >= 0
                ? 'GST to pay for this period'
                : 'GST credit to carry forward'}
            </span>
            <span className="stat-value">{rupees(Math.abs(g.netPayablePaise))}</span>
            <span className="muted">
              Tax on sales {rupees(g.outputTax.totalPaise)}, less tax paid on purchases{' '}
              {rupees(g.inputTax.totalPaise)}
            </span>
          </Card>
        </>
      );
    }
    case 'gstr1': {
      const g = result.data;
      return (
        <>
          <p className="muted">
            The Export button saves these tables as separate spreadsheet files for your CA.
          </p>
          <h2>Sales to registered customers (table 4)</h2>
          <DataTable
            rowKey={(r) => `${r.voucherId}-${r.rateBp}`}
            rows={g.b2b}
            empty="None."
            columns={[
              { header: 'GST number', cell: (r) => r.gstin },
              { header: 'Customer', cell: (r) => r.partyName },
              { header: 'Bill', cell: (r) => r.docNumber },
              { header: 'Date', cell: (r) => formatDate(r.date) },
              { header: 'Rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable', num: true, cell: (r) => formatMoney(r.taxablePaise) },
              {
                header: 'Tax',
                num: true,
                cell: (r) => formatMoney(r.cgstPaise + r.sgstPaise + r.igstPaise),
              },
            ]}
          />
          <h2>Large sales to customers without GST, other states (table 5)</h2>
          <DataTable
            rowKey={(r) => `${r.voucherId}-${r.rateBp}`}
            rows={g.b2cl}
            empty="None."
            columns={[
              { header: 'Bill', cell: (r) => r.docNumber },
              { header: 'Date', cell: (r) => formatDate(r.date) },
              { header: 'State', cell: (r) => r.pos },
              { header: 'Rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable', num: true, cell: (r) => formatMoney(r.taxablePaise) },
              { header: 'IGST', num: true, cell: (r) => formatMoney(r.igstPaise) },
            ]}
          />
          <h2>Other sales to customers without GST (table 7)</h2>
          <DataTable
            rowKey={(r) => `${r.pos}-${r.rateBp}`}
            rows={g.b2cs}
            empty="None."
            columns={[
              { header: 'State', cell: (r) => r.pos },
              { header: 'Rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable', num: true, cell: (r) => formatMoney(r.taxablePaise) },
              { header: 'CGST', num: true, cell: (r) => m(r.cgstPaise) },
              { header: 'SGST', num: true, cell: (r) => m(r.sgstPaise) },
              { header: 'IGST', num: true, cell: (r) => m(r.igstPaise) },
            ]}
          />
          <h2>Credit notes (table 9B)</h2>
          <DataTable
            rowKey={(r) => `${r.voucherId}-${r.rateBp}`}
            rows={g.notes}
            empty="None."
            columns={[
              { header: 'Note', cell: (r) => r.docNumber },
              { header: 'Date', cell: (r) => formatDate(r.date) },
              { header: 'Against bill', cell: (r) => r.refDocNumber },
              { header: 'Rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable', num: true, cell: (r) => formatMoney(r.taxablePaise) },
            ]}
          />
          <h2>Nil-rated and exempt sales (table 8)</h2>
          <DataTable
            rowKey={(r) => r.description}
            rows={g.nilRated}
            columns={[
              { header: 'Description', cell: (r) => r.description },
              { header: 'Value', num: true, cell: (r) => m(r.taxablePaise) },
            ]}
          />
          <h2>HSN summary (table 12)</h2>
          <DataTable
            rowKey={(r) => `${r.hsn}-${r.uqc}-${r.rateBp}`}
            rows={g.hsn}
            empty="None."
            columns={[
              { header: 'HSN', cell: (r) => r.hsn },
              { header: 'Unit', cell: (r) => r.uqc },
              { header: 'Quantity', num: true, cell: (r) => formatQty(r.qty) },
              { header: 'Rate', cell: (r) => formatPercent(r.rateBp) },
              { header: 'Taxable', num: true, cell: (r) => formatMoney(r.taxablePaise) },
              {
                header: 'Tax',
                num: true,
                cell: (r) => formatMoney(r.cgstPaise + r.sgstPaise + r.igstPaise),
              },
            ]}
          />
          <h2>Bills issued (table 13)</h2>
          <DataTable
            rowKey={(r) => `${r.nature}-${r.from}`}
            rows={g.documents}
            empty="None."
            columns={[
              { header: 'What', cell: (r) => r.nature },
              { header: 'From', cell: (r) => r.from },
              { header: 'To', cell: (r) => r.to },
              { header: 'How many', num: true, cell: (r) => r.total },
              { header: 'Cancelled', num: true, cell: (r) => r.cancelled },
            ]}
          />
        </>
      );
    }
    case 'gstr3b': {
      const g = result.data;
      return (
        <DataTable
          rowKey={(r) => r.label}
          rows={[
            {
              label: 'Sales with GST (3.1a)',
              taxable: g.taxableOutward.taxablePaise,
              igst: g.taxableOutward.igstPaise,
              cgst: g.taxableOutward.cgstPaise,
              sgst: g.taxableOutward.sgstPaise,
            },
            {
              label: 'Nil-rated and exempt sales (3.1c)',
              taxable: g.nilExemptOutward.taxablePaise,
              igst: 0,
              cgst: 0,
              sgst: 0,
            },
            ...g.interStateUnregistered.map((x) => ({
              label: `Other-state sales to customers without GST, state ${x.pos} (3.2)`,
              taxable: x.taxablePaise,
              igst: x.igstPaise,
              cgst: 0,
              sgst: 0,
            })),
            {
              label: 'Tax credit on purchases (4A5)',
              taxable: 0,
              igst: g.itc.igstPaise,
              cgst: g.itc.cgstPaise,
              sgst: g.itc.sgstPaise,
            },
          ]}
          columns={[
            { header: 'Table', cell: (r) => r.label },
            { header: 'Taxable value', num: true, cell: (r) => m(r.taxable) },
            { header: 'IGST', num: true, cell: (r) => m(r.igst) },
            { header: 'CGST', num: true, cell: (r) => m(r.cgst) },
            { header: 'SGST', num: true, cell: (r) => m(r.sgst) },
          ]}
          footer={[
            `Net tax payable (sales tax less credit): ${rupees(g.netTaxPayablePaise)}`,
            '',
            '',
            '',
            '',
          ]}
        />
      );
    }
    case 'profitAndLoss': {
      const p = result.data;
      const block = (
        title: string,
        rows: { accountId: number; name: string; amountPaise: number }[],
      ) =>
        rows.length === 0 ? null : (
          <>
            <h2>{title}</h2>
            <DataTable
              rowKey={(r) => r.accountId}
              rows={rows}
              columns={[
                { header: 'Account', cell: (r) => r.name },
                { header: 'Amount', num: true, cell: (r) => formatMoney(r.amountPaise) },
              ]}
            />
          </>
        );
      return (
        <>
          {block('Sales', p.sales)}
          {block('Other direct income', p.directIncomes)}
          {block('Purchases', p.purchases)}
          {block('Direct expenses', p.directExpenses)}
          <p>
            Stock at start <strong>{rupees(p.openingStockPaise)}</strong>, stock at end{' '}
            <strong>{rupees(p.closingStockPaise)}</strong>
          </p>
          <Card className="stat">
            <span className="stat-label">
              {p.grossProfitPaise >= 0 ? 'Gross profit' : 'Gross loss'}
            </span>
            <span className="stat-value">{rupees(Math.abs(p.grossProfitPaise))}</span>
          </Card>
          {block('Other income', p.indirectIncomes)}
          {block('Expenses', p.indirectExpenses)}
          <Card className="stat">
            <span className="stat-label">{p.netProfitPaise >= 0 ? 'Net profit' : 'Net loss'}</span>
            <span className="stat-value" data-testid="net-profit">
              {rupees(Math.abs(p.netProfitPaise))}
            </span>
          </Card>
        </>
      );
    }
    case 'balanceSheet': {
      const b = result.data;
      const side = (
        title: string,
        sections: typeof b.liabilities,
        extra: { name: string; amountPaise: number }[],
        total: number,
      ) => (
        <Card title={title} className="bs-side">
          {sections.map((s) => (
            <div key={s.groupName}>
              <h3>{s.groupName}</h3>
              <DataTable
                rowKey={(r) => r.accountId}
                rows={s.accounts}
                columns={[
                  { header: 'Account', cell: (r) => r.name },
                  { header: 'Amount', num: true, cell: (r) => formatMoney(r.amountPaise) },
                ]}
              />
            </div>
          ))}
          {extra.map((e) => (
            <p key={e.name}>
              {e.name}: <strong>{rupees(e.amountPaise)}</strong>
            </p>
          ))}
          <p className="bs-total">
            Total: <strong>{rupees(total)}</strong>
          </p>
        </Card>
      );
      return (
        <div className="bs-grid">
          {side(
            'What you owe (liabilities)',
            b.liabilities,
            [
              { name: 'Profit so far', amountPaise: b.netProfitPaise },
              ...(b.openingDifferencePaise > 0
                ? [
                    {
                      name: 'Difference in opening balances',
                      amountPaise: b.openingDifferencePaise,
                    },
                  ]
                : []),
            ],
            b.totalLiabilitiesPaise,
          )}
          {side(
            'What you own (assets)',
            b.assets,
            [
              { name: 'Stock', amountPaise: b.closingStockPaise },
              ...(b.openingDifferencePaise < 0
                ? [
                    {
                      name: 'Difference in opening balances',
                      amountPaise: -b.openingDifferencePaise,
                    },
                  ]
                : []),
            ],
            b.totalAssetsPaise,
          )}
        </div>
      );
    }
  }
}
