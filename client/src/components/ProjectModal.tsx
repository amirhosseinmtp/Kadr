import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { ProjectFormat } from '../../../shared/types';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';

interface Props { language: Language; onClose: () => void; onCreate: (project: { title: string; format: ProjectFormat; logline: string; genre: string; languageCode: string }) => Promise<void>; }

export function ProjectModal({ language, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<ProjectFormat>('feature');
  const [logline, setLogline] = useState('');
  const [genre, setGenre] = useState('');
  const [languageCode, setLanguageCode] = useState< 'fa' | 'en' | 'other' >('fa');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    setSaving(true);
    try { await onCreate({ title: title.trim(), format, logline: logline.trim(), genre: genre.trim(), languageCode }); onClose(); }
    catch { /* The parent displays the API error and leaves the form open for correction. */ }
    finally { setSaving(false); }
  };
  const formats: ProjectFormat[] = ['feature', 'short', 'series', 'documentary', 'commercial'];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
      <div className="modal-heading"><div><span className="eyebrow">{language === 'fa' ? 'شروع یک روایت تازه' : 'A new story begins'}</span><h2 id="new-project-title">{t(language, 'newProject')}</h2></div><button className="icon-button" onClick={onClose} aria-label={t(language, 'cancel')}><X size={19} /></button></div>
      <form onSubmit={submit} className="form-stack">
        <label>{t(language, 'projectName')}<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={language === 'fa' ? 'مثلاً: آخرین قاب' : 'e.g. The Last Frame'} required /></label>
        <label>{t(language, 'format')}<select value={format} onChange={(e) => setFormat(e.target.value as ProjectFormat)}>{formats.map((item) => <option key={item} value={item}>{t(language, item)}</option>)}</select></label>
        <div className="modal-field-grid"><label>{language === 'fa' ? 'ژانر' : 'Genre'}<input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder={language === 'fa' ? 'درام، مستند...' : 'Drama, documentary...'} /></label><label>{language === 'fa' ? 'زبان پروژه' : 'Project language'}<select value={languageCode} onChange={(event) => setLanguageCode(event.target.value as 'fa' | 'en' | 'other')}><option value="fa">{language === 'fa' ? 'فارسی' : 'Persian'}</option><option value="en">{language === 'fa' ? 'انگلیسی' : 'English'}</option><option value="other">{language === 'fa' ? 'دیگر' : 'Other'}</option></select></label></div>
        <label>{t(language, 'logline')}<textarea rows={3} value={logline} onChange={(e) => setLogline(e.target.value)} placeholder={language === 'fa' ? 'داستانت را در یک جمله تعریف کن...' : 'Describe your story in one sentence...'} /></label>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>{t(language, 'cancel')}</button><button className="button button-primary" type="submit" disabled={!title.trim() || saving}>{saving ? '…' : t(language, 'create')}</button></div>
      </form>
    </section>
  </div>;
}
