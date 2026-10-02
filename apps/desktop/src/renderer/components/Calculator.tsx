import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';
import { useFocusTrap } from './focus.ts';
import { Button, Notice } from './ui.tsx';

/** A quick calculator on F10, from any screen. Enter works out the sum; the answer can be used in the next one. */
export function Calculator({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trap = useFocusTrap<HTMLFormElement>();
  useEffect(() => input.current?.focus(), []);
  useHotkeys({ Escape: onClose, F10: onClose }, true, true);

  const work = () => {
    setError(null);
    call('calc.eval', { expression: text }).then(
      ({ result }) => {
        setAnswer(result);
        setText(result);
        requestAnimationFrame(() => input.current?.select());
      },
      (e: unknown) =>
        setError(e instanceof Error ? e.message : 'That sum could not be worked out.'),
    );
  };

  return (
    <div className="overlay">
      <form
        ref={trap}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Calculator"
        onSubmit={(e) => {
          e.preventDefault();
          work();
        }}
      >
        <h2>Calculator</h2>
        <p className="muted">
          Type a sum such as 450*12+30 or 2000*18%, then press Enter. Esc closes this.
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="field">
          <label htmlFor="calc-input">Sum</label>
          <input
            id="calc-input"
            ref={input}
            value={text}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {answer !== null && (
          <p className="calc-answer" role="status" data-testid="calc-answer">
            = {answer}
          </p>
        )}
        <div className="dialog-actions">
          <Button onClick={onClose}>Close (Esc)</Button>
          <Button variant="primary" type="submit">
            Work it out (Enter)
          </Button>
        </div>
      </form>
    </div>
  );
}
