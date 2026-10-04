/**
 * An error whose message is written for shop staff and can be shown on screen as is.
 * Anything else that escapes to the UI is reported as a generic "nothing was saved" message.
 */
export class ValidationError extends Error {
  /**
   * A fixed word the screen can act on (for example 'confirm_credit': the owner is asked to
   * confirm). The message is for people; the code never changes when the wording does.
   */
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}
