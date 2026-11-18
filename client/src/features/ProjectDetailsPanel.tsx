import { useEffect, useState, type FormEvent } from 'react';
import { Film, Save } from 'lucide-react';
import type { Project } from '../../../shared/types';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';

type EditableProject = Pick<Project, 'synopsis' | 'genre' | 'durationMinutes' | 'languageCode' | 'director' | 'writer' | 'producer' | 'targetDate'>;

export function ProjectDetailsPanel({ project, language, onSave }: { project: Project; language: Language; onSave: (input: Partial<EditableProject>) => Promise<void> }) {
  const fa = language === 'fa';
  const [form, setForm] = useState<EditableProject>({ synopsis: project.synopsis, genre: project.genre, durationMinutes: project.durationMinutes, languageCode: project.languageCode, director: project.director, writer: project.writer, producer: project.producer, targetDate: project.targetDate });
  const [duration, setDuration] = useState(project.durationMinutes?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ synopsis: project.synopsis, genre: project.genre, durationMinutes: project.durationMinutes, languageCode: project.languageCode, director: project.director, writer: project.writer, producer: project.producer, targetDate: project.targetDate }); setDuration(project.durationMinutes?.toString() ?? ''); }, [project.id, project.updatedAt]);
  const field = <K extends keyof EditableProject>(key: K, value: EditableProject[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await onSave({ ...form, durationMinutes: duration ? Number(duration) : null, targetDate: form.targetDate || null }); }
    finally { setSaving(false); }
  };
  return <article className="project-details-card"><div className="section-heading compact"><div><span className="eyebrow">{fa ? 'اطلاعات تولید و خلاقه' : 'CREATIVE & PRODUCTION DETAILS'}</span><h2>{t(language, 'projectDetails')}</h2></div><Film size={18} className="sparkle-icon" /></div><form className="project-details-form" onSubmit={(event) => void submit(event)}>
    <label className="details-wide">{fa ? 'خلاصه‌ی کامل' : 'Synopsis'}<textarea rows={3} value={form.synopsis} onChange={(event) => field('synopsis', event.target.value)} placeholder={fa ? 'روایت، جهان داستان و چشم‌انداز فیلم...' : 'Story, world, and creative direction...'} /></label>
    <label>{fa ? 'ژانر' : 'Genre'}<input value={form.genre} onChange={(event) => field('genre', event.target.value)} placeholder={fa ? 'درام، معمایی...' : 'Drama, mystery...'} /></label>
    <label>{fa ? 'مدت (دقیقه)' : 'Runtime (minutes)'}<input type="number" min="1" max="100000" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
    <label>{fa ? 'زبان پروژه' : 'Project language'}<select value={form.languageCode} onChange={(event) => field('languageCode', event.target.value)}><option value="fa">{fa ? 'فارسی' : 'Persian'}</option><option value="en">{fa ? 'انگلیسی' : 'English'}</option><option value="other">{fa ? 'دیگر' : 'Other'}</option></select></label>
    <label>{fa ? 'کارگردان' : 'Director'}<input value={form.director} onChange={(event) => field('director', event.target.value)} /></label>
    <label>{fa ? 'نویسنده' : 'Writer'}<input value={form.writer} onChange={(event) => field('writer', event.target.value)} /></label>
    <label>{fa ? 'تهیه‌کننده' : 'Producer'}<input value={form.producer} onChange={(event) => field('producer', event.target.value)} /></label>
    <label>{fa ? 'تاریخ هدف' : 'Target date'}<input type="date" value={form.targetDate ?? ''} onChange={(event) => field('targetDate', event.target.value || null)} /></label>
    <div className="details-actions"><span>{fa ? 'اطلاعات این پروژه در پایگاه داده‌ی محلی ذخیره می‌شود.' : 'Project details are saved to the local database.'}</span><button className="button button-primary button-small" type="submit" disabled={saving}>{saving ? '…' : <><Save size={14} />{t(language, 'save')}</>}</button></div>
  </form></article>;
}
