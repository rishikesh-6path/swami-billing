import { describe, expect, it } from 'vitest';
import { testPageHtml, type Company } from '../src/index.ts';

const company: Company = {
  name: 'Swami <Hardware>',
  address: 'Main Road',
  gstin: null,
  stateCode: '33',
  phone: null,
  invoiceFooter: '',
};

describe('printer test page', () => {
  it('names the shop safely, says it is not a bill, and fits each paper', () => {
    const a4 = testPageHtml(company, 'a4', { date: '2026-10-10', time: '09:05:33' });
    expect(a4).toContain('Swami &lt;Hardware&gt;');
    expect(a4).toContain('PRINTER TEST PAGE');
    expect(a4).toContain('This is not a bill.');
    expect(a4).toContain('Printed on 10-10-2026 at 09:05, on A4 paper.');
    expect(a4).toContain('₹ 1,234.50');
    expect(a4).toContain('size: A4');
    const roll = testPageHtml(company, 'thermal', { date: '2026-10-10', time: '09:05:33' });
    expect(roll).toContain('size: 80mm auto');
    expect(roll).toContain('the 80 mm receipt roll');
  });
});
