import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { ensureFinancialYearFor } from '../books/financial-year.ts';
import { ensureDefaults } from '../masters/setup.ts';
import { getCompany, saveCompany, type CompanyInput } from './company.ts';
import { createUser } from './users.ts';

export function isSetupComplete(db: Db): boolean {
  return (
    getCompany(db) !== undefined &&
    db.prepare("SELECT 1 FROM user WHERE role = 'owner' AND is_active = 1 LIMIT 1").get() !==
      undefined
  );
}

/**
 * First-run setup in one step: shop details, the owner's sign-in, the current financial year
 * and the standard masters (number series, sale types, units, bill sundries).
 */
export function completeSetup(
  db: Db,
  input: {
    company: CompanyInput;
    ownerName: string;
    ownerPin: string;
    today: string;
    allowWeakPin?: boolean;
  },
): number {
  return transaction(db, () => {
    if (isSetupComplete(db)) throw new ValidationError('ShopLedger has already been set up.');
    saveCompany(db, input.company);
    const ownerId = createUser(db, {
      name: input.ownerName,
      pin: input.ownerPin,
      role: 'owner',
      ...(input.allowWeakPin ? { allowWeakPin: true } : {}),
    });
    ensureFinancialYearFor(db, input.today, { userId: ownerId });
    ensureDefaults(db);
    return ownerId;
  });
}
