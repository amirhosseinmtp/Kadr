import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Clapperboard, FileText, Plus, Save, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { AiAssistMode, AiSuggestion, ScreenplayDraft } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';

type ElementType = 'scene-heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';
interface ScriptBlock { id: string; type: ElementType; content: string }
const elementTypes: ElementType[] = ['scene-heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];
const scenePrefix = /^(?:INT\s*\.?|EXT\s*\.?|I\s*\/\s*E\s*\.?|داخلی|خارجی)(?:\s|\/|$)/iu;
const transitionPrefix = /^(?:FADE IN|FADE OUT|FADE TO|CUT TO|DISSOLVE TO|SMASH CUT|پایان)/iu;

function identify(line: string, next = ''): ElementType {
  if (scenePrefix.test(line)) return 'scene-heading';
  if (transitionPrefix.test(line)) return 'transition';
  if (/^\(.+\)$/.test(line)) return 'parenthetical';
  const uppercase = line.length < 38 && /[A-Z]/.test(line) && line === line.toLocaleUpperCase('en-US') && /^[\p{Lu}\d\s.'’_-]+$/u.test(line);
  if (uppercase && next.length > 0 && next !== next.toLocaleUpperCase('en-US')) return 'character';
  return 'action';
}

function parseBlocks(source: string): ScriptBlock[] {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((content, index) => ({ id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, type: identify(content, lines[index + 1] ?? ''), content }));
}

function serialize(blocks: ScriptBlock[]) { return blocks.map((block) => block.content.trim()).filter(Boolean).join('\n\n'); }

const modeLabels: Record<AiAssistMode, { fa: string; en: string }> = {
  'screenplay-analysis': { fa: 'تحلیل فیلمنامه', en: 'Screenplay analysis' },
  'character-analysis': { fa: 'تحلیل شخصیت', en: 'Character analysis' },
  'scene-breakdown': { fa: 'شکست اولیه‌ی صحنه', en: 'Preliminary scene breakdown' },
  'production-plan': { fa: 'پیشنهاد برنامه‌ی تولید', en: 'Production planning' },
};

export function ScreenplayPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const [drafts, setDrafts] = useState<ScreenplayDraft[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<ScriptBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMode, setAiMode] = useState<AiAssistMode>('screenplay-analysis');
  const [question, setQuestion] = useState('');
  const fa = language === 'fa';
  const body = useMemo(() => serialize(blocks), [blocks]);

  const selectDraft = (draft: ScreenplayDraft) => { setSelectedId(draft.id); setTitle(draft.title); setBlocks(parseBlocks(draft.body)); };
  const load = async () => {
    setLoading(true);
    try {
      const [draftRows, suggestionRows] = await Promise.all([api.drafts(projectId), api.aiSuggestions(projectId)]);
      setDrafts(draftRows); setSuggestions(suggestionRows);
      const selected = draftRows.find((draft) => draft.id === selectedId) ?? draftRows[0];
      if (selected) selectDraft(selected); else { setSelectedId(''); setTitle(''); setBlocks([]); }
    } catch { onToast(t(language, 'error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const create = async () => {
    setBusy(true);
    try {
      const draft = await api.createDraft(projectId, `${fa ? 'نسخه' : 'Draft'} ${drafts.length + 1}`);
      setDrafts((current) => [draft, ...current]); selectDraft(draft);
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const updated = await api.updateDraft(selectedId, title, body);
      setDrafts((current) => current.map((item) => item.id === updated.id ? updated : item)); onToast(t(language, 'saved'));
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const addBlock = (type: ElementType = 'action') => setBlocks((current) => [...current, { id: `${Date.now()}-${Math.random()}`, type, content: '' }]);
  const updateBlock = (id: string, update: Partial<ScriptBlock>) => setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...update } : block));
  const moveBlock = (id: string, amount: -1 | 1) => setBlocks((current) => { const index = current.findIndex((block) => block.id === id); const next = index + amount; if (index < 0 || next < 0 || next >= current.length) return current; const reordered = [...current]; [reordered[index], reordered[next]] = [reordered[next], reordered[index]]; return reordered; });
  const importScenes = async () => {
    if (!selectedId) return;
    setBusy(true);
    try { const result = await api.importSceneHeadings(projectId, selectedId, body); onToast(fa ? `${result.imported.toLocaleString('fa-IR')} سرصحنه وارد شد؛ اطلاعات تولید قبلی حفظ شد.` : `${result.imported} headings imported; existing production details were preserved.`); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setBusy(false); }
  };
  const askAi = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId && !question.trim()) return;
    setAiBusy(true);
    try {
      const suggestion = await api.requestAiAssist(projectId, { mode: aiMode, ...(selectedId ? { draftId: selectedId } : {}), sourceText: body, question });
      setSuggestions((current) => [suggestion, ...current]); setQuestion('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setAiBusy(false); }
  };
  const reviewSuggestion = async (suggestion: AiSuggestion, status: 'accepted' | 'dismissed') => {
    try { const updated = await api.reviewAiSuggestion(suggestion.id, status); setSuggestions((current) => current.map((item) => item.id === updated.id ? updated : item)); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };

  return <div className="module-layout screenplay-layout">
    <aside className="module-rail"><div className="module-rail-heading"><div><span className="eyebrow">{fa ? 'اتاق نویسندگان' : 'WRITERS ROOM'}</span><h3>{t(language, 'screenplay')}</h3></div><button className="square-button" onClick={() => void create()} disabled={busy} aria-label={t(language, 'addDraft')}><Plus size={18} /></button></div>
      <div className="draft-list">{drafts.map((draft, index) => <button key={draft.id} className={`draft-item ${draft.id === selectedId ? 'selected' : ''}`} onClick={() => selectDraft(draft)}><FileText size={17} /><span><strong>{draft.title}</strong><small>{fa ? `پیش‌نویس ${drafts.length - index}` : `Draft ${drafts.length - index}`}</small></span></button>)}</div>
    </aside>
    <section className="script-editor">
      {loading ? <div className="loading-line" /> : selectedId ? <>
        <div className="editor-toolbar"><input className="draft-title-input" value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t(language, 'draftTitle')} /><div className="editor-toolbar-actions"><button className="button button-quiet button-small" onClick={() => void importScenes()} disabled={busy}><Clapperboard size={14} />{fa ? 'ورود سرصحنه‌ها به شکست صحنه' : 'Import headings to breakdown'}</button><button className="button button-primary button-small" onClick={() => void save()} disabled={busy}><Save size={15} />{t(language, 'draftSaved')}</button></div></div>
        <div className="structured-editor"><div className="structured-editor-heading"><div><span className="eyebrow">{fa ? 'صفحه‌ی نویسندگی' : 'WRITING PAGE'}</span><h3>{fa ? 'فیلمنامه‌ی ساختاریافته' : 'Structured screenplay'}</h3></div><span>{blocks.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'بلاک' : 'elements'}</span></div>
          {!blocks.length && <div className="script-empty-prompt"><p>{fa ? 'فیلمنامه را با یک سرصحنه یا توضیح صحنه آغاز کن.' : 'Begin with a scene heading or an action block.'}</p></div>}
          <div className="screenplay-blocks">{blocks.map((block, index) => <article key={block.id} className={`screenplay-block block-${block.type}`}><div className="screenplay-block-toolbar"><select aria-label={fa ? 'نوع عنصر فیلمنامه' : 'Screenplay element'} value={block.type} onChange={(event) => updateBlock(block.id, { type: event.target.value as ElementType })}>{elementTypes.map((type) => <option key={type} value={type}>{elementLabel(type, fa)}</option>)}</select><span className="block-actions"><button className="icon-button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label={fa ? 'انتقال به بالا' : 'Move up'}><ArrowUp size={13} /></button><button className="icon-button" onClick={() => moveBlock(block.id, 1)} disabled={index === blocks.length - 1} aria-label={fa ? 'انتقال به پایین' : 'Move down'}><ArrowDown size={13} /></button><button className="icon-button block-remove" onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))} aria-label={fa ? 'حذف بلوک' : 'Remove block'}><Trash2 size={13} /></button></span></div><textarea dir="auto" rows={block.type === 'action' || block.type === 'dialogue' ? 2 : 1} value={block.content} onChange={(event) => updateBlock(block.id, { content: event.target.value })} placeholder={elementPlaceholder(block.type, fa)} aria-label={elementLabel(block.type, fa)} /></article>)}</div>
          <div className="add-element-row"><select id="new-element-type" defaultValue="action"><option value="scene-heading">{elementLabel('scene-heading', fa)}</option><option value="action">{elementLabel('action', fa)}</option><option value="character">{elementLabel('character', fa)}</option><option value="parenthetical">{elementLabel('parenthetical', fa)}</option><option value="dialogue">{elementLabel('dialogue', fa)}</option><option value="transition">{elementLabel('transition', fa)}</option></select><button className="button button-quiet button-small" onClick={() => { const select = document.getElementById('new-element-type') as HTMLSelectElement | null; addBlock((select?.value as ElementType) ?? 'action'); }}><Plus size={14} />{fa ? 'افزودن عنصر' : 'Add element'}</button><span>{fa ? 'هر بلوک را می‌توان به عنصر دیگری تبدیل کرد.' : 'Each block can be changed to another screenplay element.'}</span></div>
        </div>
        <div className="editor-footer">{fa ? `${body.trim() ? body.trim().split(/\s+/).length.toLocaleString('fa-IR') : '۰'} واژه` : `${body.trim() ? body.trim().split(/\s+/).length : 0} words`}<span>{fa ? 'قالب Fountain-compatible · ذخیره‌ی دستی' : 'Fountain-compatible · manual save'}</span></div>
        <section className="ai-assistant-panel"><div className="ai-panel-heading"><div className="ai-mark"><Sparkles size={17} /></div><div><span className="eyebrow">{fa ? 'همکار خلاق، با کنترل نویسنده' : 'A CREATIVE PARTNER, YOUR CALL'}</span><h3>{fa ? 'دستیار فیلمنامه' : 'Screenplay assistant'}</h3></div><span className="ai-context-badge">{fa ? 'فقط با درخواست تو' : 'Runs on request'}</span></div>
          <p className="ai-help-copy">{fa ? 'متن نسخه‌ی جاری فقط هنگام ارسال تحلیل به سرویس پیکربندی‌شده فرستاده می‌شود. پیشنهادها جدا از متن اصلی ذخیره می‌شوند.' : 'The current draft is sent only when you request an analysis. Suggestions stay separate from the source screenplay.'}</p>
          <form className="ai-request-form" onSubmit={(event) => void askAi(event)}><label>{fa ? 'نوع تحلیل' : 'Analysis mode'}<select value={aiMode} onChange={(event) => setAiMode(event.target.value as AiAssistMode)}>{(Object.keys(modeLabels) as AiAssistMode[]).map((mode) => <option key={mode} value={mode}>{modeLabels[mode][language]}</option>)}</select></label><label className="ai-question-field">{fa ? 'پرسش یا تمرکز اختیاری' : 'Optional question or focus'}<input dir="auto" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={fa ? 'مثلاً: انگیزه‌ی شخصیت در صحنه‌ی آخر چیست؟' : 'e.g. Is the protagonist’s goal clear in the final scene?'} /></label><button className="button button-primary button-small" disabled={aiBusy || (!body.trim() && !question.trim())}><Send size={14} />{aiBusy ? (fa ? 'در حال تحلیل…' : 'Analyzing…') : (fa ? 'درخواست تحلیل' : 'Request analysis')}</button></form>
          <div className="ai-suggestions-list">{suggestions.filter((item) => item.projectId === projectId).map((suggestion) => <article className="ai-suggestion-card" key={suggestion.id}><div className="ai-suggestion-top"><strong>{modeLabels[suggestion.mode][language]}</strong><span className={`suggestion-status ${suggestion.status}`}>{suggestion.status === 'suggested' ? (fa ? 'پیشنهاد تازه' : 'Suggestion') : suggestion.status === 'accepted' ? (fa ? 'پذیرفته‌شده' : 'Accepted') : (fa ? 'ردشده' : 'Dismissed')}</span></div><p className="suggestion-source-label">{fa ? 'پیشنهاد تولیدشده · برای بررسی' : 'Generated suggestion · review before use'}</p><pre>{suggestion.result}</pre>{suggestion.status === 'suggested' && <div className="suggestion-review-actions"><button className="button button-quiet button-small" onClick={() => void reviewSuggestion(suggestion, 'dismissed')}><X size={13} />{fa ? 'رد پیشنهاد' : 'Dismiss'}</button><button className="button button-primary button-small" onClick={() => void reviewSuggestion(suggestion, 'accepted')}><Check size={13} />{fa ? 'تأیید برای استفاده' : 'Accept for use'}</button><small>{fa ? 'این کار متن فیلمنامه را تغییر نمی‌دهد.' : 'This does not alter the screenplay.'}</small></div>}</article>)}</div>
        </section>
      </> : <div className="empty-module"><div className="empty-icon"><FileText size={22} /></div><h3>{t(language, 'emptyDrafts')}</h3><p>{fa ? 'نسخه‌های مختلف فیلمنامه را کنار هم نگه دار.' : 'Keep each screenplay revision in one place.'}</p><button className="button button-primary" onClick={() => void create()}><Plus size={16} />{t(language, 'addDraft')}</button></div>}
    </section>
  </div>;
}

function elementLabel(type: ElementType, fa: boolean) {
  const labels: Record<ElementType, { fa: string; en: string }> = {
    'scene-heading': { fa: 'سرصحنه', en: 'Scene heading' }, action: { fa: 'توضیحات صحنه', en: 'Action' }, character: { fa: 'نام شخصیت', en: 'Character' }, parenthetical: { fa: 'توضیح بازی', en: 'Parenthetical' }, dialogue: { fa: 'دیالوگ', en: 'Dialogue' }, transition: { fa: 'گذار', en: 'Transition' },
  };
  return labels[type][fa ? 'fa' : 'en'];
}
function elementPlaceholder(type: ElementType, fa: boolean) {
  if (type === 'scene-heading') return fa ? 'داخلی. لوکیشن — روز' : 'INT. LOCATION — DAY';
  if (type === 'character') return fa ? 'نام شخصیت' : 'CHARACTER NAME';
  if (type === 'parenthetical') return fa ? '(آرام، رو به پنجره)' : '(quietly, to the window)';
  if (type === 'dialogue') return fa ? 'متن دیالوگ…' : 'Dialogue…';
  if (type === 'transition') return fa ? 'کات به:' : 'CUT TO:';
  return fa ? 'توضیح تصویری صحنه…' : 'Describe what we see…';
}
