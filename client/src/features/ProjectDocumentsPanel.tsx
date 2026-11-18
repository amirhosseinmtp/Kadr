import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileAudio, FileImage, FileText, Film, Paperclip, Trash2, Upload } from 'lucide-react';
import type { ProjectDocument, ProjectDocumentCategory, ProductionScene, WorkspaceRole } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';

const documentCategories: ProjectDocumentCategory[] = ['script', 'reference', 'contract', 'image', 'video', 'audio', 'other'];
const editableRoles: WorkspaceRole[] = ['owner', 'admin', 'producer', 'director', 'writer', 'casting_director', 'production'];
const maxFileSize = 25 * 1024 * 1024;

export function ProjectDocumentsPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [scenes, setScenes] = useState<ProductionScene[]>([]);
  const [role, setRole] = useState<WorkspaceRole>('viewer');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ProjectDocumentCategory>('reference');
  const [sceneId, setSceneId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const canManage = editableRoles.includes(role);

  const load = async () => {
    setLoading(true);
    try {
      const [documentRows, sceneRows, permissions] = await Promise.all([
        api.projectDocuments(projectId), api.scenes(projectId), api.projectPermissions(projectId),
      ]);
      setDocuments(documentRows); setScenes(sceneRows); setRole(permissions.role); setLoadError(false);
    } catch {
      setLoadError(true); onToast(fa ? 'بارگذاری پیوست‌های پروژه انجام نشد.' : 'Could not load project attachments.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const categoryLabel = (value: ProjectDocumentCategory) => ({
    script: fa ? 'فیلمنامه' : 'Screenplay', reference: fa ? 'مرجع و پژوهش' : 'Reference',
    contract: fa ? 'قرارداد' : 'Contract', image: fa ? 'تصویر' : 'Image', video: fa ? 'ویدئو' : 'Video',
    audio: fa ? 'صوت' : 'Audio', other: fa ? 'سایر' : 'Other',
  })[value];
  const fileIcon = (document: ProjectDocument) => document.category === 'image' ? <FileImage size={17} />
    : document.category === 'video' ? <Film size={17} />
      : document.category === 'audio' ? <FileAudio size={17} /> : <FileText size={17} />;
  const sizeLabel = (bytes: number) => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(fa ? 'fa-IR' : 'en-US')} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: 1 })} MB`;
  const formattedDate = (value: string) => new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium' }).format(new Date(value));

  const selectFile = (next: File | null) => {
    setFile(next);
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ''));
  };
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !canManage) return;
    if (file.size > maxFileSize) { onToast(fa ? 'حجم هر فایل باید حداکثر ۲۵ مگابایت باشد.' : 'Each file must be 25 MB or smaller.'); return; }
    setSaving(true);
    try {
      const created = await api.uploadProjectDocument(projectId, file, title.trim() || file.name.replace(/\.[^.]+$/, ''), category, sceneId || null);
      setDocuments((current) => [created, ...current]); setFile(null); setTitle(''); setSceneId('');
      const input = document.getElementById(`project-file-${projectId}`) as HTMLInputElement | null;
      if (input) input.value = '';
      onToast(fa ? 'فایل به پرونده‌ی پروژه افزوده شد.' : 'File added to the project.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'بارگذاری فایل انجام نشد.' : 'Upload failed.')); }
    finally { setSaving(false); }
  };
  const remove = async (document: ProjectDocument) => {
    if (!window.confirm(fa ? `پیوست «${document.title}» برای همه‌ی اعضای پروژه حذف شود؟` : `Delete “${document.title}” for everyone on this project?`)) return;
    setDeletingId(document.id);
    try {
      await api.deleteProjectDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      onToast(fa ? 'پیوست حذف شد.' : 'Attachment deleted.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'حذف پیوست انجام نشد.' : 'Could not delete the attachment.')); }
    finally { setDeletingId(''); }
  };

  return <section className="project-documents-panel" aria-labelledby="project-documents-title">
    <header className="project-documents-heading">
      <div><span className="eyebrow">{fa ? 'پرونده‌ی امن پروژه' : 'PRIVATE PROJECT FILES'}</span><h3 id="project-documents-title">{fa ? 'پیوست‌ها و اسناد' : 'Attachments & documents'}</h3><p>{fa ? 'فایل‌های پروژه و مرجع‌های صحنه را در یک جا نگه دار.' : 'Keep project files and scene references together.'}</p></div>
      <span className="project-documents-count"><Paperclip size={14} />{documents.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span>
    </header>
    {canManage && <form className="project-document-upload" onSubmit={(event) => void upload(event)}>
      <label className="project-document-file-field">{fa ? 'فایل' : 'File'}<input id={`project-file-${projectId}`} type="file" accept=".pdf,.txt,.fountain,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.mp3,.wav,.m4a" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} required /><small>{file ? `${file.name} · ${sizeLabel(file.size)}` : (fa ? 'PDF، فیلمنامه، تصویر، ویدئو یا صوت؛ حداکثر ۲۵ مگابایت' : 'PDF, screenplay, image, video or audio; up to 25 MB')}</small></label>
      <label>{fa ? 'عنوان نمایشی' : 'Display title'}<input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={fa ? 'مثلاً نسخه‌ی فیلمنامه' : 'e.g. Screenplay draft'} /></label>
      <div className="project-document-upload-row"><label>{fa ? 'دسته‌بندی' : 'Category'}<select value={category} onChange={(event) => setCategory(event.target.value as ProjectDocumentCategory)}>{documentCategories.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label><label>{fa ? 'پیوند به صحنه' : 'Link to scene'}<select value={sceneId} onChange={(event) => setSceneId(event.target.value)}><option value="">{fa ? 'بدون صحنه‌ی مرتبط' : 'No linked scene'}</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.screenplayOrder.toLocaleString(fa ? 'fa-IR' : 'en-US')} · {scene.heading}</option>)}</select></label><button className="button button-primary" type="submit" disabled={saving || !file}>{saving ? '…' : <><Upload size={14} />{fa ? 'بارگذاری فایل' : 'Upload file'}</>}</button></div>
    </form>}
    {!canManage && <p className="project-document-readonly">{fa ? 'دسترسی شما فقط برای مشاهده و دریافت فایل‌های این پروژه است.' : 'Your project role allows you to view and download files.'}</p>}
    {loading ? <div className="loading-line" /> : loadError ? <div className="project-document-empty"><span>{fa ? 'بارگذاری پیوست‌ها ناموفق بود.' : 'Attachments could not be loaded.'}</span><button className="text-link" onClick={() => void load()}>{fa ? 'تلاش دوباره' : 'Try again'}</button></div> : documents.length ? <div className="project-document-list">{documents.map((document) => <article className="project-document-card" key={document.id}>
      <span className="project-document-icon">{fileIcon(document)}</span><div className="project-document-copy"><strong>{document.title}</strong><span>{document.originalName}</span><small>{categoryLabel(document.category)} · {sizeLabel(document.sizeBytes)} · {document.uploadedByName || (fa ? 'عضو پروژه' : 'Project member')} · {formattedDate(document.createdAt)}</small>{document.sceneHeading && <small className="project-document-scene">{fa ? 'صحنه:' : 'Scene:'} {document.sceneHeading}</small>}</div>
      <a className="icon-button project-document-download" href={document.downloadUrl} download={document.originalName} aria-label={fa ? `دریافت ${document.title}` : `Download ${document.title}`} title={fa ? 'دریافت فایل' : 'Download file'}><Download size={15} /></a>
      {canManage && <button className="icon-button task-delete" onClick={() => void remove(document)} disabled={deletingId === document.id} aria-label={fa ? `حذف ${document.title}` : `Delete ${document.title}`} title={fa ? 'حذف فایل' : 'Delete file'}>{deletingId === document.id ? '…' : <Trash2 size={14} />}</button>}
    </article>)}</div> : <div className="project-document-empty"><Paperclip size={19} /><strong>{fa ? 'هنوز فایلی در این پرونده نیست' : 'No project files yet'}</strong><span>{fa ? 'فیلمنامه‌ها، قراردادها و مرجع‌های تولید را اینجا اضافه کن.' : 'Add screenplays, contracts and production references here.'}</span></div>}
    <p className="project-document-privacy">{fa ? 'فایل‌ها عمومی نیستند؛ فقط اعضای دارای دسترسی به پروژه می‌توانند آن‌ها را ببینند و دریافت کنند.' : 'Files are private and available only to members who can access this project.'}</p>
  </section>;
}
