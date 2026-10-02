import { useLayoutEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a dialog while it is open: focus moves in when it opens (unless a box
 * inside already took it), Tab and Shift+Tab go round the dialog's own controls, and when it closes
 * focus goes back to where it was, unless the screen has already moved it somewhere on purpose.
 * Put the returned ref on the dialog's outer element.
 */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () =>
      box
        ? Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (e) => e.offsetParent !== null,
          )
        : [];
    if (box && !box.contains(document.activeElement)) items()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box) return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !box.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const now = document.activeElement;
      const lost = now === null || now === document.body || (box?.contains(now) ?? false);
      if (lost && before && document.contains(before)) before.focus();
    };
  }, []);
  return ref;
}
