import { useEffect, useState, type FormEvent } from 'react';
import { Plus, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import type { ProjectMember } from '../../../shared/types';
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';
import { CollaborationPanel } from './CollaborationPanel';

export function CrewPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('production');
  const [invitationToken, setInvitationToken] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { const [crewRows, workspace, inviteRows, permissions] = await Promise.all([api.members(projectId), api.workspace(), api.invitations().catch(() => []), api.projectPermissions(projectId)]); setMembers(crewRows); setWorkspaceMembers(workspace.members); setInvitations(inviteRows); setCanManageTeam(permissions.canManageTeam); setCanInvite(permissions.canInvite); } catch { onToast(t(language, 'error')); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [projectId]);
  const add = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim()) return;
    try { const member = await api.createMember(projectId, { name: name.trim(), role: role.trim(), department: department.trim() }); setMembers((current) => [...current, member].sort((a, b) => a.name.localeCompare(b.name))); setName(''); setRole(''); setDepartment(''); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const remove = async (member: ProjectMember) => {
    if (!window.confirm(fa ? `«${member.name}» از گروه پروژه حذف شود؟ وظایفش بدون مسئول می‌مانند.` : `Remove ${member.name} from this project? Their tasks will become unassigned.`)) return;
    try { await api.deleteMember(member.id); setMembers((current) => current.filter((item) => item.id !== member.id)); }
    catch { onToast(t(language, 'error')); }
  };
  const invite = async (event: FormEvent) => {
    event.preventDefault(); if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    try { const created = await api.createInvitation({ email: inviteEmail.trim(), role: inviteRole, projectId }); setInvitationToken(created.invitationToken); setInvitations((current) => [created, ...current]); setInviteEmail(''); onToast(fa ? 'دعوت‌نامه ساخته شد؛ کد را برای همکار بفرست.' : 'Invitation created. Share the token with your collaborator.'); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setInviteBusy(false); }
  };
  const revokeInvite = async (invitation: WorkspaceInvitation) => {
    try { await api.deleteInvitation(invitation.id); setInvitations((current) => current.filter((item) => item.id !== invitation.id)); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const roleName = (role: WorkspaceRole) => ({ owner: fa ? 'مالک' : 'Owner', admin: fa ? 'مدیر' : 'Admin', producer: fa ? 'تهیه‌کننده' : 'Producer', director: fa ? 'کارگردان' : 'Director', writer: fa ? 'نویسنده' : 'Writer', casting_director: fa ? 'مدیر انتخاب بازیگر' : 'Casting director', production: fa ? 'گروه تولید' : 'Production', viewer: fa ? 'فقط مشاهده' : 'Viewer' })[role];
  return <div className="crew-page"><header className="module-header"><div><span className="eyebrow">{fa ? 'گروه این تولید' : 'THIS PRODUCTION'}</span><h2>{fa ? 'گروه و مسئولیت‌ها' : 'Crew & responsibilities'}</h2><p>{fa ? 'اعضای گروه پروژه را ثبت کن و وظایف تولید را به آن‌ها بسپار.' : 'Keep the production roster here and assign production tasks to crew members.'}</p></div><span className="crew-count"><UsersRound size={16} />{members.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></header>
    <div className="crew-privacy-note"><ShieldCheck size={17} /><span>{fa ? 'حساب و سطح دسترسی پروژه فعال است. برای همکاری از دستگاه‌های دیگر، سرور را پشت HTTPS و در دسترس گروه قرار بده؛ دعوت پروژه‌ای به همین پروژه محدود می‌ماند.' : 'Accounts and project access roles are active. For collaborators on other devices, expose the server behind HTTPS; project invitations remain scoped to this production.'}</span></div>
    <section className="workspace-collaboration"><div className="crew-section-heading"><div><span className="eyebrow">{fa ? 'حساب‌ها و دسترسی‌ها' : 'ACCOUNTS & ACCESS'}</span><h3>{fa ? 'همکاران این فضا' : 'Workspace collaborators'}</h3></div></div><p>{fa ? 'دعوت پروژه‌ای، دسترسی همکار را به همین پروژه محدود می‌کند. کد دعوت فقط یک‌بار نمایش داده می‌شود و باید امن برای همکار فرستاده شود.' : 'Project invitations are limited to this production. The token is shown once; share it privately with the collaborator.'}</p>
      {canInvite && <form className="crew-invite-form" onSubmit={(event) => void invite(event)}><label>{fa ? 'ایمیل همکار' : 'Collaborator email'}<input dir="ltr" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></label><label>{fa ? 'نقش پروژه' : 'Project role'}<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)}>{(['producer', 'director', 'writer', 'casting_director', 'production', 'viewer'] as const).map((roleNameOption) => <option value={roleNameOption} key={roleNameOption}>{roleName(roleNameOption)}</option>)}</select></label><button className="button button-quiet" type="submit" disabled={inviteBusy}><Plus size={14} />{inviteBusy ? '…' : fa ? 'ساخت کد دعوت' : 'Create invite token'}</button></form>}
      {invitationToken && <div className="invitation-token-row"><div><strong>{fa ? 'کد یک‌بارمصرف دعوت' : 'One-time invitation token'}</strong><code dir="ltr">{invitationToken}</code></div><button className="button button-quiet button-small" onClick={() => { void navigator.clipboard?.writeText(invitationToken).then(() => onToast(fa ? 'کد کپی شد.' : 'Token copied.')).catch(() => onToast(fa ? 'کد را دستی کپی کن.' : 'Copy the token manually.')); }}>{fa ? 'کپی کد' : 'Copy token'}</button><button className="icon-button" onClick={() => setInvitationToken('')} aria-label={fa ? 'پنهان‌کردن کد' : 'Hide token'}>×</button></div>}
      {workspaceMembers.length ? <div className="workspace-member-list">{workspaceMembers.map((member) => <article className="workspace-member-row" key={member.userId}><span className="crew-avatar">{member.displayName.slice(0, 1)}</span><span><strong>{member.displayName}</strong><small>{member.email}</small></span><b>{roleName(member.role)}</b></article>)}</div> : <div className="library-empty">{fa ? 'کاربر دیگری به این فضای کاری دسترسی ندارد؛ دعوت بالا فقط به همین پروژه دسترسی می‌دهد.' : 'No other workspace accounts are listed. The invitation above grants access to this project only.'}</div>}
      {!!invitations.length && <div className="pending-invitations"><strong>{fa ? 'دعوت‌های در انتظار' : 'Pending invitations'}</strong>{invitations.map((invitation) => <div key={invitation.id}><span dir="ltr">{invitation.email}</span><small>{roleName(invitation.role)} · {new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(invitation.expiresAt))}</small>{canInvite && <button className="text-link" onClick={() => void revokeInvite(invitation)}>{fa ? 'لغو دعوت' : 'Revoke'}</button>}</div>)}</div>}
    </section>
    {canManageTeam && <form className="crew-add-form" onSubmit={(event) => void add(event)}><label>{fa ? 'نام عضو گروه' : 'Crew member'}<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>{fa ? 'سمت' : 'Role'}<input value={role} onChange={(event) => setRole(event.target.value)} placeholder={fa ? 'مثلاً: دستیار کارگردان' : 'e.g. Assistant director'} /></label><label>{fa ? 'واحد' : 'Department'}<input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder={fa ? 'مثلاً: کارگردانی' : 'e.g. Directing'} /></label><button className="button button-primary" type="submit"><Plus size={15} />{fa ? 'افزودن عضو' : 'Add crew'}</button></form>}
    {loading ? <div className="loading-line" /> : members.length ? <div className="crew-grid">{members.map((member) => <article className="crew-card" key={member.id}><span className="crew-avatar">{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>{member.role || (fa ? 'سمت ثبت نشده' : 'Role not set')}</small><span>{member.department || (fa ? 'واحد ثبت نشده' : 'Department not set')}</span></div>{canManageTeam && <button className="icon-button task-delete" onClick={() => void remove(member)} aria-label={fa ? 'حذف عضو گروه' : 'Remove crew member'}><Trash2 size={14} /></button>}</article>)}</div> : <div className="empty-card"><div className="empty-icon"><UsersRound size={20} /></div><h3>{fa ? 'هنوز عضوی ثبت نشده' : 'No crew members yet'}</h3><p>{fa ? 'کارگردان، تهیه‌کننده و همکارانت را به فهرست این تولید اضافه کن.' : 'Add the director, producer, and collaborators working on this production.'}</p></div>}
    <CollaborationPanel key={projectId} projectId={projectId} language={language} onToast={onToast} />
  </div>;
}
