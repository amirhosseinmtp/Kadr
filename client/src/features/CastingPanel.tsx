import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Pencil, Plus, Save, Search, Trash2, UserRound, UsersRound, Video } from 'lucide-react';
import type { CastingAssignment, CastingAssignmentStatus, CastingRole, CastingStatus, TalentProfile } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';

const splitTags = (value: string) => value.split(/[,،\n]/).map((part) => part.trim()).filter(Boolean);
const assignmentStates: CastingAssignmentStatus[] = ['considering', 'audition', 'shortlist', 'cast', 'declined'];
type TalentEditForm = { name: string; profession: string; biography: string; skills: string; languages: string; tags: string; showreelUrl: string; contactEmail: string; contactPhone: string; privateNotes: string };

export function CastingPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [roles, setRoles] = useState<CastingRole[]>([]);
  const [talents, setTalents] = useState<TalentProfile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, CastingAssignment[]>>({});
  const [query, setQuery] = useState('');
  const [character, setCharacter] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [profession, setProfession] = useState(fa ? 'بازیگر' : 'Actor');
  const [biography, setBiography] = useState('');
  const [skills, setSkills] = useState('');
  const [languages, setLanguages] = useState('');
  const [tags, setTags] = useState('');
  const [showreelUrl, setShowreelUrl] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [privateDetails, setPrivateDetails] = useState<Record<string, { contactEmail: string; contactPhone: string; privateNotes: string }>>({});
  const [talentEdits, setTalentEdits] = useState<Record<string, TalentEditForm>>({});
  const [selectedTalentByRole, setSelectedTalentByRole] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [roleRows, talentRows] = await Promise.all([api.roles(projectId), api.talents()]);
      setRoles(roleRows); setTalents(talentRows);
      const assignmentRows = await Promise.all(roleRows.map(async (role) => [role.id, await api.assignments(role.id)] as const));
      setAssignments(Object.fromEntries(assignmentRows));
    } catch { onToast(t(language, 'error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const visibleTalents = useMemo(() => talents.filter((talent) => `${talent.name} ${talent.profession} ${talent.skills.join(' ')} ${talent.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [talents, query]);
  const addRole = async (event: FormEvent) => {
    event.preventDefault(); if (!character.trim()) return;
    try { const role = await api.createRole(projectId, character.trim(), description.trim()); setRoles((current) => [role, ...current]); setAssignments((current) => ({ ...current, [role.id]: [] })); setCharacter(''); setDescription(''); }
    catch { onToast(t(language, 'error')); }
  };
  const addTalent = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim()) return;
    setSaving(true);
    try {
      const profile = await api.createTalent({ name: name.trim(), profession: profession.trim() || (fa ? 'بازیگر' : 'Actor'), biography: biography.trim(), skills: splitTags(skills), languages: splitTags(languages), tags: splitTags(tags), showreelUrl: showreelUrl.trim(), contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(), privateNotes: privateNotes.trim() });
      setTalents((current) => [...current, profile].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setBiography(''); setSkills(''); setLanguages(''); setTags(''); setShowreelUrl(''); setContactEmail(''); setContactPhone(''); setPrivateNotes('');
      onToast(fa ? 'پروفایل هنرمند ذخیره شد.' : 'Talent profile saved.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setSaving(false); }
  };
  const addCandidate = async (roleId: string) => {
    const talentId = selectedTalentByRole[roleId]; if (!talentId) return;
    try {
      const assignment = await api.createAssignment(roleId, talentId);
      setAssignments((current) => ({ ...current, [roleId]: [assignment, ...(current[roleId] ?? [])] }));
      setSelectedTalentByRole((current) => ({ ...current, [roleId]: '' }));
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const updateRole = async (role: CastingRole, status: CastingStatus, candidate = role.candidate) => {
    try { const result = await api.updateRole(role.id, status, candidate); setRoles((current) => current.map((item) => item.id === result.id ? result : item)); }
    catch { onToast(t(language, 'error')); }
  };
  const updateAssignment = async (roleId: string, assignment: CastingAssignment, input: { status?: CastingAssignmentStatus; notes?: string }) => {
    try { const result = await api.updateAssignment(assignment.id, input); setAssignments((current) => ({ ...current, [roleId]: (current[roleId] ?? []).map((item) => item.id === result.id ? result : item) })); }
    catch { onToast(t(language, 'error')); }
  };
  const deleteAssignment = async (roleId: string, id: string) => {
    try { await api.deleteAssignment(id); setAssignments((current) => ({ ...current, [roleId]: (current[roleId] ?? []).filter((item) => item.id !== id) })); }
    catch { onToast(t(language, 'error')); }
  };
  const removeRole = async (id: string) => {
    if (!window.confirm(fa ? 'این نقش و گزینه‌های انتخاب بازیگر آن حذف شوند؟' : 'Delete this role and its candidate assignments?')) return;
    try { await api.deleteRole(id); setRoles((current) => current.filter((item) => item.id !== id)); setAssignments((current) => { const next = { ...current }; delete next[id]; return next; }); }
    catch { onToast(t(language, 'error')); }
  };
  const revealPrivate = async (talentId: string) => {
    if (privateDetails[talentId]) { setPrivateDetails((current) => { const next = { ...current }; delete next[talentId]; return next; }); return; }
    try { const details = await api.talentPrivate(talentId); setPrivateDetails((current) => ({ ...current, [talentId]: details })); }
    catch { onToast(t(language, 'error')); }
  };
  const removeTalent = async (talent: TalentProfile) => {
    if (!window.confirm(fa ? `پروفایل «${talent.name}» و اتصال‌های انتخاب بازیگر حذف شود؟` : `Delete ${talent.name}'s profile and casting links?`)) return;
    try { await api.deleteTalent(talent.id); setTalents((current) => current.filter((item) => item.id !== talent.id)); await load(); }
    catch { onToast(t(language, 'error')); }
  };
  const beginTalentEdit = async (talent: TalentProfile) => {
    try {
      const details = privateDetails[talent.id] ?? await api.talentPrivate(talent.id);
      setPrivateDetails((current) => ({ ...current, [talent.id]: details }));
      setTalentEdits((current) => ({ ...current, [talent.id]: { name: talent.name, profession: talent.profession, biography: talent.biography, skills: talent.skills.join('، '), languages: talent.languages.join('، '), tags: talent.tags.join('، '), showreelUrl: talent.showreelUrl, ...details } }));
    } catch { onToast(t(language, 'error')); }
  };
  const saveTalent = async (talentId: string) => {
    const edit = talentEdits[talentId]; if (!edit) return;
    try {
      const updated = await api.updateTalent(talentId, { name: edit.name, profession: edit.profession, biography: edit.biography, skills: splitTags(edit.skills), languages: splitTags(edit.languages), tags: splitTags(edit.tags), showreelUrl: edit.showreelUrl, contactEmail: edit.contactEmail, contactPhone: edit.contactPhone, privateNotes: edit.privateNotes });
      setTalents((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPrivateDetails((current) => ({ ...current, [talentId]: { contactEmail: edit.contactEmail, contactPhone: edit.contactPhone, privateNotes: edit.privateNotes } }));
      setTalentEdits((current) => { const next = { ...current }; delete next[talentId]; return next; }); onToast(t(language, 'saved'));
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const roleStates: CastingStatus[] = ['open', 'shortlist', 'cast'];
  const assignmentLabel: Record<CastingAssignmentStatus, string> = {
    considering: fa ? 'در حال بررسی' : 'Considering', audition: fa ? 'دعوت به تست' : 'Audition', shortlist: fa ? 'گزینه نهایی' : 'Shortlist', cast: fa ? 'انتخاب‌شده' : 'Cast', declined: fa ? 'ردشده' : 'Declined',
  };

  return <div className="casting-page">
    <div className="module-header"><div><span className="eyebrow">{fa ? 'اتاق انتخاب بازیگر' : 'CASTING ROOM'}</span><h2>{t(language, 'casting')}</h2><p>{fa ? 'نقش‌ها، پروفایل استعدادها و مسیر تصمیم‌گیری را یک‌جا مدیریت کن.' : 'Manage roles, talent profiles, and casting decisions in one place.'}</p></div></div>
    <div className="casting-stats">{roleStates.map((status) => <div className="casting-stat" key={status}><span className={`status-dot ${status}`} /><span>{t(language, status)}</span><strong>{roles.filter((role) => role.status === status).length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</strong></div>)}<div className="casting-stat"><UserRound size={15} /><span>{fa ? 'پروفایل استعداد' : 'Talent profiles'}</span><strong>{talents.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</strong></div></div>
    <div className="casting-tools-grid">
      <form className="add-role-form" onSubmit={(event) => void addRole(event)}><div className="form-section-title"><UsersRound size={17} /><strong>{t(language, 'addRole')}</strong></div><div className="form-grid"><label>{t(language, 'character')}<input value={character} onChange={(event) => setCharacter(event.target.value)} placeholder={fa ? 'مثلاً: ناهید' : 'e.g. Nahid'} required /></label><label>{t(language, 'description')}<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={fa ? 'ویژگی‌ها و توضیحات نقش' : 'Traits and role notes'} /></label><button className="button button-primary" type="submit"><Plus size={16} />{t(language, 'addRole')}</button></div></form>
      <form className="add-role-form talent-create-form" onSubmit={(event) => void addTalent(event)}><div className="form-section-title"><UserRound size={17} /><strong>{fa ? 'ثبت پروفایل استعداد' : 'Add a talent profile'}</strong><small>{fa ? 'اطلاعات تماس خصوصی نگه داشته می‌شود' : 'Contact details stay private by default'}</small></div><div className="talent-form-grid"><label>{fa ? 'نام و نام حرفه‌ای' : 'Name'}<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>{fa ? 'حرفه' : 'Profession'}<input value={profession} onChange={(event) => setProfession(event.target.value)} /></label><label>{fa ? 'مهارت‌ها' : 'Skills'}<input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder={fa ? 'مثلاً: درام، لهجه شمالی' : 'Drama, dialects'} /></label><label>{fa ? 'زبان‌ها' : 'Languages'}<input value={languages} onChange={(event) => setLanguages(event.target.value)} /></label><label className="talent-wide">{fa ? 'زندگی‌نامه' : 'Biography'}<textarea rows={2} value={biography} onChange={(event) => setBiography(event.target.value)} /></label><label>{fa ? 'برچسب‌ها' : 'Tags'}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label><label>{fa ? 'پیوند شو‌ریل' : 'Showreel URL'}<input dir="ltr" type="url" value={showreelUrl} onChange={(event) => setShowreelUrl(event.target.value)} placeholder="https://" /></label><details className="talent-private-fields talent-wide"><summary>{fa ? 'اطلاعات تماس و یادداشت خصوصی' : 'Private contact and notes'}</summary><div className="talent-form-grid"><label>{fa ? 'ایمیل' : 'Email'}<input dir="ltr" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label><label>{fa ? 'تلفن' : 'Phone'}<input dir="ltr" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label><label className="talent-wide">{fa ? 'یادداشت داخلی' : 'Internal notes'}<textarea rows={2} value={privateNotes} onChange={(event) => setPrivateNotes(event.target.value)} /></label></div></details><button className="button button-quiet talent-submit" type="submit" disabled={saving || !name.trim()}><Plus size={15} />{saving ? '…' : fa ? 'ذخیره‌ی پروفایل' : 'Save profile'}</button></div></form>
    </div>
    <div className="casting-section-title"><div><span className="eyebrow">{fa ? 'نقش‌های این پروژه' : 'PROJECT ROLES'}</span><h3>{fa ? 'مسیر انتخاب بازیگر' : 'Casting pipeline'}</h3></div></div>
    {loading ? <div className="loading-line" /> : roles.length === 0 ? <div className="empty-card"><div className="empty-icon"><UserRound size={22} /></div><h3>{t(language, 'emptyRoles')}</h3><p>{fa ? 'اولین نقش را اضافه کن تا گزینه‌های بازیگر را با هم مقایسه کنی.' : 'Add a role to start comparing potential performers.'}</p></div> : <div className="role-grid">{roles.map((role) => <article className="role-card role-card-expanded" key={role.id}>
      <div className="role-card-top"><div className="character-avatar"><UserRound size={20} /></div><button className="icon-button delete-button" onClick={() => void removeRole(role.id)} aria-label={fa ? 'حذف نقش' : 'Delete role'}><Trash2 size={16} /></button></div>
      <h3>{role.character}</h3><p>{role.description || (fa ? 'توضیحی ثبت نشده.' : 'No description added.')}</p>
      <label className="candidate-field">{t(language, 'candidate')}<input value={role.candidate} onChange={(event) => setRoles((current) => current.map((item) => item.id === role.id ? { ...item, candidate: event.target.value } : item))} onBlur={(event) => void updateRole(role, role.status, event.target.value)} placeholder={fa ? 'نام آزاد برای انتخاب‌شده' : 'Name for a selected actor'} /></label>
      <div className="role-status-row"><span className={`status-chip ${role.status}`}>{t(language, role.status)}</span><select value={role.status} onChange={(event) => void updateRole(role, event.target.value as CastingStatus, role.candidate)} aria-label={`${role.character} — ${t(language, 'status')}`}><option value="open">{t(language, 'open')}</option><option value="shortlist">{t(language, 'shortlist')}</option><option value="cast">{t(language, 'cast')}</option></select></div>
      <div className="role-candidate-link"><select value={selectedTalentByRole[role.id] ?? ''} onChange={(event) => setSelectedTalentByRole((current) => ({ ...current, [role.id]: event.target.value }))}><option value="">{fa ? 'انتخاب از دفتر استعدادها' : 'Choose from talent library'}</option>{talents.map((talent) => <option key={talent.id} value={talent.id}>{talent.name} · {talent.profession}</option>)}</select><button className="square-button" onClick={() => void addCandidate(role.id)} disabled={!selectedTalentByRole[role.id]} aria-label={fa ? 'افزودن گزینه' : 'Add candidate'}><Plus size={16} /></button></div>
      <div className="candidate-assignment-list">{(assignments[role.id] ?? []).map((assignment) => { const talent = talents.find((item) => item.id === assignment.talentId); if (!talent) return null; return <div className="candidate-assignment" key={assignment.id}><span className="candidate-avatar">{talent.name.slice(0, 1)}</span><span className="candidate-assignment-name"><strong>{talent.name}</strong><small>{talent.profession}</small></span><select value={assignment.status} onChange={(event) => void updateAssignment(role.id, assignment, { status: event.target.value as CastingAssignmentStatus })} aria-label={`${talent.name} — ${fa ? 'وضعیت' : 'status'}`}>{assignmentStates.map((state) => <option key={state} value={state}>{assignmentLabel[state]}</option>)}</select><button className="icon-button task-delete" onClick={() => void deleteAssignment(role.id, assignment.id)} aria-label={fa ? 'حذف گزینه' : 'Remove candidate'}><Trash2 size={13} /></button></div>; })}</div>
    </article>)}</div>}
    <div className="casting-section-title talent-directory-heading"><div><span className="eyebrow">{fa ? 'دفتر استعدادها' : 'TALENT DIRECTORY'}</span><h3>{fa ? 'پروفایل‌های ذخیره‌شده' : 'Saved profiles'}</h3></div><label className="talent-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={fa ? 'جست‌وجوی نام، مهارت یا برچسب' : 'Search names, skills, tags'} /></label></div>
    {loading ? <div className="loading-line" /> : visibleTalents.length ? <div className="talent-grid">{visibleTalents.map((talent) => { const edit = talentEdits[talent.id]; const setEdit = (key: keyof TalentEditForm, value: string) => setTalentEdits((current) => ({ ...current, [talent.id]: { ...current[talent.id], [key]: value } })); return <article className="talent-card" key={talent.id}><div className="talent-card-heading"><span className="talent-avatar">{talent.name.slice(0, 1)}</span><div><h4>{talent.name}</h4><small>{talent.profession}</small></div><button className="icon-button" onClick={() => edit ? setTalentEdits((current) => { const next = { ...current }; delete next[talent.id]; return next; }) : void beginTalentEdit(talent)} aria-label={fa ? 'ویرایش پروفایل' : 'Edit profile'}>{edit ? <EyeOff size={13} /> : <Pencil size={13} />}</button><button className="icon-button task-delete" onClick={() => void removeTalent(talent)} aria-label={fa ? 'حذف پروفایل' : 'Delete profile'}><Trash2 size={14} /></button></div><p>{talent.biography || (fa ? 'زندگی‌نامه‌ای ثبت نشده.' : 'No biography added.')}</p><div className="talent-tags">{[...talent.skills, ...talent.languages, ...talent.tags].slice(0, 8).map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div><div className="talent-card-actions">{talent.showreelUrl && <a href={talent.showreelUrl} target="_blank" rel="noreferrer"><Video size={14} />{fa ? 'مشاهده‌ی شو‌ریل' : 'View showreel'}</a>}<button onClick={() => void revealPrivate(talent.id)}>{privateDetails[talent.id] ? <EyeOff size={14} /> : <Eye size={14} />}{privateDetails[talent.id] ? (fa ? 'پنهان‌کردن اطلاعات' : 'Hide private details') : (fa ? 'اطلاعات تماس خصوصی' : 'Private contact')}</button></div>{privateDetails[talent.id] && <div className="talent-private-preview"><span dir="ltr">{privateDetails[talent.id].contactEmail || '—'}</span><span dir="ltr">{privateDetails[talent.id].contactPhone || '—'}</span>{privateDetails[talent.id].privateNotes && <p>{privateDetails[talent.id].privateNotes}</p>}</div>}{edit && <div className="talent-edit-form"><label>{fa ? 'نام' : 'Name'}<input value={edit.name} onChange={(event) => setEdit('name', event.target.value)} /></label><label>{fa ? 'حرفه' : 'Profession'}<input value={edit.profession} onChange={(event) => setEdit('profession', event.target.value)} /></label><label>{fa ? 'زندگی‌نامه' : 'Biography'}<textarea rows={2} value={edit.biography} onChange={(event) => setEdit('biography', event.target.value)} /></label><label>{fa ? 'مهارت‌ها' : 'Skills'}<input value={edit.skills} onChange={(event) => setEdit('skills', event.target.value)} /></label><label>{fa ? 'زبان‌ها' : 'Languages'}<input value={edit.languages} onChange={(event) => setEdit('languages', event.target.value)} /></label><label>{fa ? 'برچسب‌ها' : 'Tags'}<input value={edit.tags} onChange={(event) => setEdit('tags', event.target.value)} /></label><label>{fa ? 'پیوند شو‌ریل' : 'Showreel URL'}<input dir="ltr" value={edit.showreelUrl} onChange={(event) => setEdit('showreelUrl', event.target.value)} /></label><label>{fa ? 'ایمیل خصوصی' : 'Private email'}<input dir="ltr" value={edit.contactEmail} onChange={(event) => setEdit('contactEmail', event.target.value)} /></label><label>{fa ? 'تلفن خصوصی' : 'Private phone'}<input dir="ltr" value={edit.contactPhone} onChange={(event) => setEdit('contactPhone', event.target.value)} /></label><label>{fa ? 'یادداشت خصوصی' : 'Private notes'}<textarea rows={2} value={edit.privateNotes} onChange={(event) => setEdit('privateNotes', event.target.value)} /></label><button className="button button-quiet button-small" onClick={() => void saveTalent(talent.id)}><Save size={13} />{t(language, 'save')}</button></div>}</article>; })}</div> : <div className="empty-card empty-talent-directory"><div className="empty-icon"><Search size={20} /></div><h3>{fa ? 'هنرمندی پیدا نشد' : 'No matching talent'}</h3><p>{fa ? 'واژه‌ی دیگری جست‌وجو کن یا پروفایل تازه‌ای بساز.' : 'Try a different search or add a new profile.'}</p></div>}
  </div>;
}
