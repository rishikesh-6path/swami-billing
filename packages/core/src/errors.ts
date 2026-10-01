/**
 * An error whose message is written for shop staff and can be shown on screen as is.
 * Anything else that escapes to the UI is reported as a generic "nothing was saved" message.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
