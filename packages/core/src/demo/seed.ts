import { createAccount } from '../masters/accounts.ts';
import { importItemsCsv, importPartiesCsv } from '../import/csv.ts';
import { searchItems } from '../masters/items.ts';
import { defaultSeriesId } from '../masters/setup.ts';
import { gstinCheckChar } from '../masters/validation.ts';
import { transaction, type Db } from '../db/connection.ts';
import { postVoucher } from '../domain/posting/post.ts';
import { createUser } from '../users/users.ts';
import { completeSetup, isSetupComplete } from '../users/setup.ts';

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

const ITEMS = `Name,Alias,Group,Unit,HSN,GST %,Sale Price,MRP,Opening Qty,Opening Rate,Min Stock
GI Clamp 1/2 inch,1500,Pipes & Fittings,Pcs,73079990,18,45.00,55.00,200,32.00,50
GI Clamp 3/4 inch,1501,Pipes & Fittings,Pcs,73079990,18,60.00,72.00,150,44.00,50
PVC Pipe 1 inch,8450,Pipes & Fittings,Metre,39172390,18,85.00,100.00,300.500,61.00,100
PVC Pipe 2 inch,8451,Pipes & Fittings,Metre,39172390,18,160.00,190.00,200,118.00,80
PVC Elbow 1 inch,8460,Pipes & Fittings,Pcs,39174000,18,22.00,28.00,400,14.00,100
PVC Tee 1 inch,8461,Pipes & Fittings,Pcs,39174000,18,28.00,35.00,300,18.00,100
CPVC Pipe 3/4 inch,8470,Pipes & Fittings,Metre,39172390,18,120.00,145.00,150,88.00,50
Brass Tap 1/2 inch,P21,Pipes & Fittings,Pcs,84818030,18,180.00,230.00,60,120.00,20
House Wire 1.5 sq mm Red,W15R,Electrical,Metre,85444999,18,18.50,22.00,900,12.50,200
House Wire 2.5 sq mm Red,W25R,Electrical,Metre,85444999,18,29.00,34.00,700,20.00,200
Switch 6A,S6,Electrical,Pcs,85365090,18,38.00,48.00,250,24.00,60
Socket 6A,S6S,Electrical,Pcs,85366990,18,52.00,65.00,200,33.00,60
MCB 16A Single Pole,M16,Electrical,Pcs,85362010,18,185.00,230.00,80,128.00,20
LED Bulb 9W,L9,Electrical,Pcs,85395000,12,95.00,120.00,300,62.00,80
Ceiling Fan 48 inch,F48,Electrical,Pcs,84145110,18,1850.00,2300.00,25,1380.00,5
Insulation Tape,T1,Electrical,Pcs,39191000,18,20.00,25.00,300,12.00,100
Hammer 500g,H5,Tools,Pcs,82054000,18,210.00,260.00,30,145.00,10
Screwdriver Set,SD6,Tools,Set,82054000,18,260.00,320.00,25,180.00,8
Measuring Tape 5m,MT5,Tools,Pcs,90178010,18,120.00,150.00,40,78.00,10
Wall Plug 8mm,WP8,Fasteners,Pcs,39269099,18,2.00,3.00,2000,1.10,500
Screw 1 inch,SC1,Fasteners,Pcs,73181500,18,1.50,2.00,3000,0.80,800
Cement 50kg Bag,C50,Fasteners,Bag,25232900,18,395.00,430.00,100,335.00,30
Notebook 100 pages,NB1,Fasteners,Pcs,48202000,12,45.00,55.00,100,30.00,20
Fevicol 100g,FV1,Fasteners,Pcs,35069190,18,48.00,58.00,120,32.00,30`;

