import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  CreditCheck,
  HeldBill,
  ItemSearchRow,
  PartyHit,
  VoucherDetail,
  VoucherPreview,
} from '@shopledger/core';
import {
  Button,
  Card,
  ConfirmDialog,
  InfoDialog,
  Notice,
  PageHeader,
  useToast,
} from '../../components/ui.tsx';
import { PrintDialog } from '../../components/PrintDialog.tsx';
import { EstimateDialog } from '../../components/EstimateDialog.tsx';
import type { Req } from '../../../ipc/contract.ts';
import { HeldBillsDialog } from './HeldBillsDialog.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { useCellFocus } from './cells.ts';
import { call, CallError, useCall, useKept } from '../../lib/api.ts';
import {
  formatBalance,
  formatDate,
  formatMoney,
  formatPercent,
  formatQty,
  parseDateInput,
  parseMoney,
  rupees,
} from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type StartParty } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import {
  blankRow,
  isBlank,
  KINDS,
  parseRow,
  pickItem,
  rowsFromDetail,
  type ItemVoucherKind,
  type Party,
  type Row,
} from './model.ts';

type Col = 'item' | 'qty' | 'price' | 'disc';

/**
 * The bill screen for sales, purchases and their returns. Everything can be done from the
 * keyboard: Enter moves to the next box, an item code plus Enter picks the item, F2 saves.
 */
