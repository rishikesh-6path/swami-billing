import { describe, expect, it } from 'vitest';
import { labelItems, labelsHtml, MAX_LABELS, ValidationError } from '../src/index.ts';
import { seedShop } from './helpers/shop.ts';

const item = (over: object = {}) => ({
  name: 'GI CLAMP 1/2"',
  alias: '1500',
  pricePaise: 4500,
  gstIncluded: true,
  mrpPaise: 0,
  ...over,
});

describe('item labels', () => {
  it('fills A4 sheets of 24 labels and starts a new sheet when one is full', () => {
    const r = labelsHtml([{ item: item(), count: 30 }]);
    expect(r).toMatchObject({ labels: 30, pages: 2 });
    expect(r.html.match(/class="label"/g)).toHaveLength(30);
    expect(labelsHtml([{ item: item(), count: 40 }], '4x10').pages).toBe(1);
  });

  it('shows the price, the code and the MRP only when it is set, and escapes names', () => {
    const plain = labelsHtml([{ item: item({ name: '<b>Pipe & Co</b>' }), count: 1 }]).html;
    expect(plain).toContain('&lt;b&gt;Pipe &amp; Co&lt;/b&gt;');
    expect(plain).not.toContain('<b>Pipe');
    expect(plain).toContain('₹ 45.00 <span class="gst">incl. GST</span>');
    expect(plain).toContain('Code 1500');
    expect(plain).not.toContain('MRP');
    expect(labelsHtml([{ item: item({ mrpPaise: 5000 }), count: 1 }]).html).toContain(
      'MRP ₹ 50.00',
    );
  });

  it('refuses no labels, broken counts and too many at once', () => {
    expect(() => labelsHtml([{ item: item(), count: 0 }])).toThrow(ValidationError);
    expect(() => labelsHtml([{ item: item(), count: 1.5 }])).toThrow(ValidationError);
    expect(() => labelsHtml([{ item: item(), count: MAX_LABELS + 1 }])).toThrow(/at most/);
  });

  it('takes names and prices from the item list, with GST, and refuses items with no price', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 10000, mrp_paise = 12000 WHERE id = 1');
    // item 1 is 18% from 2025-09-22
    expect(labelItems(s.db, [{ itemId: 1, count: 2 }], '2026-10-05')).toEqual([
      {
        item: {
          name: 'GI CLAMP',
          alias: '1500',
          pricePaise: 11800,
          gstIncluded: true,
          mrpPaise: 12000,
        },
        count: 2,
      },
    ]);
    s.db.exec('UPDATE item SET sale_price_paise = 5000 WHERE id = 2');
    s.db.exec('DELETE FROM item_tax_rate WHERE item_id = 2');
    expect(labelItems(s.db, [{ itemId: 2, count: 1 }], '2026-10-05')[0]!.item).toMatchObject({
      pricePaise: 5000,
      gstIncluded: false,
    });
    expect(() => labelItems(s.db, [{ itemId: 3, count: 1 }], '2026-10-05')).toThrow(
      /no selling price/,
    );
    expect(() => labelItems(s.db, [{ itemId: 999, count: 1 }], '2026-10-05')).toThrow(
      ValidationError,
    );
  });

  it('cuts long names by letters and never prints the label outlines', () => {
    const long = 'पाइप'.repeat(30);
    const html = labelsHtml([{ item: item({ name: long }), count: 1 }]).html;
    expect(html).toContain('…');
    expect(html).toContain('@media screen { .label { outline');
  });
});