const PARTIES = `Name,Type,GSTIN,State,Phone,Address,Credit Days,Opening Balance,Dr/Cr
Ayappan Pipe Kuttalam,Customer,${gstin('33', 'AAPFA1234F')},33,9840012345,Main Road Kuttalam,30,2365.00,Dr
Selvam Traders,Customer,,33,9840023456,Bus Stand Road,15,0,Dr
Murugan Electricals,Customer,${gstin('33', 'BQRPM5678K')},33,9840034567,Temple Street,30,0,Dr
Lakshmi Plumbing Works,Customer,,33,9840045678,Market Road,0,1200.00,Dr
Kumar Constructions,Customer,${gstin('29', 'CKLPK9012M')},29,9840056789,Bengaluru Highway,45,0,Dr
Finolex Distributors,Supplier,${gstin('33', 'DFINO3456P')},33,9840067890,Industrial Estate,45,15000.00,Cr
Havells Agency,Supplier,${gstin('33', 'EHAVL7890Q')},33,9840078901,Anna Salai,30,0,Cr
Anchor Wholesale,Supplier,${gstin('29', 'FANCH2345R')},29,9840089012,Electronic City,30,0,Cr`;

/** Small deterministic generator so the demo shop is identical on every run. */
function lcg(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return Math.floor((state / 4294967296) * max);
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DemoSummary {
  items: number;
  parties: number;
  vouchers: number;
  ownerName: string;
  ownerPin: string;
  staffName: string;
  staffPin: string;
}

/**
 * Builds a complete demo shop: setup, users, masters loaded through the CSV importers, and about
 * a month of purchases, sales and receipts ending on `today`. For demos, screenshots and tests.
 * Owner "Owner" PIN 1234; staff "Staff" PIN 1111.
 */
export function seedDemoShop(db: Db, args: { today: string }): DemoSummary {
  return transaction(db, () => {
    if (!isSetupComplete(db)) {
      completeSetup(db, {
        company: {
          name: 'Demo Hardware & Electricals',
          address: '12 Main Road, Kuttalam, Tamil Nadu',
          gstin: gstin('33', 'AAGFD0001A'),
          stateCode: '33',
          phone: '9840000000',
          invoiceFooter: 'Thank you. Goods once sold will not be taken back.',
        },
        ownerName: 'Owner',
        ownerPin: '1234',
        allowWeakPin: true,
        today: args.today,
      });
      createUser(db, { name: 'Staff', pin: '1111', role: 'staff', allowWeakPin: true });
    }
    const items = importItemsCsv(db, ITEMS);
    const parties = importPartiesCsv(db, PARTIES);
    if (items.skipped.length > 0 || parties.skipped.length > 0) {
      throw new Error(
        `Demo data was not accepted: ${JSON.stringify([...items.skipped, ...parties.skipped])}`,
      );
    }
    const bank = createAccount(db, { name: 'GPAY SELVAM', groupId: 11 });

    // opening balances that balance: cash and stock are funded by the owner's capital
    const stockValue = Number(
      db
        .prepare('SELECT COALESCE(SUM(opening_qty * opening_rate_paise / 1000), 0) AS v FROM item')
        .get()?.['v'],
    );
    const debtors = Number(
      db
        .prepare(
          'SELECT COALESCE(SUM(opening_balance_paise), 0) AS v FROM account WHERE group_id = 12',
        )
        .get()?.['v'],
    );
    const creditors = Number(
      db
        .prepare(
          'SELECT COALESCE(SUM(opening_balance_paise), 0) AS v FROM account WHERE group_id = 14',
        )
        .get()?.['v'],
    );
    const cash = 5_000_00;
    db.prepare('UPDATE account SET opening_balance_paise = ?, opening_is_dr = 1 WHERE id = 1').run(
      cash,
    );
    createAccount(db, {
      name: 'Owner Capital',
      groupId: 1,
      openingIsDr: false,
      openingBalancePaise: stockValue + debtors + cash - creditors,
    });

    const customers = [
      'Ayappan Pipe Kuttalam',
      'Selvam Traders',
      'Murugan Electricals',
      'Lakshmi Plumbing Works',
      'Kumar Constructions',
    ];
    const suppliers = ['Finolex Distributors', 'Havells Agency', 'Anchor Wholesale'];
    const id = (name: string) =>
      Number(db.prepare('SELECT id FROM account WHERE name = ?').get(name)?.['id']);
    const item = (alias: string) => {
      const found = searchItems(db, alias, { limit: 1 })[0]!;
      return {
        itemId: found.id,
        unitId: found.unitId,
        price: found.salePricePaise,
        whole: found.unitDecimals === 0,
      };
    };
    const aliases = ITEMS.split('\n')
      .slice(1)
      .map((l) => l.split(',')[1]!);
    const rnd = lcg(42);
    const qty = (whole: boolean, units: number) => (whole ? units * 1000 : units * 1000 + 500);
    let vouchers = 0;
    const startDay = -30;
    const firstYearStart = String(
      db.prepare('SELECT MIN(start_date) AS d FROM financial_year').get()?.['d'],
    );

    for (let day = startDay; day <= 0; day++) {
      const date = addDays(args.today, day);
      if (date < firstYearStart) continue;

      if (day % 7 === 0) {
        const lines = Array.from({ length: 3 }, () => item(aliases[rnd(aliases.length)]!)).map(
          (it) => ({
            itemId: it.itemId,
            unitId: it.unitId,
            qty: qty(it.whole, 20 + rnd(60)),
            listPricePaise: Math.round(it.price * 0.72),
          }),
        );
        const unique = lines.filter((l, i) => lines.findIndex((x) => x.itemId === l.itemId) === i);
        const supplier = suppliers[rnd(suppliers.length)]!;
        postVoucher(db, {
          type: 'purchase',
          seriesId: defaultSeriesId(db, 'purchase'),
          date,
          partyAccountId: id(supplier),
          taxMode: supplier === 'Anchor Wholesale' ? 'interstate' : 'local',
          lines: unique,
        });
        vouchers++;
      }

      const bills = 2 + rnd(3);
      for (let b = 0; b < bills; b++) {
        const lineCount = 1 + rnd(4);
        const picked = new Map<
          number,
          { itemId: number; unitId: number; qty: number; listPricePaise: number }
        >();
        for (let l = 0; l < lineCount; l++) {
          const it = item(aliases[rnd(aliases.length)]!);
          picked.set(it.itemId, {
            itemId: it.itemId,
            unitId: it.unitId,
            qty: qty(it.whole, 1 + rnd(8)),
            listPricePaise: it.price,
          });
        }
        const credit = rnd(3) === 0;
        const customer = customers[rnd(customers.length)]!;
        postVoucher(db, {
          type: 'sales',
          seriesId: defaultSeriesId(db, 'sales'),
          date,
          partyAccountId: credit ? id(customer) : 1,
          taxMode: credit && customer === 'Kumar Constructions' ? 'interstate' : 'local',
          lines: [...picked.values()],
          ...(rnd(4) === 0 ? { sundries: [{ billSundryId: 2, amountPaise: 50_00 }] } : {}),
          ...(!credit && rnd(3) === 0 ? { settlements: [] } : {}),
        });
        vouchers++;
      }

      if (day % 5 === 0) {
        const customer = customers[rnd(customers.length)]!;
        const onUpi = rnd(2) === 0;
        postVoucher(db, {
          type: 'receipt',
          seriesId: defaultSeriesId(db, 'receipt'),
          date,
          partyAccountId: id(customer),
          entries: [
            { accountId: onUpi ? bank : 1, side: 'dr', amountPaise: 500_00 },
            { accountId: id(customer), side: 'cr', amountPaise: 500_00 },
          ],
        });
        vouchers++;
      }
    }

    return {
      items: items.created,
      parties: parties.created,
      vouchers,
      ownerName: 'Owner',
      ownerPin: '1234',
      staffName: 'Staff',
      staffPin: '1111',
    };
  });
}
