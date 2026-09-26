'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import OverviewPanel from '@/components/admin/OverviewPanel';
import UpdatesPanel from '@/components/admin/UpdatesPanel';
import BackupsPanel from '@/components/admin/BackupsPanel';
import UploadsPanel from '@/components/admin/UploadsPanel';
import CadPanel from '@/components/admin/CadPanel';
import WorkoutUsersPanel from '@/components/admin/WorkoutUsersPanel';
import './admin.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🖥️' },
  { id: 'updates', label: 'Updates', icon: '🚀' },
  { id: 'backups', label: 'Backups', icon: '💾' },
  { id: 'uploads', label: 'Upload', icon: '⬆️' },
  { id: 'cad', label: 'CAD', icon: '📐' },
  { id: 'users', label: 'Workout users', icon: '🏋️' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function AdminDashboard() {
  const [tab, setTab] = useState<TabId>('overview');
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // The open tab lives in the URL (#updates) so a refresh or link lands on it.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (TABS.some(t => t.id === fromHash)) setTab(fromHash as TabId);
  }, []);
  // On a phone the tab row scrolls sideways; keep the chosen tab in view.
  useEffect(() => {
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  const choose = (id: TabId) => {
    setTab(id);
    history.replaceState(null, '', `#${id}`);
  };
  const onUpdateStatus = useCallback((available: boolean) => setUpdateAvailable(available), []);

  const handleLogout = async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.href = '/'; };

  return (
    <div className="adm animate-fade-in">
      <div className="adm-top">
        <h1>Admin</h1>
        <div className="adm-actions">
          <Link href="/admin/resume" className="btn btn-secondary">📄 Edit home page</Link>
          <button className="btn btn-secondary" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <nav className="adm-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(t => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} className="adm-tab" onClick={() => choose(t.id)}>
            <span aria-hidden>{t.icon}</span>{t.label}
            {t.id === 'updates' && updateAvailable && <span className="adm-tab-dot" title="Update available" />}
          </button>
        ))}
      </nav>

      {/* Every panel stays mounted (just hidden), so an update or upload keeps going when you switch tabs. */}
      {TABS.map(t => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id}>
          {t.id === 'overview' && <OverviewPanel />}
          {t.id === 'updates' && <UpdatesPanel onStatus={onUpdateStatus} />}
          {t.id === 'backups' && <BackupsPanel />}
          {t.id === 'uploads' && <UploadsPanel />}
          {t.id === 'cad' && <CadPanel />}
          {t.id === 'users' && <WorkoutUsersPanel />}
        </div>
      ))}
    </div>
  );
}
