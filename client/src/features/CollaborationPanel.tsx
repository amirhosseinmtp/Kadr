import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, MessageCircle, Pencil, Send, Trash2, X, LockKeyhole, Save } from 'lucide-react';
import type { ProjectActivity, ProjectComment, ProjectCommentScope, ProductionScene, ScreenplayDraft } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';

type Feed = 'discussion' | 'activity' | 'personal';

export function CollaborationPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [feed, setFeed] = useState<Feed>('discussion');
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [activity, setActivity] = useState<ProjectActivity[]>([]);
  const [personalNote, setPersonalNote] = useState('');
  const [savedPersonalNote, setSavedPersonalNote] = useState('');
  const [drafts, setDrafts] = useState<ScreenplayDraft[]>([]);
  const [scenes, setScenes] = useState<ProductionScene[]>([]);
  const [scopeType, setScopeType] = useState<ProjectCommentScope>('project');
  const [scopeId, setScopeId] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPersonalNote, setSavingPersonalNote] = useState(false);
  const [canComment, setCanComment] = useState(false);

  const scopeOptions = useMemo(() => scopeType === 'screenplay'
    ? drafts.map((draft) => ({ id: draft.id, label: draft.title }))
    : scopeType === 'scene' ? scenes.map((scene) => ({ id: scene.id, label: `${scene.screenplayOrder} · ${scene.heading}` })) : [], [scopeType, drafts, scenes]);

  const load = async () => {
    setLoading(true);
    try {
      const [commentRows, activityRows, draftRows, sceneRows, permissions, note] = await Promise.all([api.projectComments(projectId), api.projectActivity(projectId), api.drafts(projectId), api.scenes(projectId), api.projectPermissions(projectId), api.personalProjectNote(projectId)]);
      setComments(commentRows); setActivity(activityRows); setDrafts(draftRows); setScenes(sceneRows); setCanComment(permissions.canComment); setPersonalNote(note.body); setSavedPersonalNote(note.body);
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'بارگذاری گفت‌وگو انجام نشد.' : 'Could not load project discussion.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => { if (scopeType === 'project') setScopeId(''); else setScopeId((current) => scopeOptions.some((option) => option.id === current) ? current : scopeOptions[0]?.id ?? ''); }, [scopeType, scopeOptions]);

  const clearEditor = () => { setBody(''); setEditingId(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await api.updateProjectComment(editingId, body);
        setComments((current) => current.map((comment) => comment.id === editingId ? updated : comment));
        await loadActivity();
        onToast(fa ? 'دیدگاه ویرایش شد.' : 'Comment updated.');
      } else {
        const created = await api.createProjectComment(projectId, { scopeType, scopeId: scopeType === 'project' ? null : scopeId || null, body });
        setComments((current) => [...current, created]);
        await loadActivity();
        onToast(fa ? 'دیدگاه در پروژه ثبت شد.' : 'Comment added to the project.');
      }
      clearEditor();
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'ذخیره‌ی دیدگاه انجام نشد.' : 'Could not save comment.')); }
    finally { setSaving(false); }
  };

  const edit = (comment: ProjectComment) => { setEditingId(comment.id); setBody(comment.body); setFeed('discussion'); };
  const remove = async (comment: ProjectComment) => {
    const confirmed = window.confirm(fa ? 'این دیدگاه از گفت‌وگوی پروژه حذف شود؟' : 'Delete this project comment?');
    if (!confirmed) return;
    try { await api.deleteProjectComment(comment.id); setComments((current) => current.filter((item) => item.id !== comment.id)); await loadActivity(); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'حذف دیدگاه انجام نشد.' : 'Could not delete comment.')); }
  };
  const loadActivity = async () => { try { setActivity(await api.projectActivity(projectId)); } catch { /* Keep the visible discussion usable when the activity service is unavailable. */ } };
  const savePrivateNote = async () => {
    setSavingPersonalNote(true);
    try { const saved = await api.savePersonalProjectNote(projectId, personalNote); setPersonalNote(saved.body); setSavedPersonalNote(saved.body); onToast(fa ? 'یادداشت شخصی ذخیره شد.' : 'Personal note saved.'); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'ذخیره‌ی یادداشت انجام نشد.' : 'Could not save personal note.')); }
    finally { setSavingPersonalNote(false); }
  };

  const scopeLabel = (comment: ProjectComment) => comment.scopeType === 'project'
    ? (fa ? 'گفت‌وگوی پروژه' : 'Project discussion')
    : comment.scopeType === 'screenplay'
      ? `${fa ? 'فیلمنامه' : 'Screenplay'} · ${drafts.find((draft) => draft.id === comment.scopeId)?.title ?? (fa ? 'نسخه‌ی حذف‌شده' : 'Removed draft')}`
      : `${fa ? 'صحنه' : 'Scene'} · ${scenes.find((scene) => scene.id === comment.scopeId)?.screenplayOrder ?? ''} ${scenes.find((scene) => scene.id === comment.scopeId)?.heading ?? (fa ? 'صحنه‌ی حذف‌شده' : 'Removed scene')}`;

  const eventLabel = (item: ProjectActivity) => {
    const labels: Record<string, [string, string]> = {
      'project.created': ['پروژه ساخته شد', 'Project created'],
      'project.updated': ['مشخصات پروژه به‌روزرسانی شد', 'Project details updated'],
        'project.document_uploaded': ['فایل تازه‌ای به پروژه افزوده شد', 'Project file uploaded'],
        'project.document_deleted': ['یکی از پیوست‌های پروژه حذف شد', 'Project attachment deleted'],
      'screenplay.created': ['نسخه‌ی فیلمنامه ساخته شد', 'Screenplay draft created'],
      'screenplay.updated': ['نسخه‌ی فیلمنامه به‌روزرسانی شد', 'Screenplay draft updated'],
        'screenplay.revision_restored': ['نسخه‌ای از تاریخچه‌ی فیلمنامه بازیابی شد', 'Screenplay revision restored'],
      'discussion.comment_created': ['دیدگاه تازه ثبت شد', 'Comment added'],
      'discussion.comment_updated': ['دیدگاه ویرایش شد', 'Comment edited'],
      'discussion.comment_deleted': ['دیدگاه حذف شد', 'Comment deleted'],
      'casting.role_created': ['نقش تازه به گروه بازیگران اضافه شد', 'Casting role added'],
      'production.task_created': ['وظیفه‌ی تولید اضافه شد', 'Production task added'],
      'production.task_updated': ['وظیفه‌ی تولید به‌روزرسانی شد', 'Production task updated'],
      'production.task_phase_updated': ['مرحله‌ی گردش‌کار وظیفه تغییر کرد', 'Task workflow phase changed'],
      'production.scene_created': ['صحنه به برنامه‌ی تولید اضافه شد', 'Scene breakdown added'],
      'production.scene_updated': ['جزئیات صحنه به‌روزرسانی شد', 'Scene breakdown updated'],
      'production.shooting_day_created': ['روز فیلم‌برداری برنامه‌ریزی شد', 'Shooting day scheduled'],
      'production.call_sheet_updated': ['برگه‌ی فراخوان روز تولید به‌روزرسانی شد', 'Call sheet updated'],
      'production.budget_currency_updated': ['ارز بودجه‌ی پروژه تغییر کرد', 'Project budget currency updated'],
      'production.budget_item_created': ['ردیف هزینه به بودجه اضافه شد', 'Budget item added'],
      'production.budget_item_updated': ['ردیف بودجه به‌روزرسانی شد', 'Budget item updated'],
      'production.budget_item_deleted': ['ردیف بودجه حذف شد', 'Budget item deleted'],
    };
    return labels[item.eventType]?.[fa ? 0 : 1] ?? (fa ? 'پروژه به‌روزرسانی شد' : 'Project updated');
  };

  return <section className="collaboration-panel">
    <header className="collaboration-heading"><div><span className="eyebrow">{fa ? 'همکاری پروژه' : 'PROJECT COLLABORATION'}</span><h2>{fa ? 'گفت‌وگو و تاریخچه' : 'Discussion & activity'}</h2><p>{fa ? 'دیدگاه مشترک را به پروژه، نسخه‌ی فیلمنامه یا صحنه پیوند بده.' : 'Attach shared comments to the project, a screenplay draft, or a scene.'}</p></div><div className="collaboration-tabs"><button className={feed === 'discussion' ? 'active' : ''} onClick={() => setFeed('discussion')}><MessageCircle size={14} />{fa ? 'گفت‌وگو' : 'Discussion'}<span>{comments.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></button><button className={feed === 'activity' ? 'active' : ''} onClick={() => { setFeed('activity'); void loadActivity(); }}><Activity size={14} />{fa ? 'رویدادها' : 'Activity'}</button><button className={feed === 'personal' ? 'active' : ''} onClick={() => setFeed('personal')}><LockKeyhole size={14} />{fa ? 'یادداشت شخصی' : 'Personal note'}</button></div></header>
    {feed === 'discussion' ? <>
      <div className="discussion-privacy-note">{fa ? 'دیدگاه‌ها برای همکاران مجاز پروژه قابل مشاهده‌اند. برای یادداشت خصوصی از زبانه‌ی یادداشت شخصی استفاده کن.' : 'Comments are visible to authorized project members. Use Personal note for private writing.'}</div>
      {loading ? <div className="loading-line" /> : <div className="discussion-list">{comments.length ? comments.map((comment) => <article className="discussion-comment" key={comment.id}><div className="discussion-comment-avatar">{comment.authorName.slice(0, 1)}</div><div className="discussion-comment-main"><header><strong>{comment.authorName}</strong><time>{new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comment.createdAt))}{comment.updatedAt !== comment.createdAt && <span>{fa ? ' · ویرایش‌شده' : ' · edited'}</span>}</time><small>{scopeLabel(comment)}</small></header><p dir="auto">{comment.body}</p></div>{comment.canEdit && <div className="discussion-comment-actions"><button className="icon-button" onClick={() => edit(comment)} aria-label={fa ? 'ویرایش دیدگاه' : 'Edit comment'}><Pencil size={13} /></button><button className="icon-button task-delete" onClick={() => void remove(comment)} aria-label={fa ? 'حذف دیدگاه' : 'Delete comment'}><Trash2 size={13} /></button></div>}</article>) : !loading && <div className="discussion-empty"><MessageCircle size={21} /><strong>{fa ? 'گفت‌وگو هنوز آغاز نشده' : 'Start the conversation'}</strong><span>{fa ? 'یادداشت‌ها و پرسش‌های گروه را به پروژه پیوند بده.' : 'Share questions and notes with the project team.'}</span></div>}</div>}
      {canComment ? <form className="discussion-compose" onSubmit={(event) => void submit(event)}>
        <div className="discussion-compose-controls"><label>{fa ? 'پیوند دیدگاه به' : 'Attach comment to'}<select value={scopeType} disabled={Boolean(editingId)} onChange={(event) => setScopeType(event.target.value as ProjectCommentScope)}><option value="project">{fa ? 'پروژه' : 'Project'}</option><option value="screenplay">{fa ? 'نسخه‌ی فیلمنامه' : 'Screenplay draft'}</option><option value="scene">{fa ? 'صحنه' : 'Scene'}</option></select></label>{scopeType !== 'project' && <label>{scopeType === 'scene' ? (fa ? 'صحنه' : 'Scene') : (fa ? 'نسخه' : 'Draft')}<select value={scopeId} disabled={Boolean(editingId) || !scopeOptions.length} onChange={(event) => setScopeId(event.target.value)}>{scopeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}</div>
        <textarea dir="auto" rows={3} maxLength={8000} value={body} onChange={(event) => setBody(event.target.value)} placeholder={fa ? 'پرسش، بازخورد یا یادداشت گروه را بنویس…' : 'Write a question, note, or production feedback…'} aria-label={fa ? 'متن دیدگاه' : 'Comment text'} />
        <div className="discussion-compose-footer">{editingId && <button type="button" className="text-link" onClick={clearEditor}><X size={13} />{fa ? 'انصراف از ویرایش' : 'Cancel edit'}</button>}<small>{body.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} / 8000</small><button className="button button-primary button-small" type="submit" disabled={saving || !body.trim() || (scopeType !== 'project' && !scopeId)}>{saving ? '…' : <><Send size={13} />{editingId ? (fa ? 'ذخیره‌ی ویرایش' : 'Save edit') : (fa ? 'ثبت دیدگاه' : 'Post comment')}</>}</button></div>
      </form> : <div className="discussion-read-only">{fa ? 'دسترسی شما فقط خواندن است؛ برای ثبت دیدگاه از تهیه‌کننده یا مدیر پروژه بخواهید نقش مناسب بدهد.' : 'Your project access is read-only. Ask a producer or project admin for a contributor role to post comments.'}</div>}
    </> : feed === 'activity' ? <div className="activity-feed">{loading ? <div className="loading-line" /> : activity.length ? activity.map((item) => <article key={item.id} className="activity-item"><span className="activity-item-mark"><Activity size={13} /></span><div><strong>{item.actorName}</strong><p>{eventLabel(item)}</p><time>{new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</time></div></article>) : <div className="discussion-empty"><Activity size={21} /><strong>{fa ? 'هنوز رویدادی ثبت نشده' : 'No activity yet'}</strong><span>{fa ? 'با انجام کارهای پروژه، تاریخچه اینجا شکل می‌گیرد.' : 'Project changes will appear here as the work progresses.'}</span></div>}</div> : <div className="personal-note-editor"><div className="discussion-privacy-note"><LockKeyhole size={14} />{fa ? 'فقط خودت این یادداشت را می‌بینی. محتوای آن در گفت‌وگو و تاریخچه‌ی پروژه نمایش داده نمی‌شود.' : 'Only you can see this note. Its contents never appear in shared comments or project activity.'}</div><textarea dir="auto" rows={8} maxLength={8000} value={personalNote} onChange={(event) => setPersonalNote(event.target.value)} placeholder={fa ? 'برداشت‌ها، پرسش‌ها یا یادآوری‌های خصوصی خودت را بنویس…' : 'Keep private thoughts, questions, or reminders here…'} aria-label={fa ? 'یادداشت خصوصی پروژه' : 'Private project note'} /><div className="discussion-compose-footer"><small>{personalNote.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} / 8000{savedPersonalNote !== personalNote ? (fa ? ' · ذخیره‌نشده' : ' · unsaved') : ''}</small><button className="button button-primary button-small" onClick={() => void savePrivateNote()} disabled={savingPersonalNote || savedPersonalNote === personalNote}>{savingPersonalNote ? '…' : <><Save size={13} />{fa ? 'ذخیره‌ی خصوصی' : 'Save privately'}</>}</button></div></div>}
  </section>;
}
