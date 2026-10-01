import { useState } from 'react';

/** Remembers the boxes of the grid so Enter can move between them, including boxes that were just added. */
export function useCellFocus() {
  const [map] = useState(() => new Map<string, HTMLInputElement | HTMLButtonElement>());
  // Focus now when the box already exists (so fast typing never outruns it); wait a moment for new rows.
  const focusId = (id: string, select = false) => {
    const go = () => {
      const el = map.get(id);
      el?.focus();
      if (select && el instanceof HTMLInputElement) el.select();
      return el !== undefined;
    };
    if (!go()) setTimeout(go, 0);
  };
  return {
    set: (id: string, el: HTMLInputElement | HTMLButtonElement | null) => {
      if (el) map.set(id, el);
      else map.delete(id);
    },
    focus: (rowKey: number, col: string) => focusId(`${rowKey}:${col}`, true),
    focusId: (id: string) => focusId(id),
    focusFooterButton: () => focusId('footer-button'),
  };
}
