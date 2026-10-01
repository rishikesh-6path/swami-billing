import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useHotkeys } from '../lib/hotkeys.tsx';

export interface TypeaheadProps<T> {
  ariaLabel: string;
  text: string;
  onText: (text: string) => void;
  search: (text: string) => Promise<T[]>;
  getKey: (item: T) => string | number;
  renderOption: (item: T) => ReactNode;
  onPick: (item: T) => void;
  /** An exact match is picked straight away on Enter, without opening the list (e.g. a numeric item code). */
  isExact?: (item: T, text: string) => boolean;
  /** Enter was pressed on an empty box. */
  onEnterEmpty?: () => void;
  /** Enter was pressed on text that matches nothing. */
  onNoMatch?: (text: string) => void;
  onShiftEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  autoFocus?: boolean;
  /** Changing this number opens the list (used for the F5 key). */
  openSignal?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * A text box that shows matching choices as you type. Arrow keys move, Enter picks, Esc closes the
 * list. Enter on an exact match (like an item code) picks it at once, so fast typists never need
 * the list.
 */
export function Typeahead<T>(props: TypeaheadProps<T>) {
  const {
    text,
    onText,
    search,
    getKey,
    renderOption,
    onPick,
    ariaLabel,
    placeholder,
    autoFocus,
    disabled,
    className,
    inputRef,
    openSignal,
    isExact,
    onEnterEmpty,
    onNoMatch,
    onShiftEnter,
  } = props;
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<T[]>([]);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [lastSignal, setLastSignal] = useState(openSignal ?? 0);

  // always call the newest search function without making it a dependency
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  // while the list is open, look up matches for the current text (newest answer wins)
  useEffect(() => {
    if (!open) return;
    let stale = false;
    searchRef.current(text).then(
      (results) => {
        if (stale) return;
        setHits(results);
        setActive(0);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [open, text]);

  // F5 asks the box to show its list
  if ((openSignal ?? 0) !== lastSignal) {
    setLastSignal(openSignal ?? 0);
    setOpen(true);
  }

  // Esc closes the list first; only a second Esc reaches the screen underneath
  useHotkeys({ Escape: () => setOpen(false) }, open && hits.length > 0);

  const pick = (item: T) => {
    setOpen(false);
    setNavigated(false);
    onPick(item);
  };

  const onEnter = async (shift: boolean) => {
    if (shift) return onShiftEnter?.();
    const query = text.trim();
    if (navigated && hits[active]) return pick(hits[active]);
    if (query === '') {
      setOpen(false);
      return onEnterEmpty?.();
    }
    const results = await search(query);
    const exact = isExact ? results.find((r) => isExact(r, query)) : undefined;
    if (exact) return pick(exact);
    if (results.length === 1 && results[0]) return pick(results[0]);
    if (results.length === 0) {
      setHits([]);
      return onNoMatch?.(query);
    }
    setHits(results);
    setActive(0);
    setOpen(true);
  };

  return (
    <div className={`typeahead ${className ?? ''}`}>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
          setNavigated(false);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setNavigated(true);
            setActive((a) =>
              e.key === 'ArrowDown' ? Math.min(a + 1, hits.length - 1) : Math.max(a - 1, 0),
            );
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void onEnter(e.shiftKey);
          }
        }}
      />
      {open && hits.length > 0 && (
        <ul className="typeahead-list" role="listbox">
          {hits.map((hit, i) => (
            <li
              key={getKey(hit)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'typeahead-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
            >
              {renderOption(hit)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
