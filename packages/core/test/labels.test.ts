import { describe, expect, it } from 'vitest';
import { labelItems, labelsHtml, MAX_LABELS, ValidationError } from '../src/index.ts';
import { seedShop } from './helpers/shop.ts';

const item = (over: object = {}) => ({
  name: 'GI CLAMP 1/2"',
  alias: '1500',
  pricePaise: 4500,
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
    expect(plain).toContain('₹ 45.00');
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

  it('takes names and prices from the item list, not from the screen', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 4500, mrp_paise = 5000 WHERE id = 1');
    expect(labelItems(s.db, [{ itemId: 1, count: 2 }])).toEqual([
      { item: { name: 'GI CLAMP', alias: '1500', pricePaise: 4500, mrpPaise: 5000 }, count: 2 },
    ]);
    expect(() => labelItems(s.db, [{ itemId: 999, count: 1 }])).toThrow(ValidationError);
  });
});
