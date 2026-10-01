import type { ReactNode } from 'react';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  num?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  footer,
  empty = 'Nothing to show for this period.',
  rowKey,
  rowClass,
}: {
  columns: Column<T>[];
  rows: T[];
  footer?: ReactNode[];
  empty?: string;
  rowKey: (row: T, index: number) => string | number;
  rowClass?: (row: T) => string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.header} className={c.num ? 'num' : ''}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={rowKey(r, i)} className={rowClass?.(r) ?? ''}>
            {columns.map((c) => (
              <td key={c.header} className={c.num ? 'num' : ''}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr>
            {footer.map((cell, i) => (
              <th key={i} className={columns[i]?.num ? 'num' : ''}>
                {cell}
              </th>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
