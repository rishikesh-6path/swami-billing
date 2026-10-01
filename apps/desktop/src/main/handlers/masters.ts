import {
  ValidationError,
  can,
  transaction,
  createAccount,
  createItem,
  createItemGroup,
  createUnit,
  deleteAccount,
  deleteItem,
  getAccount,
  getItem,
  listItemGroups,
  listItems,
  listParties,
  listUnits,
  setItemTaxRate,
  taxRateHistory,
  updateAccount,
  updateItem,
} from '@shopledger/core';
import type { HandlerContext, Handlers } from '../ipc.ts';

const OPENINGS_FOR_OWNER =
  'Opening balances and opening stock are entered by the owner. To add stock, make a purchase.';

/** Staff cannot set or change opening balances or opening stock: they sit under every report. */
function staffOpeningGuard(ctx: HandlerContext, changed: boolean): void {
  if (changed && !can(ctx.user().role, 'edit_openings'))
    throw new ValidationError(OPENINGS_FOR_OWNER);
}

export const masterHandlers: Pick<
  Handlers,
  | 'item.list'
  | 'item.get'
  | 'item.save'
  | 'item.delete'
  | 'itemgroup.list'
  | 'itemgroup.create'
  | 'unit.list'
  | 'unit.create'
  | 'party.list'
  | 'party.get'
  | 'party.save'
  | 'party.delete'
> = {
  'item.list': (req, ctx) =>
    listItems(ctx.db, {
      ...(req.text ? { text: req.text } : {}),
      ...(req.includeInactive ? { includeInactive: true } : {}),
    }),
  'item.get': (req, ctx) => {
    const item = getItem(ctx.db, req.id);
    return item ? { item, taxHistory: taxRateHistory(ctx.db, req.id) } : null;
  },
  'item.save': (req, ctx) => {
    const { id, taxRateBp, taxEffectiveFrom, isActive, ...fields } = req;
    const who = { userId: ctx.user().id };
    const before = id === undefined ? undefined : getItem(ctx.db, id);
    staffOpeningGuard(
      ctx,
      (fields.openingQty ?? before?.openingQty ?? 0) !== (before?.openingQty ?? 0) ||
        (fields.openingRatePaise ?? before?.openingRatePaise ?? 0) !==
          (before?.openingRatePaise ?? 0),
    );
    if (id === undefined) {
      return createItem(
        ctx.db,
        {
          ...fields,
          ...(taxRateBp !== undefined ? { taxRateBp } : {}),
          ...(taxEffectiveFrom ? { taxEffectiveFrom } : {}),
        },
        who,
      );
    }
    // the item and its new GST rate are saved together or not at all
    transaction(ctx.db, () => {
      updateItem(ctx.db, id, { ...fields, ...(isActive !== undefined ? { isActive } : {}) }, who);
      const current = getItem(ctx.db, id)?.rateBp;
      if (taxRateBp !== undefined && taxRateBp !== current) {
        setItemTaxRate(ctx.db, id, taxEffectiveFrom ?? ctx.today(), taxRateBp, who);
      }
    });
    return id;
  },
  'item.delete': (req, ctx) => {
    deleteItem(ctx.db, req.id, { userId: ctx.user().id });
    return null;
  },
  'itemgroup.list': (_req, ctx) => listItemGroups(ctx.db),
  'itemgroup.create': (req, ctx) =>
    createItemGroup(ctx.db, { name: req.name }, { userId: ctx.user().id }),
  'unit.list': (_req, ctx) => listUnits(ctx.db),
  'unit.create': (req, ctx) => createUnit(ctx.db, req, { userId: ctx.user().id }),
  'party.list': (req, ctx) =>
    listParties(ctx.db, {
      kind: req.kind,
      asOn: req.asOn,
      ...(req.text ? { text: req.text } : {}),
    }),
  'party.get': (req, ctx) => getAccount(ctx.db, req.id) ?? null,
  'party.save': (req, ctx) => {
    const { id, kind, ...fields } = req;
    const who = { userId: ctx.user().id };
    const before = id === undefined ? undefined : getAccount(ctx.db, id);
    staffOpeningGuard(
      ctx,
      (fields.openingBalancePaise ?? before?.openingBalancePaise ?? 0) !==
        (before?.openingBalancePaise ?? 0),
    );
    if (id !== undefined) {
      updateAccount(ctx.db, id, fields, who);
      return id;
    }
    const group = ctx.db
      .prepare('SELECT id FROM account_group WHERE name = ?')
      .get(kind === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors');
    if (!group)
      throw new ValidationError('The account groups are missing. Please contact support.');
    return createAccount(ctx.db, { ...fields, groupId: Number(group['id']) }, who);
  },
  'party.delete': (req, ctx) => {
    deleteAccount(ctx.db, req.id, { userId: ctx.user().id });
    return null;
  },
};
