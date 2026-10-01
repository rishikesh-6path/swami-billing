import { transaction, type Db } from '../../db/connection.ts';
import { ValidationError } from '../../errors.ts';
import { assertDateOpen } from '../../books/control.ts';
import { cancelVoucher, postVoucher } from './post.ts';
import { PostingError, type PostedVoucher, type PostOptions, type VoucherInput } from './types.ts';

export interface ModifiedVoucher extends PostedVoucher {
  /** The cancelled original that this voucher replaces. */
  replacedVoucherId: number;
}

/**
 * Changes a posted voucher the only way an accounting book allows: the original is cancelled
 * (its lines are reversed, nothing is edited or deleted) and a corrected voucher is posted in
 * its place, linked back to it. The replacement gets the next number; the original keeps its
 * own number and shows as cancelled. All in one transaction.
 */
export function modifyVoucher(
  db: Db,
  voucherId: number,
  input: VoucherInput,
  opts: PostOptions & { userId?: number | undefined } = {},
): ModifiedVoucher {
  const now = opts.now ?? new Date().toISOString();
  return transaction(db, () => {
    const original = db
      .prepare('SELECT voucher_type, status, date FROM voucher WHERE id = ?')
      .get(voucherId);
    if (!original) throw new PostingError('That bill no longer exists.');
    if (original['voucher_type'] !== input.type) {
      throw new PostingError(
        'The kind of voucher cannot be changed. Please cancel it and make a new one.',
      );
    }
    if (original['status'] !== 'posted') {
      throw new PostingError('Only a saved bill that has not been cancelled can be changed.');
    }
    const dependent = db
      .prepare("SELECT 1 FROM voucher WHERE ref_voucher_id = ? AND status = 'posted' LIMIT 1")
      .get(voucherId);
    if (dependent) {
      throw new ValidationError(
        'Returns or notes have been made against this bill, so it cannot be changed.',
      );
    }
    assertDateOpen(db, String(original['date']), opts.role);

    cancelVoucher(db, voucherId, {
      userId: opts.userId,
      now,
      ...(opts.role ? { role: opts.role } : {}),
    });
    const posted = postVoucher(db, input, { ...opts, now });
    db.prepare('UPDATE voucher SET modified_from_id = ? WHERE id = ?').run(
      voucherId,
      posted.voucherId,
    );
    db.prepare(
      'INSERT INTO audit_log (at, user_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      now,
      opts.userId ?? null,
      'modify',
      'voucher',
      posted.voucherId,
      JSON.stringify({ replacedVoucherId: voucherId }),
      JSON.stringify({ voucherId: posted.voucherId, number: posted.number }),
    );
    return { ...posted, replacedVoucherId: voucherId };
  });
}
