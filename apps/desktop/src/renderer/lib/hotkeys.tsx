import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Handler = () => void;
type Lookup = (key: string) => Handler | undefined;

interface HotkeyApi {
  add: (lookup: Lookup) => () => void;
  hints: string[];
  setHints: (hints: string[]) => void;
}

const HotkeyContext = createContext<HotkeyApi | null>(null);

/** "F2", "Escape", "Ctrl+S", "Alt+B", "B" (letters are upper-case; Shift is ignored for characters). */
export function normaliseKey(e: KeyboardEvent): string {
  const printable = e.key.length === 1;
  const key = printable ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !printable) parts.push('Shift');
  parts.push(key === ' ' ? 'Space' : key);
  return parts.join('+');
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * One window-level listener. Screens register layers; the newest layer gets the first chance at
 * each key, so a dialog or a voucher screen can take keys (F2, Esc) from the screen under it.
 * Plain letters are never taken while the cursor is in a field.
 */
export function HotkeyProvider({ children }: { children: ReactNode }) {
  const layers = useRef<Lookup[]>([]);
  const [hints, setHints] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = normaliseKey(e);
      const plainCharacter = key.length === 1 || key === 'Space';
      if (plainCharacter && isTyping(e.target)) return;
      for (let i = layers.current.length - 1; i >= 0; i--) {
        const handler = layers.current[i]?.(key);
        if (handler) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // `add` must keep the same identity: layers register once and keep their stacking order.
  const add = useCallback((lookup: Lookup) => {
    layers.current.push(lookup);
    return () => {
      layers.current = layers.current.filter((l) => l !== lookup);
    };
  }, []);
  const api = useMemo<HotkeyApi>(() => ({ add, hints, setHints }), [add, hints]);
  return <HotkeyContext.Provider value={api}>{children}</HotkeyContext.Provider>;
}

function useApi(): HotkeyApi {
  const api = useContext(HotkeyContext);
  if (!api) throw new Error('HotkeyProvider is missing');
  return api;
}

/** Registers keys for as long as the calling component is mounted (and `enabled`). */
export function useHotkeys(keys: Record<string, Handler>, enabled = true): void {
  const { add } = useApi();
  const latest = useRef(keys);
  // a layout effect, so a key pressed right after a render never sees the previous screen state
  useLayoutEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    if (!enabled) return;
    return add((key) => latest.current[key]);
  }, [add, enabled]);
}

/** Text for the status bar at the bottom: the keys that work on this screen. */
export function useHints(hints: string[]): void {
  const { setHints } = useApi();
  const text = hints.join('|');
  useEffect(() => {
    setHints(text === '' ? [] : text.split('|'));
    return () => setHints([]);
  }, [setHints, text]);
}

export function useCurrentHints(): string[] {
  return useApi().hints;
}
