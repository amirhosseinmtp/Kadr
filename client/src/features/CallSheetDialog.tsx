import { useEffect, useState } from 'react';
import { CalendarDays, CarFront, Clock3, FileText, MapPin, Printer, Save, ShieldAlert, Utensils, X } from 'lucide-react';
import type { AvailabilityStatus, CallSheet, CallSheetInput, ShootingDay } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';

function toInput(sheet: CallSheet): CallSheetInput {
  return {
    unitCallTime: sheet.unitCallTime,
    mealTime: sheet.mealTime,
    meetingPoint: sheet.meetingPoint,
    transportNotes: sheet.transportNotes,
    safetyNotes: sheet.safetyNotes,
    generalNotes: sheet.generalNotes,
    castCalls: sheet.castCalls.map(({ assignmentId, callTime, availability, notes }) => ({ assignmentId, callTime, availability, notes })),
    crewCalls: sheet.crewCalls.map(({ memberId, callTime, availability, notes }) => ({ memberId, callTime, availability, notes })),
  };
}

function availabilityLabel(status: AvailabilityStatus, fa: boolean) {
  return ({ unknown: fa ? 'نامشخص' : 'Unknown', available: fa ? 'آزاد' : 'Available', hold: fa ? 'رزرو موقت' : 'On hold', unavailable: fa ? 'در دسترس نیست' : 'Unavailable' })[status];
}

function AvailabilityEditor({ value, onChange, fa, disabled }: { value: AvailabilityStatus; onChange: (value: AvailabilityStatus) => void; fa: boolean; disabled: boolean }) {
  return <label className="call-availability-field"><span>{fa ? 'وضعیت حضور' : 'Availability'}</span><span className={`availability-print availability-${value}`}>{availabilityLabel(value, fa)}</span><select value={value} onChange={(event) => onChange(event.target.value as AvailabilityStatus)} disabled={disabled}>
    {(['unknown', 'available', 'hold', 'unavailable'] as const).map((status) => <option value={status} key={status}>{availabilityLabel(status, fa)}</option>)}
  </select></label>;
}