export function ItemVoucher({
  kind: kindName,
  edit,
  copyFrom,
  startParty,
}: {
  kind: ItemVoucherKind;
  edit?: VoucherDetail | undefined;
  /** An earlier bill whose party and lines start this new bill. */
  copyFrom?: VoucherDetail | undefined;
  /** Who the bill starts with, when opened from a customer or supplier page. */
  startParty?: StartParty | undefined;
}) {
  const kind = KINDS[kindName];
  const router = useRouter();
  const toast = useToast();

  const [dateIso, setDateIso] = useState<string | null>(edit?.date ?? null);
  const [dateText, setDateText] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const { today: shopToday } = useSession();
  const today = dateIso ?? shopToday;
  const setup = useCall('voucher.setup', { type: kindName, date: dateIso ?? today });

  // party: undefined = the default (Cash for sales), null = cleared, otherwise a chosen party
  const [chosen, setChosen] = useState<Party | null | undefined>(
    (edit ?? copyFrom)?.party
      ? {
          id: (edit ?? copyFrom)!.party!.id,
          name: (edit ?? copyFrom)!.party!.name,
          ...((edit ?? copyFrom)!.party!.stateCode
            ? { stateCode: (edit ?? copyFrom)!.party!.stateCode! }
            : {}),
        }
      : startParty
        ? { id: startParty.id, name: startParty.name, stateCode: startParty.stateCode }
        : undefined,
  );
  const [partyText, setPartyText] = useState<string | null>(null);
  const [partyLookup, setPartyLookup] = useState(0);
  const [saleTypeId, setSaleTypeId] = useState<number | null>(null);
  const [broker, setBroker] = useState((edit ?? copyFrom)?.broker ?? '');
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [focusRow, setFocusRow] = useState(0);
  const [lookup, setLookup] = useState({ row: -1, n: 0 });
  const [sundryText, setSundryText] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      (edit?.sundries ?? []).map((s) => [s.billSundryId, formatMoney(s.amountPaise)]),
    ),
  );
  const [settleText, setSettleText] = useState(
    edit?.settlements[0] ? formatMoney(edit.settlements[0].amountPaise) : '',
  );
  const [settleAccount, setSettleAccount] = useState<number | null>(
    edit?.settlements[0]?.accountId ?? null,
  );
  // a bill being changed may have been paid in more than one way; the screen edits the first
  // payment and keeps the others as they were
  const otherSettlements = (edit?.settlements ?? []).slice(1);
  const [narration, setNarration] = useState((edit ?? copyFrom)?.narration ?? '');
  // the supplier's own invoice (purchases only)
  const [billNo, setBillNo] = useState(edit?.partyBillNo ?? '');
  const [billDateIso, setBillDateIso] = useState<string | null>(edit?.partyBillDate ?? null);
  const [billDateText, setBillDateText] = useState<string | null>(null);
  const [billDateError, setBillDateError] = useState<string | null>(null);
  const [refId, setRefId] = useState<number | null>(edit?.refVoucher?.id ?? null);
  // the GST type of the bill a return is made against
  const [refInfo, setRefInfo] = useState<{ id: number; mode: VoucherDetail['taxMode'] } | null>(
    null,
  );
  useEffect(() => {
    if (!refId) return;
    let live = true;
    call('voucher.get', { id: refId }).then(
      (d) => {
        if (live && d) setRefInfo({ id: d.id, mode: d.taxMode });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [refId]);
  const [preview, setPreview] = useState<VoucherPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [narrationPicker, setNarrationPicker] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [printAfter, setPrintAfter] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<Req<'estimate.preview'>['draft'] | null>(null);

  const cells = useCellFocus();
  const ready = useKept(setup);
  // opened from a customer page: the party is known, so go straight to the first item
  const startedOnItem = useRef(false);
  useEffect(() => {
    if (startParty && ready && !startedOnItem.current) {
      startedOnItem.current = true;
      cells.focus(rows[0]!.key, 'item');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // what this party paid last time, by row (sales and purchases only)
  const [lastPrices, setLastPrices] = useState<
    Record<
      number,
      { listPricePaise: number; discBp: number; date: string; partyId: number; itemId: number }
    >
  >({});

  // copying an earlier bill: today's date, the same lines and prices, nothing else carried over
  useEffect(() => {
    if (!copyFrom) return;
    let cancelled = false;
    rowsFromDetail(copyFrom, shopToday, true).then(
      (loaded) => {
        if (cancelled) return;
        setRows([...loaded, blankRow()]);
        setDirty(true);
        toast.show('Copied the lines and prices of the old bill. Please check the prices.');
      },
      () => {
        if (!cancelled)
          setError('The lines of the old bill could not be copied. Please try again.');
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFrom]);

  // when changing an existing bill, load its lines
  useEffect(() => {
    if (!edit) return;
    let cancelled = false;
    void rowsFromDetail(edit, edit.date, true).then((loaded) => {
      if (!cancelled) setRows([...loaded, blankRow()]);
    });
    return () => {
      cancelled = true;
    };
  }, [edit]);

  const party: Party | null =
    chosen !== undefined
      ? chosen
      : kind.cashDefault && ready
        ? { id: ready.cashAccountId, name: 'Cash' }
        : null;
  const isCashParty =
    kind.cashDefault && party !== null && ready !== null && party.id === ready.cashAccountId;

  const saleTypes = ready?.saleTypes ?? [];
  const autoMode =
    party?.stateCode && ready && party.stateCode !== ready.shopStateCode ? 'interstate' : 'local';
  // A bill being changed keeps its GST type, and a return takes the GST type of the bill it
  // reverses (the books refuse anything else). A copied bill starts with the old bill's type.
  const source = edit ?? copyFrom;
  const sourceSaleType = source
    ? (saleTypes.find((t) => t.name === source.saleTypeName && t.taxMode === source.taxMode) ??
      saleTypes.find((t) => t.taxMode === source.taxMode))
    : undefined;
  const refMode = refInfo && refInfo.id === refId ? refInfo.mode : null;
  const fixedMode = edit ? edit.taxMode : kind.returnsAgainst ? refMode : null;
  const picked = saleTypes.find((t) => t.id === saleTypeId);
  const saleType = fixedMode
    ? picked?.taxMode === fixedMode
      ? picked
      : sourceSaleType?.taxMode === fixedMode
        ? sourceSaleType
        : saleTypes.find((t) => t.taxMode === fixedMode)
    : (picked ?? sourceSaleType ?? saleTypes.find((t) => t.taxMode === autoMode) ?? saleTypes[0]);
  const taxMode = saleType?.taxMode ?? 'local';

  const sundryList = ready?.sundries ?? [];
  const sundries = sundryList.flatMap((s) => {
    const amount = parseMoney(sundryText[s.id] ?? '');
    return amount !== null && amount > 0 ? [{ billSundryId: s.id, amountPaise: amount }] : [];
  });

  // ---- live totals ----
  const draftLines = rows.map((r, i) => {
    const { parsed } = parseRow(r, i);
    return {
      itemId: r.item?.id ?? 0,
      qty: r.item ? parsed.qty : 0,
      unitId: r.item?.unitId ?? 0,
      listPricePaise: parsed.price,
      discBp: parsed.disc,
    };
  });
  const previewKey = JSON.stringify({
    type: kindName,
    date: dateIso ?? today,
    taxMode,
    saleTypeId: saleType?.id,
    partyAccountId: party?.id,
    lines: draftLines,
    sundries,
    roundOff: true,
  });
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const timer = setTimeout(() => {
      call('voucher.preview', JSON.parse(previewKey) as never).then(
        (p) => {
          if (!stale) setPreview(p);
        },
        () => undefined,
      );
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [previewKey, ready]);

  // ---- editing rows ----
  const touch = () => setDirty(true);
  const updateRow = (key: number, patch: Partial<Row>) => {
    touch();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRowAfterLast = () => {
    const fresh = blankRow();
    // render the new row right now, so the next keystroke already has a box to land in
    flushSync(() => setRows((rs) => [...rs, fresh]));
    return fresh;
  };
  const goNext = (index: number, col: Col) => {
    const row = rows[index]!;
    if (col === 'item') return cells.focus(row.key, 'qty');
    if (col === 'qty') return cells.focus(row.key, 'price');
    if (col === 'price') return cells.focus(row.key, 'disc');
    const next = rows[index + 1] ?? addRowAfterLast();
    cells.focus(next.key, 'item');
  };
  const goPrev = (index: number, col: Col) => {
    const row = rows[index]!;
    if (col === 'qty') return cells.focus(row.key, 'item');
    if (col === 'price') return cells.focus(row.key, 'qty');
    if (col === 'disc') return cells.focus(row.key, 'price');
    const above = rows[index - 1];
    if (above) cells.focus(above.key, 'disc');
    else cells.focusId('party');
  };
  const toFooter = () => cells.focusId('footer');

  const repeatLine = () => {
    const i = focusRow;
    const above = rows[i - 1];
    const here = rows[i];
    if (!above || !here) return;
    updateRow(here.key, {
      item: above.item,
      text: above.text,
      qty: above.qty,
      price: above.price,
      disc: above.disc,
    });
    cells.focus(here.key, 'qty');
  };
  const deleteLine = () => {
    const here = rows[focusRow];
    if (!here) return;
    touch();
    setRows((rs) => {
      const rest = rs.filter((r) => r.key !== here.key);
      return rest.length === 0 ? [blankRow()] : rest;
    });
    const target = rows[focusRow + 1] ?? rows[focusRow - 1];
    if (target) cells.focus(target.key, 'item');
  };

  const pasteLast = async () => {
    if (!party) return setError(`Please choose the ${kind.partyLabel.toLowerCase()} first.`);
    const last = (await call('voucher.list', { voucherType: kindName, partyId: party.id }))[0];
    if (!last) return setError(`There is no earlier bill for ${party.name} to copy.`);
    const detail = await call('voucher.get', { id: last.id });
    if (!detail) return;
    const loaded = await rowsFromDetail(detail, dateIso ?? today, false);
    touch();
    setRows([...loaded, blankRow()]);
    setError(null);
    toast.show(`Copied the lines of bill ${last.displayNumber}. Please check the quantities.`);
  };

  /** Empties the screen for the next bill. */
  const resetForm = () => {
    setRows([blankRow()]);
    setSundryText({});
    setSettleText('');
    setNarration('');
    setBillNo('');
    setBillDateIso(null);
    setBroker('');
    setChosen(undefined);
    setPartyText(null);
    setRefId(null);
    setPreview(null);
    setDirty(false);
  };

  // ---- setting a bill aside while someone else is served ----
  const [confirmCredit, setConfirmCredit] = useState<string | null>(null);
  const [heldList, setHeldList] = useState<HeldBill[] | null>(null);
  // the set-aside bill now on the screen; it stays in the list until this bill is saved
  const [resumedId, setResumedId] = useState<number | null>(null);
  const holdBusy = useRef(false);
  const { user: me } = useSession();
  const holdThis = async () => {
    if (holdBusy.current || saving) return;
    if (edit) return setError('A bill that is being changed cannot be set aside.');
    const filled = rows.filter((r) => !isBlank(r));
    if (filled.length === 0) return setError('There is nothing to set aside yet.');
    const who = party && !isCashParty ? party.name : kind.cashDefault ? 'Cash sale' : 'No name';
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const total = preview ? ` - ${rupees(preview.totalPaise)}` : '';
    holdBusy.current = true;
    try {
      await call('bill.hold', {
        kind: kindName,
        label: `${who} - ${filled.length} ${filled.length === 1 ? 'item' : 'items'}${total} - ${time}`,
        payload: {
          version: 1,
          party: chosen
            ? { id: chosen.id, name: chosen.name, stateCode: chosen.stateCode ?? null }
            : null,
          dateIso,
          saleTypeId,
          broker,
          rows: filled.map(({ item, text, qty, price, disc }) => ({
            item,
            text,
            qty,
            price,
            disc,
          })),
          sundryText,
          settleText,
          settleAccount,
          narration,
          billNo,
          billDateIso,
          refId,
        },
      });
      // a bill that came back from the list and is set aside again replaces its old copy
      if (resumedId !== null) await call('bill.finish', { id: resumedId });
      setResumedId(null);
      resetForm();
      // the next customer starts with today's date and the usual bill type
      setDateIso(null);
      setDateText(null);
      setSaleTypeId(null);
      setSettleAccount(null);
      setError(null);
      toast.show('The bill is set aside. Press Alt+R to bring it back.');
      cells.focusId('party');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The bill could not be set aside.');
    } finally {
      holdBusy.current = false;
    }
  };
  const openHeld = async () => {
    if (edit || holdBusy.current) return;
    if (dirty && rows.some((r) => !isBlank(r))) {
      return setError(
        'Please save this bill or set it aside (Alt+H) before bringing back another.',
      );
    }
    try {
      const list = (await call('bill.held', {})).filter((h) => h.kind === kindName);
      if (list.length === 0) return setError('There are no bills set aside here.');
      setError(null);
      setHeldList(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The list could not be shown.');
    }
  };
  const resumeHeld = async (id: number) => {
    if (holdBusy.current) return;
    holdBusy.current = true;
    try {
      const { payload: p } = await call('bill.take', { id });
      const fresh = blankRow();
      flushSync(() => {
        setChosen(
          p.party
            ? {
                id: p.party.id,
                name: p.party.name,
                ...(p.party.stateCode ? { stateCode: p.party.stateCode } : {}),
              }
            : undefined,
        );
        setPartyText(null);
        setDateIso(p.dateIso);
        setSaleTypeId(p.saleTypeId);
        setBroker(p.broker);
        setRows([
          ...p.rows.map((r) => ({
            ...blankRow(),
            item: r.item,
            text: r.text,
            qty: r.qty,
            price: r.price,
            disc: r.disc,
          })),
          fresh,
        ]);
        setSundryText(
          Object.fromEntries(Object.entries(p.sundryText).map(([k, v]) => [Number(k), v])),
        );
        setSettleText(p.settleText);
        setSettleAccount(p.settleAccount);
        setNarration(p.narration);
        setBillNo(p.billNo);
        setBillDateIso(p.billDateIso);
        setRefId(p.refId);
        setDirty(true);
        setHeldList(null);
      });
      setResumedId(id);
      setError(null);
      cells.focus(fresh.key, 'item');
      toast.show(
        'The set-aside bill is back. The prices are the ones typed earlier; please check it.',
      );
    } catch (e) {
      setHeldList(null);
      setError(e instanceof Error ? e.message : 'The bill could not be brought back.');
    } finally {
      holdBusy.current = false;
    }
  };
  const dropHeld = async (id: number) => {
    try {
      await call('bill.discard', { id });
      const rest = (heldList ?? []).filter((h) => h.id !== id);
      setHeldList(rest.length > 0 ? rest : null);
    } catch (e) {
      setHeldList(null);
      setError(e instanceof Error ? e.message : 'The bill could not be thrown away.');
    }
  };

  // ---- saving ----
  const save = async (confirmedCredit = false) => {
    if (saving || !ready) return;
    setError(null);
    if (!party) return setError(`Please choose the ${kind.partyLabel.toLowerCase()}.`);
    if (kind.returnsAgainst && !refId)
      return setError('Please choose the bill that is being returned.');
    const lines: {
      itemId: number;
      qty: number;
      unitId: number;
      listPricePaise: number;
      discBp: number;
    }[] = [];
    for (const [i, r] of rows.entries()) {
      if (isBlank(r)) continue;
      if (!r.item) {
        cells.focus(r.key, 'item');
        return setError(`Row ${i + 1}: please pick the item from the list.`);
      }
      const { parsed, error: rowError } = parseRow(r, i);
      if (rowError) return setError(rowError);
      if (parsed.qty <= 0) {
        cells.focus(r.key, 'qty');
        return setError(`Row ${i + 1}: please enter the quantity.`);
      }
      lines.push({
        itemId: r.item.id,
        qty: parsed.qty,
        unitId: r.item.unitId,
        listPricePaise: parsed.price,
        discBp: parsed.disc,
      });
    }
    if (lines.length === 0) return setError('Please add at least one item.');
    const received = parseMoney(settleText);
    if (settleText.trim() !== '' && (received === null || received < 0))
      return setError('The amount received is not a valid amount.');
    const settlements = [
      ...(!isCashParty && received && received > 0
        ? [
            {
              accountId: settleAccount ?? ready.paymentAccounts[0]?.id ?? ready.cashAccountId,
              amountPaise: received,
            },
          ]
        : []),
      ...otherSettlements.map((x) => ({ accountId: x.accountId, amountPaise: x.amountPaise })),
    ];

    const input = {
      type: kindName,
      date: dateIso ?? today,
      // a changed bill stays in its own number series
      seriesId: edit ? edit.seriesId : ready.defaultSeriesId,
      partyAccountId: party.id,
      ...(saleType ? { saleTypeId: saleType.id } : {}),
      taxMode,
      ...(broker.trim() ? { broker: broker.trim() } : {}),
      ...(narration.trim() ? { narration: narration.trim() } : {}),
      ...(kindName === 'purchase' && billNo.trim() ? { partyBillNo: billNo.trim() } : {}),
      ...(kindName === 'purchase' && billDateIso ? { partyBillDate: billDateIso } : {}),
      ...(refId ? { refVoucherId: refId } : {}),
      ...(confirmedCredit ? { overrideCredit: true } : {}),
      lines,
      sundries,
      settlements,
    };
    setSaving(true);
    try {
      const posted = edit
        ? await call('voucher.modify', { id: edit.id, input })
        : await call('voucher.post', input);
      toast.show(`Saved. Bill number ${posted.number}, total ${rupees(posted.totalPaise)}.`);
      if (edit) return router.back();
      if (resumedId !== null) {
        void call('bill.finish', { id: resumedId }).catch(() => undefined);
        setResumedId(null);
      }
      resetForm();
      setup.reload();
      if (ready.autoPrint && kindName === 'sales') setPrintAfter(posted.voucherId);
      else cells.focusId('party');
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Something went wrong and nothing was saved.';
      // the owner is asked to confirm a bill that takes a customer over their credit limit
      if (e instanceof CallError && e.code === 'confirm_credit') setConfirmCredit(message);
      else setError(message);
    } finally {
      setSaving(false);
    }
  };

  // The price this customer (or supplier) paid last time for each item on the bill, offered under
  // the price box. It is looked up again whenever the person, date or item on a row changes, and a
  // hint is only shown or used while it still belongs to the person and item on screen.
  const lastPriceKey = rows.map((r) => `${r.key}:${r.item?.id ?? 0}`).join(',');
  const lastPartyId = party?.id ?? 0;
  useEffect(() => {
    if (!lastPartyId || isCashParty || (kindName !== 'sales' && kindName !== 'purchase')) {
      return;
    }
    let current = true;
    for (const r of rows) {
      const itemId = r.item?.id;
      if (!itemId) continue;
      void call('item.lastPrice', {
        partyId: lastPartyId,
        itemId,
        type: kindName,
        before: dateIso ?? today,
        ...(edit ? { excludeVoucherId: edit.id } : {}),
      }).then(
        (found) => {
          if (!current) return;
          setLastPrices((m) => {
            const next = { ...m };
            if (found) next[r.key] = { ...found, partyId: lastPartyId, itemId };
            else delete next[r.key];
            return next;
          });
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPartyId, isCashParty, kindName, dateIso, lastPriceKey]);
  const hintFor = (row: Row | undefined) => {
    const h = row ? lastPrices[row.key] : undefined;
    return row && h && !isCashParty && h.partyId === lastPartyId && h.itemId === row.item?.id
      ? h
      : undefined;
  };
  // F3 puts the last price (and discount) on the row the cursor is in
  function takeLastPrice() {
    const row = rows[focusRow];
    const last = hintFor(row);
    if (!row || !last) return;
    updateRow(row.key, {
      price: formatMoney(last.listPricePaise),
      disc: last.discBp === 0 ? '' : String(last.discBp / 100),
    });
  }

  // the customer's credit limit, checked against what they would owe after this bill
  const [credit, setCredit] = useState<CreditCheck | null>(null);
  const unpaid = (preview?.totalPaise ?? 0) - (parseMoney(settleText) ?? 0);
  useEffect(() => {
    if (kindName !== 'sales' || !party || isCashParty || !preview) return;
    let current = true;
    const timer = setTimeout(() => {
      call('credit.check', {
        partyId: party.id,
        billPaise: unpaid,
        ...(edit ? { excludeVoucherId: edit.id } : {}),
      }).then(
        (found) => {
          if (current) setCredit(found);
        },
        () => undefined,
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindName, party?.id, isCashParty, unpaid, edit?.id]);

  // a message from saving may be above a long bill that has scrolled; bring it into view
  useEffect(() => {
    if (error) document.getElementById('voucher-error')?.scrollIntoView({ block: 'center' });
  }, [error]);

  const leave = () => (dirty ? setConfirmExit(true) : router.back());
  useHotkeys({
    F2: () => void save(),
    Escape: leave,
    F4: () => setNarrationPicker(true),
    F5: () =>
      focusRow < 0
        ? setPartyLookup((n) => n + 1)
        : setLookup((l) => ({ row: focusRow, n: l.n + 1 })),
    F3: takeLastPrice,
    F7: repeatLine,
    F9: deleteLine,
    F12: () => void pasteLast(),
    'Alt+H': () => void holdThis(),
    'Alt+R': () => void openHeld(),
    ...(kindName === 'sales' && !edit
      ? {
          'Alt+E': () => {
            if (!rows.some((r) => r.item && !isBlank(r)))
              return setError('Please add at least one item before making an estimate.');
            setError(null);
            setEstimate({
              ...(JSON.parse(previewKey) as Req<'estimate.preview'>['draft']),
              ...(narration.trim() ? { narration: narration.trim() } : {}),
            });
          },
        }
      : {}),
  });
  useHints([
    'F2 Save',
    'Esc Cancel',
    'Enter Next box',
    'F5 Show list',
    'F3 Last price',
    'F7 Repeat line',
    'F9 Delete line',
    'F12 Copy last bill',
    'F4 Standard note',
    'Alt+H Set aside',
    'Alt+R Bring back',
    ...(kindName === 'sales' && !edit ? ['Alt+E Estimate'] : []),
  ]);

  if (!ready) {
    return (
      <main className="page voucher-page">
        {setup.status === 'error' ? (
          <Notice>{setup.message}</Notice>
        ) : (
          <p className="muted">Getting the bill ready...</p>
        )}
      </main>
    );
  }

  const prefix = ready?.series.find((s) => s.id === ready.defaultSeriesId)?.prefix ?? '';
  const warnings = preview?.problems ?? [];
  const overLimit = credit?.over ? credit : null;

  return (
    <main className="page voucher-page">
      <PageHeader
        title={
          edit ? `Change ${kind.title.replace('New ', '')} ${prefix}${edit.number}` : kind.title
        }
        subtitle={
          ready && !edit
            ? `Bill number ${prefix}${ready.nextNumber}`
            : edit
              ? 'Saving will replace this bill with a corrected one.'
              : ''
        }
        actions={
          <>
            {/* on a small screen the totals panel is below the items, so the total also shows here */}
            <span className="header-total">
              Total <strong>{rupees(preview?.totalPaise ?? 0)}</strong>
            </span>
            <Button onClick={leave}>Cancel (Esc)</Button>
            <Button
              ref={(el: HTMLButtonElement | null) => cells.set('footer-button', el)}
              variant="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving...' : 'Save (F2)'}
            </Button>
          </>
        }
      />
      {setup.status === 'error' && <Notice>{setup.message}</Notice>}
      {error && (
        <div id="voucher-error">
          <Notice>{error}</Notice>
        </div>
      )}

      <div className="voucher-top">
        <div className="field" onFocusCapture={() => setFocusRow(-1)}>
          <label>{kind.partyLabel}</label>
          <Typeahead<PartyHit>
            ariaLabel={kind.partyLabel}
            inputRef={(el: HTMLInputElement | null) => cells.set('party', el)}
            autoFocus={!startParty}
            text={partyText ?? party?.name ?? ''}
            onText={(t) => {
              setPartyText(t);
              setChosen(null);
              touch();
            }}
            search={(text) =>
              call('party.search', { text, kind: kind.partyKind, asOn: dateIso ?? today })
            }
            getKey={(p) => p.id}
            isExact={(p, t) => p.name.toLowerCase() === t.toLowerCase()}
            renderOption={(p) => (
              <>
                <span>{p.name}</span>
                <span className="opt-sub">
                  {p.stateCode ? `State ${p.stateCode} · ` : ''}
                  {formatBalance(p.balancePaise)}
                </span>
              </>
            )}
            onPick={(p) => {
              setChosen(p);
              setPartyText(null);
              touch();
              // a purchase asks for the supplier's invoice before the items
              if (kindName === 'purchase') document.getElementById('party-bill-no')?.focus();
              else cells.focus(rows[0]!.key, 'item');
            }}
            onNoMatch={(t) =>
              setError(
                `No ${kind.partyLabel.toLowerCase()} named "${t}". Add them first from the Customers screen.`,
              )
            }
            openSignal={partyLookup}
          />
          <div className="field-note">
            {isCashParty
              ? 'Cash sale: money is received now.'
              : party?.balancePaise !== undefined && party.balancePaise !== 0
                ? party.balancePaise > 0
                  ? `Owes you ${rupees(party.balancePaise)}`
                  : `You owe ${rupees(-party.balancePaise)}`
                : ''}
          </div>
        </div>
        <div className={`field ${dateError ? 'field-error' : ''}`}>
          <label htmlFor="bill-date">Date</label>
          <input
            id="bill-date"
            value={dateText ?? formatDate(dateIso ?? today)}
            onChange={(e) => setDateText(e.target.value)}
            onBlur={() => {
              if (dateText === null) return;
              const parsed = parseDateInput(dateText, today);
              if (parsed) {
                setDateIso(parsed);
                setDateError(null);
                touch();
              } else setDateError('Please type the date like 05-10-2026.');
              setDateText(null);
            }}
          />
          <div className="field-note">{dateError ?? ''}</div>
        </div>
        {kindName === 'purchase' && (
          <>
            <div className="field">
              <label htmlFor="party-bill-no">Supplier&apos;s invoice no.</label>
              <input
                id="party-bill-no"
                value={billNo}
                autoComplete="off"
                onChange={(e) => {
                  setBillNo(e.target.value);
                  touch();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('party-bill-date')?.focus();
                  }
                }}
              />
              <div className="field-note">The number printed on the supplier&apos;s bill.</div>
            </div>
            <div className={`field ${billDateError ? 'field-error' : ''}`}>
              <label htmlFor="party-bill-date">Supplier&apos;s invoice date</label>
              <input
                id="party-bill-date"
                value={billDateText ?? (billDateIso ? formatDate(billDateIso) : '')}
                placeholder="dd-mm-yyyy"
                autoComplete="off"
                onChange={(e) => setBillDateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  e.currentTarget.blur();
                  cells.focus(rows[0]!.key, 'item');
                }}
                onBlur={() => {
                  if (billDateText === null) return;
                  if (billDateText.trim() === '') {
                    setBillDateIso(null);
                    setBillDateError(null);
                  } else {
                    const parsed = parseDateInput(billDateText, today);
                    if (parsed) {
                      setBillDateIso(parsed);
                      setBillDateError(null);
                      touch();
                    } else setBillDateError('Please type the date like 05-10-2026.');
                  }
                  setBillDateText(null);
                }}
              />
              <div className="field-note">{billDateError ?? ''}</div>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="sale-type">Bill type</label>
          <select
            id="sale-type"
            value={saleType?.id ?? ''}
            onChange={(e) => setSaleTypeId(Number(e.target.value))}
          >
            {saleTypes
              .filter((t) => !fixedMode || t.taxMode === fixedMode)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <div className="field-note">
            {fixedMode ? 'Same GST as the original bill. ' : ''}
            {taxMode === 'interstate'
              ? 'IGST applies (other state).'
              : taxMode === 'exempt'
                ? 'No GST.'
                : 'CGST and SGST apply.'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="broker">Broker (optional)</label>
          <input
            id="broker"
            list="brokers"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
          />
          <datalist id="brokers">
            {(ready?.brokers ?? []).map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
      </div>

      {kind.returnsAgainst && party && (
        <ReturnAgainst
          against={kind.returnsAgainst}
          partyId={party.id}
          value={refId}
          onChange={setRefId}
        />
      )}

      <div className="voucher-body">
        <section className="voucher-main">
          <table className="data bill-grid">
            <thead>
              <tr>
                <th className="c-no">#</th>
                <th>Item</th>
                <th className="num c-qty">Quantity</th>
                <th className="c-unit">Unit</th>
                <th className="num c-price">Price</th>
                <th className="num c-disc">Disc. %</th>
                <th className="num c-amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pv = preview?.lines[i];
                const { error: rowError } = parseRow(r, i);
                return (
                  <tr key={r.key} onFocusCapture={() => setFocusRow(i)}>
                    <td className="c-no">{i + 1}</td>
                    <td>
                      <Typeahead<ItemSearchRow>
                        ariaLabel={`Item, row ${i + 1}`}
                        inputRef={(el: HTMLInputElement | null) => cells.set(`${r.key}:item`, el)}
                        text={r.text}
                        onText={(t) =>
                          updateRow(r.key, {
                            text: t,
                            item: r.item && t === r.item.name ? r.item : null,
                          })
                        }
                        search={(text) =>
                          call('item.search', { text, onDate: dateIso ?? today, limit: 12 })
                        }
                        getKey={(it) => it.id}
                        isExact={(it, t) => it.alias?.toLowerCase() === t.toLowerCase()}
                        renderOption={(it) => (
                          <>
                            <span>
                              {it.name}
                              {it.alias ? <span className="opt-sub"> · {it.alias}</span> : null}
                            </span>
                            <span className="opt-sub">
                              {rupees(kind.priceFrom === 'sale' ? it.salePricePaise : it.costPaise)}{' '}
                              · stock {formatQty(it.stockQty)} {it.unitName}
                            </span>
                          </>
                        )}
                        onPick={(it) => {
                          touch();
                          setError(null);
                          setRows((rs) =>
                            rs.map((x) => (x.key === r.key ? pickItem(x, it, kind) : x)),
                          );
                          cells.focus(r.key, 'qty');
                        }}
                        onEnterEmpty={toFooter}
                        onNoMatch={(t) =>
                          setError(
                            `Row ${i + 1}: no item matches "${t}". Check the code, or add the item first.`,
                          )
                        }
                        onShiftEnter={() => goPrev(i, 'item')}
                        openSignal={lookup.row === i ? lookup.n : 0}
                      />
                    </td>
                    <td className="num">
                      <input
                        aria-label={`Quantity, row ${i + 1}`}
                        ref={(el: HTMLInputElement | null) => cells.set(`${r.key}:qty`, el)}
                        className={`cell-input num ${rowError?.includes('quantity') ? 'cell-bad' : ''}`}
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                        onKeyDown={(e) =>
                          cellKey(
                            e,
                            () => goNext(i, 'qty'),
                            () => goPrev(i, 'qty'),
                          )
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                    <td className="c-unit muted-cell">{r.item?.unitName ?? ''}</td>
                    <td className="num">
                      <input
                        aria-label={`Price, row ${i + 1}`}
                        ref={(el: HTMLInputElement | null) => cells.set(`${r.key}:price`, el)}
                        className="cell-input num"
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) => updateRow(r.key, { price: e.target.value })}
                        onKeyDown={(e) =>
                          cellKey(
                            e,
                            () => goNext(i, 'price'),
                            () => goPrev(i, 'price'),
                          )
                        }
                        onFocus={(e) => e.target.select()}
                      />
                      {hintFor(r) && (
                        <div className="last-price">
                          Last time {formatMoney(hintFor(r)!.listPricePaise)} on{' '}
                          {formatDate(hintFor(r)!.date)} (F3 uses it)
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <input
                        aria-label={`Discount percent, row ${i + 1}`}
                        ref={(el: HTMLInputElement | null) => cells.set(`${r.key}:disc`, el)}
                        className="cell-input num"
                        inputMode="decimal"
                        value={r.disc}
                        onChange={(e) => updateRow(r.key, { disc: e.target.value })}
                        onKeyDown={(e) =>
                          cellKey(
                            e,
                            () => goNext(i, 'disc'),
                            () => goPrev(i, 'disc'),
                          )
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                    <td className="num amount-cell">{pv ? formatMoney(pv.amountPaise) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid-actions">
            <Button onClick={() => cells.focus(addRowAfterLast().key, 'item')}>
              Add another line
            </Button>
          </div>

          <Card title="Extra charges and discounts">
            <div className="form-grid">
              {sundryList.map((s, i) => (
                <div key={s.id} className="field">
                  <label htmlFor={`sundry-${s.id}`}>
                    {s.name} ({s.sign === 1 ? '+' : '-'})
                  </label>
                  <input
                    id={`sundry-${s.id}`}
                    inputMode="decimal"
                    ref={
                      i === 0 ? (el: HTMLInputElement | null) => cells.set('footer', el) : undefined
                    }
                    value={sundryText[s.id] ?? ''}
                    onChange={(e) => {
                      touch();
                      setSundryText((t) => ({ ...t, [s.id]: e.target.value }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const next = sundryList[i + 1];
                        if (next) document.getElementById(`sundry-${next.id}`)?.focus();
                        else document.getElementById(isCashParty ? 'narration' : 'settle')?.focus();
                      }
                    }}
                  />
                </div>
              ))}
              {!isCashParty && (
                <div className="field">
                  <label htmlFor="settle">{kind.settleLabel}</label>
                  <input
                    id="settle"
                    inputMode="decimal"
                    ref={
                      sundryList.length === 0
                        ? (el: HTMLInputElement | null) => cells.set('footer', el)
                        : undefined
                    }
                    value={settleText}
                    onChange={(e) => {
                      touch();
                      setSettleText(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('narration')?.focus();
                      }
                    }}
                  />
                </div>
              )}
              {otherSettlements.length > 0 && (
                <p className="muted">
                  Also paid on this bill (kept as it was):{' '}
                  {otherSettlements
                    .map((x) => `${rupees(x.amountPaise)} in ${x.accountName}`)
                    .join(', ')}
                </p>
              )}
              {!isCashParty && (ready?.paymentAccounts.length ?? 0) > 1 && (
                <div className="field">
                  <label htmlFor="settle-in">
                    {kindName === 'purchase' || kindName === 'sales_return'
                      ? 'Paid from'
                      : 'Received in'}
                  </label>
                  <select
                    id="settle-in"
                    value={settleAccount ?? ready?.paymentAccounts[0]?.id}
                    onChange={(e) => setSettleAccount(Number(e.target.value))}
                  >
                    {ready?.paymentAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field wide">
                <label htmlFor="narration">Note (optional)</label>
                <input
                  id="narration"
                  value={narration}
                  onChange={(e) => {
                    touch();
                    setNarration(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      cells.focusFooterButton();
                    }
                  }}
                />
              </div>
            </div>
          </Card>
        </section>

        <aside className="voucher-side" aria-label="Bill total">
          <Card>
            <dl className="totals">
              <div>
                <dt>Items total</dt>
                <dd>{formatMoney(preview?.subtotalPaise ?? 0)}</dd>
              </div>
              {preview?.sundries.map((s) => (
                <div key={s.billSundryId}>
                  <dt>{sundryList.find((x) => x.id === s.billSundryId)?.name}</dt>
                  <dd>{formatMoney(s.signedPaise)}</dd>
                </div>
              ))}
              {preview?.taxTable.map((t) =>
                taxMode === 'local' ? (
                  <div key={t.rateBp}>
                    <dt>
                      CGST + SGST {formatPercent(t.rateBp)}
                      <span className="opt-sub"> on {formatMoney(t.taxablePaise)}</span>
                    </dt>
                    <dd>{formatMoney(t.cgstPaise + t.sgstPaise)}</dd>
                  </div>
                ) : taxMode === 'interstate' ? (
                  <div key={t.rateBp}>
                    <dt>
                      IGST {formatPercent(t.rateBp)}
                      <span className="opt-sub"> on {formatMoney(t.taxablePaise)}</span>
                    </dt>
                    <dd>{formatMoney(t.igstPaise)}</dd>
                  </div>
                ) : null,
              )}
              {preview && preview.roundOffPaise !== 0 && (
                <div>
                  <dt>Round off</dt>
                  <dd>{formatMoney(preview.roundOffPaise)}</dd>
                </div>
              )}
              <div className="grand">
                <dt>Total</dt>
                <dd data-testid="bill-total">{formatMoney(preview?.totalPaise ?? 0)}</dd>
              </div>
            </dl>
            {overLimit && (
              <Notice kind="info">
                {party?.name} would owe {rupees(overLimit.afterPaise)} after this bill. Their limit
                is {rupees(overLimit.limitPaise)}.
              </Notice>
            )}
            {warnings.map((p) => (
              <Notice key={p.message} kind={p.kind === 'error' ? 'error' : 'info'}>
                {p.message}
              </Notice>
            ))}
          </Card>
        </aside>
      </div>

      {estimate && ready && (
        <EstimateDialog
          draft={estimate}
          initialSize={ready.printSize}
          onClose={() => {
            setEstimate(null);
            cells.focusId('party');
          }}
        />
      )}
      {printAfter !== null && ready && (
        <PrintDialog
          id={printAfter}
          initialSize={ready.printSize}
          onClose={() => {
            setPrintAfter(null);
            cells.focusId('party');
          }}
        />
      )}
      {confirmExit && (
        <ConfirmDialog
          title="Leave this bill?"
          confirmLabel="Yes, throw it away"
          cancelLabel="No, keep working"
          danger
          onConfirm={() => router.back()}
          onCancel={() => setConfirmExit(false)}
        >
          You have started a bill that is not saved. If you leave now it will be lost.
        </ConfirmDialog>
      )}
      {heldList && (
        <HeldBillsDialog
          bills={heldList}
          showOwner={me?.role === 'owner'}
          onPick={(id) => void resumeHeld(id)}
          onThrowAway={(id) => void dropHeld(id)}
          onClose={() => setHeldList(null)}
        />
      )}
      {confirmCredit !== null && (
        <ConfirmDialog
          title="Above the credit limit"
          confirmLabel="Yes, save the bill"
          cancelLabel="No, go back"
          onConfirm={() => {
            setConfirmCredit(null);
            void save(true);
          }}
          onCancel={() => setConfirmCredit(null)}
        >
          {confirmCredit} Do you still want to save this bill?
        </ConfirmDialog>
      )}
      {narrationPicker && (
        <InfoDialog title="Standard notes" onClose={() => setNarrationPicker(false)}>
          <ul className="pick-list">
            {(ready?.narrations ?? []).length === 0 && (
              <li className="muted">
                There are no standard notes yet. The owner can add them in Settings.
              </li>
            )}
            {(ready?.narrations ?? []).map((n) => (
              <li key={n}>
                <Button
                  onClick={() => {
                    setNarration(n);
                    touch();
                    setNarrationPicker(false);
                  }}
                >
                  {n}
                </Button>
              </li>
            ))}
          </ul>
        </InfoDialog>
      )}
    </main>
  );
}

/** Enter goes to the next box, Shift+Enter to the previous one. */
function cellKey(e: React.KeyboardEvent, next: () => void, prev: () => void) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.shiftKey) prev();
  else next();
}

function ReturnAgainst({
  against,
  partyId,
  value,
  onChange,
}: {
  against: 'sales' | 'purchase';
  partyId: number;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const bills = useCall('voucher.list', { voucherType: against, partyId });
  return (
    <div className="field return-against">
      <label htmlFor="ref-bill">Bill being returned</label>
      <select
        id="ref-bill"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Please choose the bill...</option>
        {bills.status === 'ready' &&
          bills.data.map((b) => (
            <option key={b.id} value={b.id}>
              Bill {b.displayNumber}, {formatDate(b.date)}, {rupees(b.totalPaise)}
            </option>
          ))}
      </select>
    </div>
  );
}
