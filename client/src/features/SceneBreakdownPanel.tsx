import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Clapperboard, Clock3, FileText, MapPin, Plus, Save, Trash2 } from 'lucide-react';
import type { ProductionResource, ProductionScene, SceneEnvironment, SceneShootStatus, SceneTimeOfDay, ShootingDay } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';
import { CallSheetDialog } from './CallSheetDialog';

const environmentOptions: SceneEnvironment[] = ['interior', 'exterior', 'mixed', 'unspecified'];
const timeOptions: SceneTimeOfDay[] = ['day', 'night', 'dawn', 'dusk', 'unspecified'];

function splitList(value: string) { return value.split(/[,،\n]/).map((part) => part.trim()).filter(Boolean); }
function dateLabel(value: string, language: Language) { return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function localDateInput() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }

export function SceneBreakdownPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const [scenes, setScenes] = useState<ProductionScene[]>([]);
  const [days, setDays] = useState<ShootingDay[]>([]);
  const [resources, setResources] = useState<ProductionResource[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ProductionScene | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shootDate, setShootDate] = useState(localDateInput);
  const [shootTitle, setShootTitle] = useState('');
  const [callTime, setCallTime] = useState('08:00');
  const [callSheetDay, setCallSheetDay] = useState<ShootingDay | null>(null);
  const fa = language === 'fa';
  const selected = scenes.find((scene) => scene.id === selectedId);

  const load = async () => {
    setLoading(true);
    try {
      const [sceneRows, dayRows, resourceRows] = await Promise.all([api.scenes(projectId), api.shootingDays(projectId), api.resources()]);
      setScenes(sceneRows); setDays(dayRows); setResources(resourceRows);
      setSelectedId((current) => sceneRows.some((scene) => scene.id === current) ? current : sceneRows[0]?.id ?? '');
    } catch { onToast(t(language, 'error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => { setDraft(selected ? { ...selected } : null); }, [selectedId, scenes]);

  const addScene = async () => {
    setBusy(true);
    try {
      const created = await api.createScene(projectId, fa ? 'داخلی. مکان — روز' : 'INT. LOCATION — DAY');
      setScenes((current) => [...current, created].sort((a, b) => a.screenplayOrder - b.screenplayOrder)); setSelectedId(created.id);
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const saveScene = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const updated = await api.updateScene(draft.id, draft);
      setScenes((current) => current.map((scene) => scene.id === updated.id ? updated : scene)); onToast(t(language, 'saved'));
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const createDay = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const day = await api.createShootingDay(projectId, { shootDate, title: shootTitle, callTime: callTime || null, notes: '' });
      setDays((current) => [...current, day].sort((a, b) => a.shootDate.localeCompare(b.shootDate))); setShootTitle('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const assign = async (scene: ProductionScene, dayId: string) => {
    try {
      const updated = await api.assignScene(scene.id, dayId || null);
      setScenes((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDays(await api.shootingDays(projectId));
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const toggleResource = async (resource: ProductionResource, sceneId: string, checked: boolean) => {
    const sceneIds = checked ? [...new Set([...resource.sceneIds, sceneId])] : resource.sceneIds.filter((id) => id !== sceneId);
    try { const updated = await api.updateResource(resource.id, { sceneIds }); setResources((current) => current.map((item) => item.id === updated.id ? updated : item)); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const changeStatus = async (scene: ProductionScene) => {
    const next: SceneShootStatus = scene.shootStatus === 'unplanned' ? 'scheduled' : scene.shootStatus === 'scheduled' ? 'shot' : 'unplanned';
    if (next === 'scheduled' && !scene.shootingDayId) {
      if (!days.length) { onToast(fa ? 'ابتدا یک روز فیلم‌برداری در تقویم اضافه کن.' : 'Add a shooting day before scheduling this scene.'); return; }
      try {
        const updated = await api.assignScene(scene.id, days[0].id);
        setScenes((current) => current.map((item) => item.id === updated.id ? updated : item)); setDays(await api.shootingDays(projectId));
      } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
      return;
    }
    try {
      const updated = await api.setSceneShootStatus(scene.id, next);
      setScenes((current) => current.map((item) => item.id === updated.id ? updated : item)); setDays(await api.shootingDays(projectId));
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const remove = async (scene: ProductionScene) => {
    if (!window.confirm(fa ? 'این صحنه از پرونده‌ی پروژه حذف شود؟' : 'Delete this scene from the project?')) return;
    try { await api.deleteScene(scene.id); setScenes((current) => current.filter((item) => item.id !== scene.id)); }
    catch { onToast(t(language, 'error')); }
  };

  const totalMinutes = useMemo(() => scenes.reduce((sum, scene) => sum + scene.estimatedMinutes, 0), [scenes]);
  const envLabel = (value: SceneEnvironment) => ({ interior: fa ? 'داخلی' : 'Interior', exterior: fa ? 'خارجی' : 'Exterior', mixed: fa ? 'داخلی / خارجی' : 'Interior / exterior', unspecified: fa ? 'مشخص‌نشده' : 'Unspecified' })[value];
  const timeLabel = (value: SceneTimeOfDay) => ({ day: fa ? 'روز' : 'Day', night: fa ? 'شب' : 'Night', dawn: fa ? 'سحر' : 'Dawn', dusk: fa ? 'غروب' : 'Dusk', unspecified: fa ? 'مشخص‌نشده' : 'Unspecified' })[value];
  const statusLabel = (value: SceneShootStatus) => ({ unplanned: fa ? 'برنامه‌ریزی‌نشده' : 'Unplanned', scheduled: fa ? 'برنامه‌ریزی‌شده' : 'Scheduled', shot: fa ? 'فیلم‌برداری‌شده' : 'Shot' })[value];

  return <div className="scenes-workspace">
    <header className="module-header"><div><span className="eyebrow">{fa ? 'از صفحه به برنامه‌ی فیلم‌برداری' : 'FROM PAGE TO SHOOT PLAN'}</span><h2>{fa ? 'شکست و برنامه‌ریزی صحنه' : 'Scene breakdown'}</h2><p>{fa ? 'ترتیب فیلمنامه را نگه دار و برنامه‌ی فیلم‌برداری را جداگانه بچین.' : 'Keep screenplay order intact while planning a separate shooting order.'}</p></div><div className="scene-summary"><span><Clapperboard size={15} />{scenes.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'صحنه' : 'scenes'}</span><span><Clock3 size={15} />{totalMinutes.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'دقیقه' : 'min'}</span></div></header>
    <div className="shoot-days-panel"><div className="shoot-days-heading"><div><span className="eyebrow">{fa ? 'تقویم تولید' : 'PRODUCTION CALENDAR'}</span><strong>{fa ? 'روزهای فیلم‌برداری' : 'Shooting days'}</strong></div><span className="shoot-day-count">{days.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'روز' : 'days'}</span></div>
      <form className="shoot-day-form" onSubmit={(event) => void createDay(event)}><label>{fa ? 'تاریخ' : 'Date'}<input type="date" value={shootDate} onChange={(event) => setShootDate(event.target.value)} required /></label><label>{fa ? 'عنوان روز' : 'Day label'}<input value={shootTitle} onChange={(event) => setShootTitle(event.target.value)} placeholder={fa ? 'مثلاً: روز اول — خانه' : 'e.g. Day 1 — House'} /></label><label>{fa ? 'ساعت فراخوان' : 'Call time'}<input type="time" value={callTime} onChange={(event) => setCallTime(event.target.value)} /></label><button className="button button-quiet" type="submit"><Plus size={15} />{fa ? 'افزودن روز' : 'Add day'}</button></form>
      <div className="shoot-day-strip">{days.length ? days.map((day) => <article key={day.id} className="shoot-day-card"><span className="shoot-day-date"><CalendarDays size={14} />{dateLabel(day.shootDate, language)}</span><strong>{day.title || (fa ? 'روز فیلم‌برداری' : 'Shoot day')}</strong><small>{day.callTime || '—'} · {day.sceneCount.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'صحنه' : 'scenes'} · {day.totalEstimatedMinutes.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'دقیقه' : 'min'}</small><button className="shoot-call-sheet-link" onClick={() => setCallSheetDay(day)}><FileText size={13} />{fa ? 'برگه‌ی فراخوان' : 'Call sheet'}</button><button className="text-link" onClick={async () => { if (!window.confirm(fa ? 'روز فیلم‌برداری حذف شود؟ صحنه‌ها به حالت برنامه‌ریزی‌نشده بازمی‌گردند.' : 'Delete this shooting day? Its scenes will become unplanned.')) return; try { await api.deleteShootingDay(day.id); await load(); } catch { onToast(t(language, 'error')); } }}>{fa ? 'حذف روز' : 'Remove day'}</button></article>) : <p className="shoot-day-empty">{fa ? 'هنوز روزی در تقویم نیست؛ یک تاریخ اضافه کن تا صحنه‌ها را به آن اختصاص دهی.' : 'No shoot days yet. Add a date to start assigning scenes.'}</p>}</div>
    </div>

    <div className="scene-breakdown-layout">
      <aside className="scene-rail"><div className="scene-rail-heading"><div><span className="eyebrow">{fa ? 'ترتیب فیلمنامه' : 'SCREENPLAY ORDER'}</span><strong>{fa ? 'فهرست صحنه‌ها' : 'Scenes'}</strong></div><button className="square-button" disabled={busy} onClick={() => void addScene()} aria-label={fa ? 'افزودن صحنه' : 'Add scene'}><Plus size={17} /></button></div>
        {loading ? <div className="loading-line" /> : scenes.length ? <div className="scene-rail-list">{scenes.map((scene) => <button key={scene.id} onClick={() => setSelectedId(scene.id)} className={`scene-rail-item ${scene.id === selectedId ? 'selected' : ''}`}><span className="scene-number">{scene.screenplayOrder.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span><span className="scene-rail-copy"><strong>{scene.heading}</strong><small>{scene.location || envLabel(scene.environment)} · {statusLabel(scene.shootStatus)}</small></span></button>)}</div> : <div className="scene-empty-state"><Clapperboard size={20} /><p>{fa ? 'برای شروع، یک صحنه اضافه کن یا از اتاق فیلمنامه سرصحنه‌ها را وارد کن.' : 'Add a scene here or import headings from the screenplay workspace.'}</p></div>}
      </aside>
      <section className="scene-editor-panel">{draft ? <>
        <div className="scene-editor-toolbar"><div><span className="eyebrow">{fa ? `صحنه‌ی ${draft.screenplayOrder.toLocaleString('fa-IR')} · ترتیب فیلمنامه` : `Scene ${draft.screenplayOrder} · screenplay order`}</span><h3>{draft.heading}</h3></div><button className="button button-primary button-small" onClick={() => void saveScene()} disabled={busy}><Save size={14} />{fa ? 'ذخیره‌ی شکست' : 'Save breakdown'}</button></div>
        <label className="scene-field full-field">{fa ? 'سرصحنه' : 'Scene heading'}<input value={draft.heading} dir="auto" onChange={(event) => setDraft({ ...draft, heading: event.target.value })} /></label>
        <div className="scene-fields-grid"><label className="scene-field">{fa ? 'فضا' : 'Environment'}<select value={draft.environment} onChange={(event) => setDraft({ ...draft, environment: event.target.value as SceneEnvironment })}>{environmentOptions.map((item) => <option key={item} value={item}>{envLabel(item)}</option>)}</select></label><label className="scene-field">{fa ? 'زمان روز' : 'Time of day'}<select value={draft.timeOfDay} onChange={(event) => setDraft({ ...draft, timeOfDay: event.target.value as SceneTimeOfDay })}>{timeOptions.map((item) => <option key={item} value={item}>{timeLabel(item)}</option>)}</select></label><label className="scene-field">{fa ? 'لوکیشن' : 'Location'}<span className="input-icon"><MapPin size={14} /><input value={draft.location} dir="auto" onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder={fa ? 'لوکیشن پروژه' : 'Production location'} /></span></label><label className="scene-field">{fa ? 'مدت تخمینی (دقیقه)' : 'Estimated minutes'}<input type="number" min="0" max="1440" value={draft.estimatedMinutes} onChange={(event) => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })} /></label></div>
        <div className="scene-fields-grid scene-resource-fields"><label className="scene-field">{fa ? 'شخصیت‌های صحنه' : 'Characters in scene'}<textarea dir="auto" value={draft.characters.join('، ')} onChange={(event) => setDraft({ ...draft, characters: splitList(event.target.value) })} placeholder={fa ? 'با ویرگول جدا کن' : 'Separate items with commas'} rows={2} /></label><div className="scene-field scene-resource-picker"><span>{fa ? 'منابع مشترک این صحنه' : 'Shared resources for this scene'}</span><small>{fa ? 'اقلام را در دفتر منابع بساز؛ یک منبع می‌تواند به چند صحنه وصل شود.' : 'Create items in the shared library; one resource can link to many scenes.'}</small>{resources.length ? <div className="scene-resource-checklist">{resources.map((resource) => <label key={resource.id}><input type="checkbox" checked={resource.sceneIds.includes(draft.id)} onChange={(event) => void toggleResource(resource, draft.id, event.target.checked)} /><span><strong>{resource.name}</strong><small>{resource.kind}</small></span></label>)}</div> : <em>{fa ? 'هنوز منبعی ثبت نشده؛ از بخش لوکیشن و منابع شروع کن.' : 'No shared resources yet. Add some in Locations & resources.'}</em>}{[draft.props, draft.costumes, draft.setDressing].some((items) => items.length > 0) && <details className="scene-legacy-notes"><summary>{fa ? 'یادداشت‌های قدیمی و اختصاصی صحنه' : 'Existing scene-specific resource notes'}</summary><span>{[...draft.props, ...draft.costumes, ...draft.setDressing].join(' · ')}</span></details>}</div></div>
        <div className="scene-fields-grid"><label className="scene-field">{fa ? 'یادداشت تولید' : 'Production notes'}<textarea dir="auto" value={draft.productionNotes} onChange={(event) => setDraft({ ...draft, productionNotes: event.target.value })} rows={3} /></label><label className="scene-field">{fa ? 'تداوم' : 'Continuity'}<textarea dir="auto" value={draft.continuityNotes} onChange={(event) => setDraft({ ...draft, continuityNotes: event.target.value })} rows={3} /></label></div>
        <div className="scene-schedule-row"><div><span className="eyebrow">{fa ? 'ترتیب فیلم‌برداری' : 'SHOOTING ORDER'}</span><strong>{fa ? 'برنامه‌ی روز تولید' : 'Production schedule'}</strong><small>{fa ? 'این ترتیب از ترتیب فیلمنامه مستقل است.' : 'This order is independent from screenplay order.'}</small></div><label className="scene-field schedule-select">{fa ? 'اختصاص به روز' : 'Assign to day'}<select value={draft.shootingDayId ?? ''} onChange={(event) => void assign(draft, event.target.value)}><option value="">{fa ? 'برنامه‌ریزی نشده' : 'Unplanned'}</option>{days.map((day) => <option key={day.id} value={day.id}>{dateLabel(day.shootDate, language)} · {day.title || (fa ? 'روز فیلم‌برداری' : 'Shoot day')}</option>)}</select></label><button className={`scene-status-button ${draft.shootStatus}`} onClick={() => void changeStatus(draft)}><Check size={14} />{statusLabel(draft.shootStatus)}</button><button className="icon-button scene-delete" title={fa ? 'حذف صحنه' : 'Delete scene'} onClick={() => void remove(draft)}><Trash2 size={15} /></button></div>
        {draft.shootingDayId && <div className="shoot-order-note"><CalendarDays size={14} /><span>{fa ? `روز فیلم‌برداری: ${draft.shootingDate ? dateLabel(draft.shootingDate, language) : ''} · ترتیب برداشت ${draft.shootingOrder?.toLocaleString('fa-IR') ?? '—'}` : `Shoot day: ${draft.shootingDate ? dateLabel(draft.shootingDate, language) : ''} · shoot order ${draft.shootingOrder ?? '—'}`}</span></div>}
      </> : <div className="scene-empty-state scene-empty-main"><Clapperboard size={24} /><h3>{fa ? 'شکست صحنه از اینجا شروع می‌شود' : 'Start a scene breakdown'}</h3><p>{fa ? 'صحنه‌ها، منابع و برنامه‌ی فیلم‌برداری را کنار هم نگه دار.' : 'Keep scenes, resources, and shooting assignments connected.'}</p><button className="button button-primary" onClick={() => void addScene()}><Plus size={15} />{fa ? 'افزودن صحنه' : 'Add a scene'}</button></div>}</section>
    </div>
    {callSheetDay && <CallSheetDialog day={callSheetDay} language={language} onClose={() => setCallSheetDay(null)} onToast={onToast} />}
  </div>;
}
