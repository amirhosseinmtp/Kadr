import { useEffect, useState, type FormEvent } from 'react';
import { Aperture, CalendarDays, Clapperboard, LayoutDashboard, LogOut, PanelsTopLeft, PenLine, Settings2, UsersRound, Video, MapPinned, ChevronsUpDown, Plus, Check, X } from 'lucide-react';
import type { AuthUser, WorkspaceOption } from '../../../shared/types';
import type { Language, TranslationKey } from '../lib/i18n';
import { t } from '../lib/i18n';
import { api } from '../lib/api';

export type Section = 'dashboard' | 'projects' | 'screenplay' | 'scenes' | 'casting' | 'production' | 'team' | 'library' | 'settings';

const items: { id: Section; icon: typeof LayoutDashboard; label: TranslationKey }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { id: 'projects', icon: Clapperboard, label: 'projects' },
  { id: 'screenplay', icon: PenLine, label: 'screenplay' },
  { id: 'scenes', icon: PanelsTopLeft, label: 'scenes' },
  { id: 'casting', icon: UsersRound, label: 'casting' },
  { id: 'production', icon: CalendarDays, label: 'production' },
  { id: 'team', icon: Video, label: 'team' },
  { id: 'library', icon: MapPinned, label: 'library' },
];

interface Props { active: Section; onChange: (section: Section) => void; language: Language; projectCount: number; user: AuthUser; onLogout: () => Promise<void>; onWorkspaceChange: (workspaceId: string) => Promise<void>; onWorkspaceCreate: (name: string) => Promise<void>; }

export function Sidebar({ active, onChange, language, projectCount, user, onLogout, onWorkspaceChange, onWorkspaceCreate }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [switchError, setSwitchError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  useEffect(() => { void api.workspaces().then(setWorkspaces).catch(() => setWorkspaces([])); }, [user.id, user.workspaceId]);
  const switchWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === user.workspaceId) return;
    setSwitchError('');
    try { await onWorkspaceChange(workspaceId); }
    catch { setSwitchError(language === 'fa' ? 'تغییر فضای کاری انجام نشد.' : 'Could not switch workspaces.'); }
  };
  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (workspaceName.trim().length < 2) return;
    setSwitchError('');
    try { await onWorkspaceCreate(workspaceName.trim()); setWorkspaceName(''); setCreatingWorkspace(false); }
    catch { setSwitchError(language === 'fa' ? 'ساخت فضای کاری انجام نشد.' : 'Could not create workspace.'); }
  };
  return <aside className="sidebar">
    <button className="brand-lockup" onClick={() => onChange('dashboard')} aria-label={t(language, 'brand')}>
      <span className="brand-mark"><Aperture size={22} strokeWidth={2.2} /></span>
      <span><strong>{t(language, 'brand')}</strong><small>{t(language, 'subtitle')}</small></span>
    </button>
    <div className="sidebar-label">{language === 'fa' ? 'فضای کاری' : 'WORKSPACE'}</div>
    <div className="workspace-switcher"><ChevronsUpDown size={14} /><select aria-label={language === 'fa' ? 'انتخاب فضای کاری' : 'Select workspace'} value={user.workspaceId} onChange={(event) => void switchWorkspace(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}{!workspaces.some((workspace) => workspace.id === user.workspaceId) && <option value={user.workspaceId}>{user.workspaceName}</option>}</select><button type="button" onClick={() => setCreatingWorkspace((visible) => !visible)} aria-label={language === 'fa' ? 'ساخت فضای کاری' : 'Create workspace'} title={language === 'fa' ? 'ساخت فضای کاری' : 'Create workspace'}><Plus size={14} /></button></div>
    {creatingWorkspace && <form className="workspace-create-form" onSubmit={(event) => void createWorkspace(event)}><input autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={100} minLength={2} required placeholder={language === 'fa' ? 'نام فضای کاری' : 'Workspace name'} aria-label={language === 'fa' ? 'نام فضای کاری' : 'Workspace name'} /><button type="submit" aria-label={language === 'fa' ? 'ساخت' : 'Create'}><Check size={14} /></button><button type="button" aria-label={language === 'fa' ? 'لغو' : 'Cancel'} onClick={() => { setCreatingWorkspace(false); setWorkspaceName(''); }}><X size={14} /></button></form>}
    {switchError && <span className="workspace-switch-error" role="status">{switchError}</span>}
    <nav className="side-nav">
      {items.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => onChange(id)} className={`nav-item ${active === id ? 'active' : ''}`}>
        <Icon size={18} strokeWidth={1.8} /><span>{t(language, label)}</span>
        {id === 'projects' && <span className="nav-count">{projectCount.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}</span>}
      </button>)}
    </nav>
    <div className="sidebar-spacer" />
    <div className="sidebar-callout">
      <span className="callout-icon"><Aperture size={16} /></span>
      <strong>{language === 'fa' ? 'هر قاب، یک امکان تازه' : 'Every frame begins somewhere'}</strong>
      <p>{language === 'fa' ? 'ایده‌ها را به روایت‌هایی ماندگار تبدیل کن.' : 'Turn your ideas into lasting stories.'}</p>
      <button onClick={() => onChange('projects')}>{t(language, 'newProject')} <span aria-hidden="true">↗</span></button>
    </div>
    <button className={`nav-item settings-link ${active === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}>
      <Settings2 size={18} strokeWidth={1.8} /><span>{t(language, 'settings')}</span>
    </button>
    <div className="profile-row">
      <div className="avatar">{user.displayName.slice(0, 1)}</div><div className="profile-copy"><strong>{user.displayName}</strong><small title={user.email}>{user.email}</small></div><button className="profile-logout" onClick={() => void onLogout()} title={language === 'fa' ? 'خروج از حساب' : 'Sign out'} aria-label={language === 'fa' ? 'خروج از حساب' : 'Sign out'}><LogOut size={15} /></button>
    </div>
  </aside>;
}
