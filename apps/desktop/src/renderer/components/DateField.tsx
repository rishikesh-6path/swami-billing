import { useState } from 'react';
import { formatDate, parseDateInput } from '../lib/format.ts';

/** A date box that understands "5-10", "05-10-2026" or "051026" and always shows dd-mm-yyyy. */
export function DateField({
  label,
  value,
  today,
  onChange,
}: {
  label: string;
  value: string;
  today: string;
  onChange: (iso: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor="entry-date">{label}</label>
      <input
        id="entry-date"
        value={text ?? formatDate(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === null) return;
          const parsed = parseDateInput(text, today);
          if (parsed) {
            onChange(parsed);
            setError(null);
          } else setError('Please type the date like 05-10-2026.');
          setText(null);
        }}
      />
      <div className="field-note">{error ?? ''}</div>
    </div>
  );
}