export function CallSheetDialog({ day, language, onClose, onToast }: { day: ShootingDay; language: Language; onClose: () => void; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [sheet, setSheet] = useState<CallSheet | null>(null);
  const [form, setForm] = useState<CallSheetInput | null>(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const dirty = Boolean(form && JSON.stringify(form) !== baseline);

  useEffect(() => {
    let active = true;
    void Promise.all([api.callSheet(day.id), api.projectPermissions(day.projectId)]).then(([value, permissions]) => {
      if (!active) return;
      const next = toInput(value);
      setSheet(value); setForm(next); setBaseline(JSON.stringify(next)); setCanEdit(['owner', 'admin', 'producer', 'director', 'production'].includes(permissions.role));
    }).catch((cause) => onToast(cause instanceof Error ? cause.message : (fa ? 'برگه‌ی فراخوان بارگذاری نشد.' : 'Could not load the call sheet.'))).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const close = () => {
    if (dirty && !window.confirm(fa ? 'تغییرهای ذخیره‌نشده دور ریخته شوند؟' : 'Discard unsaved call sheet changes?')) return;
    onClose();
  };

  const save = async () => {
    if (!form || !canEdit) return;
    setSaving(true);
    try {
      const saved = await api.saveCallSheet(day.id, form);
      const next = toInput(saved);
      setSheet(saved); setForm(next); setBaseline(JSON.stringify(next));
      onToast(fa ? 'برگه‌ی فراخوان ذخیره شد.' : 'Call sheet saved.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'ذخیره‌ی برگه‌ی فراخوان انجام نشد.' : 'Could not save the call sheet.')); }
    finally { setSaving(false); }
  };

  const updateCast = <K extends keyof CallSheetInput['castCalls'][number],>(assignmentId: string, key: K, value: CallSheetInput['castCalls'][number][K]) => {
    setForm((current) => current ? { ...current, castCalls: current.castCalls.map((call) => call.assignmentId === assignmentId ? { ...call, [key]: value } : call) } : current);
  };
  const updateCrew = <K extends keyof CallSheetInput['crewCalls'][number],>(memberId: string, key: K, value: CallSheetInput['crewCalls'][number][K]) => {
    setForm((current) => current ? { ...current, crewCalls: current.crewCalls.map((call) => call.memberId === memberId ? { ...call, [key]: value } : call) } : current);
  };
  const dateText = sheet ? new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${sheet.shootDate}T12:00:00`)) : '';

  return <div className="call-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="call-sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="call-sheet-title" dir={fa ? 'rtl' : 'ltr'}>
      <header className="call-sheet-toolbar"><div className="call-sheet-brand"><span><FileText size={17} /></span><div><span className="eyebrow">{fa ? 'برنامه‌ی روز فیلم‌برداری' : 'DAILY PRODUCTION PLAN'}</span><strong>{fa ? 'برگه‌ی فراخوان' : 'Call sheet'}</strong></div></div><div className="call-sheet-actions"><button className="button button-quiet button-small" onClick={() => window.print()} disabled={!sheet}><Printer size={14} />{fa ? 'چاپ / PDF' : 'Print / PDF'}</button><button className="icon-button call-sheet-close" onClick={close} aria-label={fa ? 'بستن' : 'Close'}><X size={17} /></button></div></header>
      {loading ? <div className="call-sheet-loading"><span className="loading-line" /></div> : sheet && form ? <div className="call-sheet-scroll">
        <div className="call-sheet-printable">
          <div className="call-sheet-title-row"><div><span className="eyebrow">{sheet.projectTitle}</span><h1 id="call-sheet-title">{sheet.dayTitle || (fa ? 'روز فیلم‌برداری' : 'Shooting day')}</h1><p><CalendarDays size={14} />{dateText}</p></div><div className="unit-call-badge"><span>{fa ? 'فراخوان گروه' : 'UNIT CALL'}</span><strong dir="ltr">{form.unitCallTime || '—'}</strong></div></div>
          <div className="call-sheet-facts"><label><span><Clock3 size={13} />{fa ? 'فراخوان واحد' : 'Unit call'}</span><input type="time" value={form.unitCallTime} onChange={(event) => setForm({ ...form, unitCallTime: event.target.value })} required disabled={!canEdit} /></label><label><span><Utensils size={13} />{fa ? 'استراحت غذا' : 'Meal break'}</span><input type="time" value={form.mealTime} onChange={(event) => setForm({ ...form, mealTime: event.target.value })} disabled={!canEdit} /></label><label className="call-sheet-meeting"><span><MapPin size={13} />{fa ? 'نقطه‌ی تجمع' : 'Meeting point'}</span><input value={form.meetingPoint} maxLength={300} onChange={(event) => setForm({ ...form, meetingPoint: event.target.value })} placeholder={fa ? 'نشانی یا نشانه‌ی محل تجمع' : 'Address or meeting landmark'} dir="auto" readOnly={!canEdit} /></label></div>

          <section className="call-sheet-section"><header><div><span className="eyebrow">{fa ? 'ترتیب برداشت' : 'SHOOTING ORDER'}</span><h2>{fa ? 'برنامه‌ی صحنه‌ها' : 'Scene schedule'}</h2></div><span>{sheet.scenes.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'صحنه' : 'scenes'} · {sheet.scenes.reduce((sum, scene) => sum + scene.estimatedMinutes, 0).toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'دقیقه' : 'min'}</span></header>
            {sheet.scenes.length ? <div className="call-sheet-scene-table"><div className="call-sheet-table-head"><span>{fa ? 'برداشت' : 'Shoot'}</span><span>{fa ? 'صحنه / ترتیب فیلمنامه' : 'Scene / screenplay order'}</span><span>{fa ? 'مکان و زمان' : 'Location & time'}</span><span>{fa ? 'مدت' : 'Est.'}</span></div>{sheet.scenes.map((scene) => <article className="call-sheet-scene-row" key={scene.id}><strong>{scene.shootingOrder.toLocaleString(fa ? 'fa-IR' : 'en-US')}</strong><div><b>{scene.heading}</b><small>{fa ? `صحنه‌ی ${scene.screenplayOrder.toLocaleString('fa-IR')} در فیلمنامه` : `Screenplay scene ${scene.screenplayOrder}`}</small>{scene.characters.length > 0 && <small>{fa ? 'شخصیت‌ها: ' : 'Characters: '}{scene.characters.join('، ')}</small>}{scene.resources.length > 0 && <small>{fa ? 'منابع: ' : 'Resources: '}{scene.resources.join('، ')}</small>}</div><div><span>{scene.location || (fa ? 'مکان ثبت نشده' : 'Location not set')}</span><small>{({ interior: fa ? 'داخلی' : 'Interior', exterior: fa ? 'خارجی' : 'Exterior', mixed: fa ? 'داخلی / خارجی' : 'Interior / exterior', unspecified: fa ? 'نامشخص' : 'Unspecified' })[scene.environment]} · {({ day: fa ? 'روز' : 'Day', night: fa ? 'شب' : 'Night', dawn: fa ? 'سحر' : 'Dawn', dusk: fa ? 'غروب' : 'Dusk', unspecified: fa ? 'نامشخص' : 'Unspecified' })[scene.timeOfDay]}</small></div><span>{scene.estimatedMinutes.toLocaleString(fa ? 'fa-IR' : 'en-US')}′</span>{(scene.productionNotes || scene.continuityNotes) && <p>{[scene.productionNotes, scene.continuityNotes && `${fa ? 'تداوم' : 'Continuity'}: ${scene.continuityNotes}`].filter(Boolean).join(' · ')}</p>}</article>)}</div> : <div className="call-sheet-empty">{fa ? 'هنوز صحنه‌ای به این روز فیلم‌برداری اختصاص داده نشده است.' : 'No scenes are assigned to this shooting day yet.'}</div>}
          </section>

          <section className="call-sheet-section"><header><div><span className="eyebrow">{fa ? 'گروه بازیگران' : 'CAST'}</span><h2>{fa ? 'زمان حضور بازیگران' : 'Cast calls'}</h2></div><span>{sheet.castCalls.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></header>
            {sheet.castCalls.length ? <div className="call-sheet-cast-list">{sheet.castCalls.map((cast) => { const call = form.castCalls.find((item) => item.assignmentId === cast.assignmentId); return <article key={cast.assignmentId}><div><strong>{cast.talentName}</strong><small>{cast.character}</small></div><label>{fa ? 'فراخوان' : 'Call'}<input type="time" value={call?.callTime ?? form.unitCallTime} onChange={(event) => updateCast(cast.assignmentId, 'callTime', event.target.value)} required disabled={!canEdit} /></label><AvailabilityEditor value={call?.availability ?? cast.availability} onChange={(value) => updateCast(cast.assignmentId, 'availability', value)} fa={fa} disabled={!canEdit} /><label className="cast-call-note">{fa ? 'یادداشت' : 'Note'}<input value={call?.notes ?? ''} maxLength={1000} onChange={(event) => updateCast(cast.assignmentId, 'notes', event.target.value)} placeholder={fa ? 'آماده‌سازی یا هماهنگی' : 'Preparation or coordination'} dir="auto" readOnly={!canEdit} /></label></article>; })}</div> : <div className="call-sheet-empty">{fa ? 'بازیگر قطعی‌ای به شخصیت‌های این روز وصل نشده است؛ بازیگران قطعی را در بخش انتخاب بازیگر ثبت کن.' : 'No cast talent is linked to this day’s scene characters. Mark talent as cast in Casting to include them.'}</div>}
          </section>

          <section className="call-sheet-section"><header><div><span className="eyebrow">{fa ? 'گروه تولید' : 'CREW'}</span><h2>{fa ? 'دسترس‌پذیری عوامل' : 'Crew availability'}</h2></div><span>{sheet.crewCalls.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></header>
            {sheet.crewCalls.length ? <div className="call-sheet-cast-list call-sheet-crew-list">{sheet.crewCalls.map((crew) => { const call = form.crewCalls.find((item) => item.memberId === crew.memberId); return <article key={crew.memberId}><div><strong>{crew.name}</strong><small>{[crew.role, crew.department].filter(Boolean).join(' · ') || (fa ? 'سمت ثبت نشده' : 'Role not set')}</small></div><label>{fa ? 'فراخوان' : 'Call'}<input type="time" value={call?.callTime ?? form.unitCallTime} onChange={(event) => updateCrew(crew.memberId, 'callTime', event.target.value)} required disabled={!canEdit} /></label><AvailabilityEditor value={call?.availability ?? crew.availability} onChange={(value) => updateCrew(crew.memberId, 'availability', value)} fa={fa} disabled={!canEdit} /><label className="cast-call-note">{fa ? 'یادداشت' : 'Note'}<input value={call?.notes ?? ''} maxLength={1000} onChange={(event) => updateCrew(crew.memberId, 'notes', event.target.value)} placeholder={fa ? 'هماهنگی حضور' : 'Attendance coordination'} dir="auto" readOnly={!canEdit} /></label></article>; })}</div> : <div className="call-sheet-empty">{fa ? 'هنوز عوامل پروژه در فهرست گروه ثبت نشده‌اند.' : 'No crew members are listed on this project yet.'}</div>}
          </section>

          <div className="call-sheet-notes-grid"><label><span><CarFront size={13} />{fa ? 'رفت‌وآمد و پارکینگ' : 'Transport & parking'}</span><textarea value={form.transportNotes} maxLength={4000} onChange={(event) => setForm({ ...form, transportNotes: event.target.value })} rows={3} dir="auto" placeholder={fa ? 'مسیر دسترسی، پارکینگ یا هماهنگی حمل‌ونقل' : 'Access, parking, or transport details'} readOnly={!canEdit} /></label><label><span><ShieldAlert size={13} />{fa ? 'ایمنی و شرایط ویژه' : 'Safety & special conditions'}</span><textarea value={form.safetyNotes} maxLength={4000} onChange={(event) => setForm({ ...form, safetyNotes: event.target.value })} rows={3} dir="auto" placeholder={fa ? 'خطرها، تجهیزات حفاظت یا شرایط ویژه‌ی صحنه' : 'Hazards, protective equipment, or special conditions'} readOnly={!canEdit} /></label><label className="call-sheet-general-notes"><span><FileText size={13} />{fa ? 'یادداشت گروه' : 'Production notes'}</span><textarea value={form.generalNotes} maxLength={4000} onChange={(event) => setForm({ ...form, generalNotes: event.target.value })} rows={3} dir="auto" placeholder={fa ? 'اطلاعات تکمیلی برای گروه تولید' : 'Additional information for the production team'} readOnly={!canEdit} /></label></div>
          <footer className="call-sheet-footer"><span>{fa ? 'ترتیب برداشت مستقل از ترتیب فیلمنامه است.' : 'Shooting order is independent from screenplay order.'}{sheet.updatedAt && <small>{fa ? ' · آخرین ذخیره: ' : ' · Last saved: '}{new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sheet.updatedAt))}</small>}</span><div className="call-sheet-actions">{!canEdit && <small>{fa ? 'دسترسی شما فقط خواندن است.' : 'You have read-only access.'}</small>}<button className="button button-quiet" onClick={close}>{fa ? 'بستن' : 'Close'}</button>{canEdit && <button className="button button-primary" onClick={() => void save()} disabled={saving || !dirty || !form.unitCallTime}><Save size={14} />{saving ? (fa ? 'در حال ذخیره…' : 'Saving…') : (fa ? 'ذخیره‌ی برگه' : 'Save call sheet')}</button>}</div></footer>
        </div>
      </div> : <div className="call-sheet-load-error">{fa ? 'برگه‌ی فراخوان بارگذاری نشد. ارتباط سرور را بررسی کن و دوباره تلاش کن.' : 'The call sheet could not be loaded. Check the server connection and retry.'}<button className="button button-quiet" onClick={() => { setLoading(true); void api.callSheet(day.id).then((value) => { const next = toInput(value); setSheet(value); setForm(next); setBaseline(JSON.stringify(next)); }).catch((cause) => onToast(cause instanceof Error ? cause.message : 'Could not load call sheet.')).finally(() => setLoading(false)); }}>{fa ? 'تلاش دوباره' : 'Retry'}</button></div>}
    </section>
  </div>;
}
