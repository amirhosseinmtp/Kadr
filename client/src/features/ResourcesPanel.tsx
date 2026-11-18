import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link2, MapPin, Package, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { ProductionLocation, ProductionResource, ProductionResourceKind, ProductionScene } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';
import { ProjectDocumentsPanel } from './ProjectDocumentsPanel';

const resourceKinds: ProductionResourceKind[] = ['prop', 'costume', 'set-dressing', 'equipment', 'vehicle', 'other'];

export function ResourcesPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [locations, setLocations] = useState<ProductionLocation[]>([]);
  const [resources, setResources] = useState<ProductionResource[]>([]);
  const [scenes, setScenes] = useState<ProductionScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationName, setLocationName] = useState('');
  const [locationCategory, setLocationCategory] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationContactName, setLocationContactName] = useState('');
  const [locationContactPhone, setLocationContactPhone] = useState('');
  const [locationNotes, setLocationNotes] = useState('');
  const [resourceName, setResourceName] = useState('');
  const [resourceKind, setResourceKind] = useState<ProductionResourceKind>('prop');
  const [resourceDescription, setResourceDescription] = useState('');
  const [resourceQuantity, setResourceQuantity] = useState('1');
  const [resourceNotes, setResourceNotes] = useState('');
  const [sceneSelection, setSceneSelection] = useState<Record<string, string[]>>({});
  const [savingResourceId, setSavingResourceId] = useState('');
  const [savingSceneId, setSavingSceneId] = useState('');
  const [locationEdits, setLocationEdits] = useState<Record<string, Partial<ProductionLocation>>>({});
  const [resourceEdits, setResourceEdits] = useState<Record<string, Partial<ProductionResource>>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [locationRows, resourceRows, sceneRows] = await Promise.all([api.locations(), api.resources(), api.scenes(projectId)]);
      setLocations(locationRows); setResources(resourceRows); setScenes(sceneRows);
      const sceneSet = new Set(sceneRows.map((scene) => scene.id));
      setSceneSelection(Object.fromEntries(resourceRows.map((resource) => [resource.id, resource.sceneIds.filter((id) => sceneSet.has(id))])));
    } catch { onToast(t(language, 'error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);
  const localSceneIds = useMemo(() => new Set(scenes.map((scene) => scene.id)), [scenes]);
  const locationType = (category: string) => category || (fa ? 'لوکیشن' : 'Location');
  const kindLabel = (kind: ProductionResourceKind) => ({ prop: fa ? 'وسیله‌ی صحنه' : 'Prop', costume: fa ? 'لباس' : 'Costume', 'set-dressing': fa ? 'چیدمان' : 'Set dressing', equipment: fa ? 'تجهیزات' : 'Equipment', vehicle: fa ? 'وسیله‌ی نقلیه' : 'Vehicle', other: fa ? 'سایر' : 'Other' })[kind];

  const addLocation = async (event: FormEvent) => {
    event.preventDefault(); if (!locationName.trim()) return;
    try {
      const location = await api.createLocation({ name: locationName.trim(), category: locationCategory.trim(), address: locationAddress.trim(), contactName: locationContactName.trim(), contactPhone: locationContactPhone.trim(), notes: locationNotes.trim() });
      setLocations((current) => [...current, location].sort((a, b) => a.name.localeCompare(b.name)));
      setLocationName(''); setLocationCategory(''); setLocationAddress(''); setLocationContactName(''); setLocationContactPhone(''); setLocationNotes('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const addResource = async (event: FormEvent) => {
    event.preventDefault(); if (!resourceName.trim()) return;
    try {
      const resource = await api.createResource({ name: resourceName.trim(), kind: resourceKind, description: resourceDescription.trim(), quantity: Math.max(1, Number(resourceQuantity) || 1), notes: resourceNotes.trim() });
      setResources((current) => [...current, resource].sort((a, b) => a.name.localeCompare(b.name))); setSceneSelection((current) => ({ ...current, [resource.id]: [] }));
      setResourceName(''); setResourceDescription(''); setResourceQuantity('1'); setResourceNotes('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const setSceneLocation = async (scene: ProductionScene, locationId: string) => {
    setSavingSceneId(scene.id);
    try {
      const updated = await api.updateScene(scene.id, { locationId: locationId || null });
      setScenes((current) => current.map((item) => item.id === updated.id ? updated : item));
      onToast(fa ? 'اتصال لوکیشن به صحنه ذخیره شد.' : 'Scene location saved.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setSavingSceneId(''); }
  };
  const saveResourceScenes = async (resource: ProductionResource) => {
    setSavingResourceId(resource.id);
    const otherProjectSceneIds = resource.sceneIds.filter((id) => !localSceneIds.has(id));
    const selected = sceneSelection[resource.id] ?? [];
    try {
      const updated = await api.updateResource(resource.id, { sceneIds: [...otherProjectSceneIds, ...selected] });
      setResources((current) => current.map((item) => item.id === updated.id ? updated : item));
      onToast(fa ? 'اتصال منبع به صحنه‌ها ذخیره شد.' : 'Scene links saved.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setSavingResourceId(''); }
  };
  const saveLocation = async (id: string) => {
    try { const updated = await api.updateLocation(id, locationEdits[id] ?? {}); setLocations((current) => current.map((item) => item.id === id ? updated : item)); setLocationEdits((current) => { const next = { ...current }; delete next[id]; return next; }); onToast(t(language, 'saved')); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const saveResource = async (id: string) => {
    try { const updated = await api.updateResource(id, resourceEdits[id] ?? {}); setResources((current) => current.map((item) => item.id === id ? updated : item)); setResourceEdits((current) => { const next = { ...current }; delete next[id]; return next; }); onToast(t(language, 'saved')); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
  };
  const removeLocation = async (location: ProductionLocation) => {
    if (!window.confirm(fa ? `لوکیشن «${location.name}» حذف شود؟ نام ثبت‌شده در صحنه‌ها باقی می‌ماند.` : `Delete ${location.name}? Scene notes will keep the saved location name.`)) return;
    try { await api.deleteLocation(location.id); setLocations((current) => current.filter((item) => item.id !== location.id)); setScenes((current) => current.map((scene) => scene.locationId === location.id ? { ...scene, locationId: null } : scene)); }
    catch { onToast(t(language, 'error')); }
  };
  const removeResource = async (resource: ProductionResource) => {
    if (!window.confirm(fa ? `منبع «${resource.name}» و اتصال‌های صحنه‌ای آن حذف شود؟` : `Delete ${resource.name} and its scene links?`)) return;
    try { await api.deleteResource(resource.id); setResources((current) => current.filter((item) => item.id !== resource.id)); }
    catch { onToast(t(language, 'error')); }
  };

  return <div className="resources-page"><header className="module-header"><div><span className="eyebrow">{fa ? 'منابع مشترک تولید' : 'SHARED PRODUCTION LIBRARY'}</span><h2>{fa ? 'لوکیشن‌ها و منابع' : 'Locations & resources'}</h2><p>{fa ? 'لوکیشن‌ها و اقلام را یک‌بار ثبت کن و آن‌ها را به صحنه‌های پروژه وصل کن.' : 'Create reusable production records and link them to scenes without duplicating notes.'}</p></div><div className="library-summary"><span><MapPin size={15} />{locations.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span><span><Package size={15} />{resources.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></div></header>
    <div className="library-columns">
      <section className="library-section"><div className="library-section-heading"><div><span className="eyebrow">{fa ? 'دفتر لوکیشن‌ها' : 'LOCATION DIRECTORY'}</span><h3>{fa ? 'لوکیشن‌ها' : 'Locations'}</h3></div></div>
        <form className="library-create-form" onSubmit={(event) => void addLocation(event)}><label>{fa ? 'نام لوکیشن' : 'Location name'}<input value={locationName} onChange={(event) => setLocationName(event.target.value)} required /></label><div className="library-form-grid"><label>{fa ? 'نوع' : 'Category'}<input value={locationCategory} onChange={(event) => setLocationCategory(event.target.value)} placeholder={fa ? 'خانه، استودیو...' : 'House, studio...'} /></label><label>{fa ? 'نشانی' : 'Address'}<input value={locationAddress} onChange={(event) => setLocationAddress(event.target.value)} /></label><label>{fa ? 'نام رابط' : 'Contact name'}<input value={locationContactName} onChange={(event) => setLocationContactName(event.target.value)} /></label><label>{fa ? 'تلفن رابط' : 'Contact phone'}<input dir="ltr" value={locationContactPhone} onChange={(event) => setLocationContactPhone(event.target.value)} /></label></div><label>{fa ? 'یادداشت' : 'Notes'}<textarea rows={2} value={locationNotes} onChange={(event) => setLocationNotes(event.target.value)} /></label><button className="button button-quiet" type="submit"><Plus size={14} />{fa ? 'افزودن لوکیشن' : 'Add location'}</button></form>
        {loading ? <div className="loading-line" /> : locations.length ? <div className="location-list">{locations.map((location) => { const linked = scenes.filter((scene) => scene.locationId === location.id).length; const edit = locationEdits[location.id]; return <article className="location-card" key={location.id}><span className="location-card-icon"><MapPin size={17} /></span><div className="location-card-content"><div><strong>{location.name}</strong><small>{locationType(location.category)}{location.address && ` · ${location.address}`}</small></div>{(location.contactName || location.contactPhone) && <small className="location-contact">{location.contactName}{location.contactName && location.contactPhone ? ' · ' : ''}<span dir="ltr">{location.contactPhone}</span></small>}{location.notes && <p>{location.notes}</p>}<span className="linked-count"><Link2 size={12} />{linked.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'صحنه در این پروژه' : 'scenes in this project'}</span>{edit && <div className="inline-edit-form"><label>{fa ? 'نام' : 'Name'}<input value={edit.name ?? ''} onChange={(event) => setLocationEdits((current) => ({ ...current, [location.id]: { ...current[location.id], name: event.target.value } }))} /></label><label>{fa ? 'نشانی' : 'Address'}<input value={edit.address ?? ''} onChange={(event) => setLocationEdits((current) => ({ ...current, [location.id]: { ...current[location.id], address: event.target.value } }))} /></label><label>{fa ? 'یادداشت' : 'Notes'}<textarea rows={2} value={edit.notes ?? ''} onChange={(event) => setLocationEdits((current) => ({ ...current, [location.id]: { ...current[location.id], notes: event.target.value } }))} /></label><div><button className="text-link" onClick={() => void saveLocation(location.id)}><Save size={13} />{t(language, 'save')}</button><button className="text-link" onClick={() => setLocationEdits((current) => { const next = { ...current }; delete next[location.id]; return next; })}>{fa ? 'انصراف' : 'Cancel'}</button></div></div>}</div><div className="location-card-actions"><button className="icon-button" onClick={() => setLocationEdits((current) => ({ ...current, [location.id]: { name: location.name, category: location.category, address: location.address, notes: location.notes, contactName: location.contactName, contactPhone: location.contactPhone } }))} aria-label={fa ? 'ویرایش لوکیشن' : 'Edit location'}><Pencil size={13} /></button><button className="icon-button task-delete" onClick={() => void removeLocation(location)} aria-label={fa ? 'حذف لوکیشن' : 'Delete location'}><Trash2 size={14} /></button></div></article>; })}</div> : <div className="library-empty">{fa ? 'لوکیشن ثبت نشده است.' : 'No locations yet.'}</div>}
        <div className="scene-location-links"><div className="form-section-title"><Link2 size={15} /><strong>{fa ? 'اتصال لوکیشن به صحنه‌ها' : 'Link locations to scenes'}</strong></div>{scenes.length ? scenes.map((scene) => <label className="scene-location-row" key={scene.id}><span><b>{scene.screenplayOrder.toLocaleString(fa ? 'fa-IR' : 'en-US')}</b>{scene.heading}</span><select value={scene.locationId ?? ''} disabled={savingSceneId === scene.id} onChange={(event) => void setSceneLocation(scene, event.target.value)}><option value="">{fa ? 'بدون لوکیشن' : 'No location'}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>) : <p className="library-empty">{fa ? 'برای اتصال، ابتدا در شکست صحنه‌ها، صحنه‌ای بساز.' : 'Create scenes in Scene breakdown to link locations.'}</p>}</div>
      </section>
      <section className="library-section"><div className="library-section-heading"><div><span className="eyebrow">{fa ? 'فهرست منابع مشترک' : 'REUSABLE INVENTORY'}</span><h3>{fa ? 'وسایل و تجهیزات' : 'Resources'}</h3></div></div>
        <form className="library-create-form" onSubmit={(event) => void addResource(event)}><label>{fa ? 'نام منبع' : 'Resource name'}<input value={resourceName} onChange={(event) => setResourceName(event.target.value)} required /></label><div className="library-form-grid"><label>{fa ? 'نوع' : 'Kind'}<select value={resourceKind} onChange={(event) => setResourceKind(event.target.value as ProductionResourceKind)}>{resourceKinds.map((kind) => <option value={kind} key={kind}>{kindLabel(kind)}</option>)}</select></label><label>{fa ? 'تعداد' : 'Quantity'}<input type="number" min="1" value={resourceQuantity} onChange={(event) => setResourceQuantity(event.target.value)} /></label></div><label>{fa ? 'توضیحات' : 'Description'}<input value={resourceDescription} onChange={(event) => setResourceDescription(event.target.value)} /></label><button className="button button-quiet" type="submit"><Plus size={14} />{fa ? 'افزودن منبع' : 'Add resource'}</button></form>
        {loading ? <div className="loading-line" /> : resources.length ? <div className="resource-list">{resources.map((resource) => { const edit = resourceEdits[resource.id]; return <article className="resource-card" key={resource.id}><div className="resource-card-heading"><span className="resource-icon"><Package size={16} /></span><div><strong>{resource.name}</strong><small>{kindLabel(resource.kind)} · {fa ? 'تعداد' : 'Qty'} {resource.quantity.toLocaleString(fa ? 'fa-IR' : 'en-US')}</small></div><button className="icon-button" onClick={() => setResourceEdits((current) => ({ ...current, [resource.id]: { name: resource.name, kind: resource.kind, description: resource.description, quantity: resource.quantity, notes: resource.notes } }))} aria-label={fa ? 'ویرایش منبع' : 'Edit resource'}><Pencil size={13} /></button><button className="icon-button task-delete" onClick={() => void removeResource(resource)} aria-label={fa ? 'حذف منبع' : 'Delete resource'}><Trash2 size={14} /></button></div>{resource.description && <p>{resource.description}</p>}{edit && <div className="inline-edit-form"><label>{fa ? 'نام' : 'Name'}<input value={edit.name ?? ''} onChange={(event) => setResourceEdits((current) => ({ ...current, [resource.id]: { ...current[resource.id], name: event.target.value } }))} /></label><label>{fa ? 'توضیحات' : 'Description'}<input value={edit.description ?? ''} onChange={(event) => setResourceEdits((current) => ({ ...current, [resource.id]: { ...current[resource.id], description: event.target.value } }))} /></label><div className="library-form-grid"><label>{fa ? 'نوع' : 'Kind'}<select value={edit.kind ?? 'other'} onChange={(event) => setResourceEdits((current) => ({ ...current, [resource.id]: { ...current[resource.id], kind: event.target.value as ProductionResourceKind } }))}>{resourceKinds.map((kind) => <option value={kind} key={kind}>{kindLabel(kind)}</option>)}</select></label><label>{fa ? 'تعداد' : 'Quantity'}<input type="number" min="1" value={edit.quantity ?? 1} onChange={(event) => setResourceEdits((current) => ({ ...current, [resource.id]: { ...current[resource.id], quantity: Number(event.target.value) } }))} /></label></div><div><button className="text-link" onClick={() => void saveResource(resource.id)}><Save size={13} />{t(language, 'save')}</button><button className="text-link" onClick={() => setResourceEdits((current) => { const next = { ...current }; delete next[resource.id]; return next; })}>{fa ? 'انصراف' : 'Cancel'}</button></div></div>}<details className="resource-scene-links"><summary><Link2 size={13} />{fa ? 'اتصال به صحنه‌های این پروژه' : 'Link to scenes in this project'} <span>{(resource.sceneIds.filter((id) => localSceneIds.has(id))).length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</span></summary>{scenes.length ? <><div className="resource-scene-checks">{scenes.map((scene) => <label key={scene.id}><input type="checkbox" checked={(sceneSelection[resource.id] ?? resource.sceneIds.filter((id) => localSceneIds.has(id))).includes(scene.id)} onChange={(event) => setSceneSelection((current) => { const chosen = current[resource.id] ?? resource.sceneIds.filter((id) => localSceneIds.has(id)); return { ...current, [resource.id]: event.target.checked ? [...chosen, scene.id] : chosen.filter((id) => id !== scene.id) }; })} /><span>{scene.screenplayOrder.toLocaleString(fa ? 'fa-IR' : 'en-US')} · {scene.heading}</span></label>)}</div><button className="button button-quiet button-small" onClick={() => void saveResourceScenes(resource)} disabled={savingResourceId === resource.id}>{savingResourceId === resource.id ? '…' : <><Save size={13} />{t(language, 'save')}</>}</button></> : <p className="library-empty">{fa ? 'هنوز صحنه‌ای در این پروژه نیست.' : 'No scenes in this project yet.'}</p>}</details></article>; })}</div> : <div className="library-empty">{fa ? 'منبعی ثبت نشده است.' : 'No resources yet.'}</div>}
        <div className="library-note">{fa ? 'منابع در کل فضای کاری مشترک‌اند و می‌توان آن‌ها را به صحنه‌های پروژه‌های مختلف پیوند داد.' : 'Resources are shared across the local workspace and can be linked to scenes from different projects.'}</div>
      </section>
    </div>
    <ProjectDocumentsPanel key={projectId} projectId={projectId} language={language} onToast={onToast} />
  </div>;
}
