import { useState } from 'react';
import type { SessionState } from '../../../ipc/contract.ts';
import { PageHeader } from '../../components/ui.tsx';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { BackupSection } from './BackupSection.tsx';
import { ClosingSection } from './ClosingSection.tsx';
import { NotesSection } from './NotesSection.tsx';
import { PrintSection } from './PrintSection.tsx';
import { ShopSection } from './ShopSection.tsx';
import { UsersSection } from './UsersSection.tsx';

const SECTIONS = [
  { id: 'shop', label: 'Shop details' },
  { id: 'print', label: 'Printing' },
  { id: 'users', label: 'People who use ShopLedger' },
  { id: 'notes', label: 'Standard notes' },
  { id: 'closing', label: 'Closing days and years' },
  { id: 'backup', label: 'Backup and restore' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Owner-only settings. Each section saves on its own, so nothing is lost by moving between them. */
export function SettingsScreen({
  initial,
  onSession,
}: {
  initial?: SectionId | undefined;
  onSession: (s: SessionState) => void;
}) {
  const [section, setSection] = useState<SectionId>(initial ?? 'shop');
  useHotkeys({
    'Alt+1': () => setSection('shop'),
    'Alt+2': () => setSection('print'),
    'Alt+3': () => setSection('users'),
    'Alt+4': () => setSection('notes'),
    'Alt+5': () => setSection('closing'),
    'Alt+6': () => setSection('backup'),
  });
  useHints(['Alt+1 to Alt+6 Change section', 'F2 Save', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader title="Settings" subtitle="Only the owner can see this screen." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`settings-tab ${s.id === section ? 'settings-tab-on' : ''}`}
              aria-current={s.id === section ? 'page' : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label} <span className="muted">Alt+{i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === 'shop' && <ShopSection onSession={onSession} />}
          {section === 'print' && <PrintSection />}
          {section === 'users' && <UsersSection />}
          {section === 'notes' && <NotesSection />}
          {section === 'closing' && <ClosingSection />}
          {section === 'backup' && <BackupSection />}
        </div>
      </div>
    </main>
  );
}
