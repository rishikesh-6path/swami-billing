export type Preset = 'today' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';

export const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisQuarter: 'This quarter',
  thisYear: 'This financial year',
  custom: 'Choose dates',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** The date range for a preset. Quarters follow the financial year: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar. */
export function presetRange(
  preset: Exclude<Preset, 'custom'>,
  today: string,
  fy: { startDate: string; endDate: string } | null,
): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'thisMonth':
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
    case 'lastMonth':
      return { from: iso(utc(y, m - 2, 1)), to: iso(utc(y, m - 1, 0)) };
    case 'thisQuarter': {
      const quarterStartMonth = Math.floor(((m - 4 + 12) % 12) / 3) * 3 + 3; // zero-based month of quarter start
      const startYear = quarterStartMonth > m - 1 ? y - 1 : y;
      return {
        from: iso(utc(startYear, quarterStartMonth, 1)),
        to: iso(utc(startYear, quarterStartMonth + 3, 0)),
      };
    }
    case 'thisYear':
      return fy
        ? { from: fy.startDate, to: fy.endDate }
        : { from: iso(utc(m >= 4 ? y : y - 1, 3, 1)), to: iso(utc(m >= 4 ? y + 1 : y, 3, 0)) };
  }
}
