import type { KeyboardEvent } from 'react';

const FIELDS =
  'input:not([type=hidden]):not(:disabled):not([type=checkbox]), select:not(:disabled), textarea:not(:disabled)';

/**
 * Makes Enter move to the next box of a form (like Tab), and press `onLast` on the final box.
 * Use as `<form onKeyDown={enterMovesNext(save)}>`. Buttons and multi-line boxes keep their own Enter.
 */
export function enterMovesNext(onLast?: () => void) {
  return (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.getAttribute('role') === 'combobox') return; // type-ahead boxes handle Enter themselves
    e.preventDefault();
    const boxes = [...e.currentTarget.querySelectorAll<HTMLElement>(FIELDS)];
    const next = boxes[boxes.indexOf(target) + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    } else onLast?.();
  };
}
