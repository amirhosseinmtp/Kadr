import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banknote, Check, Pencil, Plus, Search, Save, Trash2, X } from 'lucide-react';
import { budgetCategories, budgetCurrencies, type BudgetCategory, type BudgetCurrency, type BudgetItemStatus, type ProjectBudget, type ProjectBudgetItem, type ProjectBudgetItemInput } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';

type BudgetDraft = Omit<ProjectBudgetItemInput, 'estimatedAmount' | 'committedAmount' | 'actualAmount'> & {
  estimatedAmount: string;
  committedAmount: string;
  actualAmount: string;
};

const emptyDraft = (): BudgetDraft => ({ title: '', department: '', category: 'other', vendorName: '', estimatedAmount: '0', committedAmount: '0', actualAmount: '0', status: 'planned', dueDate: null, notes: '' });

export function BudgetPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const fa = language === 'fa';
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [currencyDraft, setCurrencyDraft] = useState<BudgetCurrency>('IRR');
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [editor, setEditor] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<BudgetDraft>(emptyDraft);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BudgetItemStatus>('all');

  const load = async () => {
    setLoading(true);
    try {
      const [result, permissions] = await Promise.all([api.projectBudget(projectId), api.projectPermissions(projectId)]);
      setBudget(result); setCurrencyDraft(result.currencyCode); setCanEdit(['owner', 'admin', 'producer', 'director', 'production'].includes(permissions.role)); setPermissionsReady(true);
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'بارگذاری بودجه انجام نشد.' : 'Could not load project budget.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const formatMoney = (amount: number) => new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', { style: 'currency', currency: budget?.currencyCode ?? 'IRR', maximumFractionDigits: 0 }).format(amount);
  const categoryLabel = (category: BudgetCategory) => ({ development: fa ? 'توسعه' : 'Development', cast: fa ? 'بازیگران' : 'Cast', crew: fa ? 'گروه' : 'Crew', location: fa ? 'لوکیشن' : 'Locations', equipment: fa ? 'تجهیزات' : 'Equipment', art: fa ? 'هنر و صحنه' : 'Art department', travel: fa ? 'رفت‌وآمد' : 'Travel', meals: fa ? 'پذیرایی' : 'Meals', insurance: fa ? 'بیمه' : 'Insurance', 'post-production': fa ? 'پس‌تولید' : 'Post-production', contingency: fa ? 'پیش‌بینی‌نشده' : 'Contingency', other: fa ? 'سایر' : 'Other' })[category];
  const statusLabel = (status: BudgetItemStatus) => ({ planned: fa ? 'برآورد' : 'Planned', committed: fa ? 'متعهدشده' : 'Committed', paid: fa ? 'پرداخت‌شده' : 'Paid' })[status];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (budget?.items ?? []).filter((item) =>
      (statusFilter === 'all' || item.status === statusFilter)
      && (!normalizedQuery || [item.title, item.department, item.vendorName].some((part) => part.toLocaleLowerCase().includes(normalizedQuery))),
    );
  }, [budget, query, statusFilter]);

  const openNew = () => { setDraft(emptyDraft()); setEditor('new'); };
  const openEdit = (item: ProjectBudgetItem) => {
    setDraft({ title: item.title, department: item.department, category: item.category, vendorName: item.vendorName, estimatedAmount: String(item.estimatedAmount), committedAmount: String(item.committedAmount), actualAmount: String(item.actualAmount), status: item.status, dueDate: item.dueDate, notes: item.notes });
    setEditor(item.id);
  };
  const cancelEditor = () => { setEditor(null); setDraft(emptyDraft()); };
  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    const estimatedAmount = Number(draft.estimatedAmount); const committedAmount = Number(draft.committedAmount); const actualAmount = Number(draft.actualAmount);
    if (![estimatedAmount, committedAmount, actualAmount].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000)) { onToast(fa ? 'مبلغ‌ها باید عدد صحیح و نامنفی باشند.' : 'Amounts must be whole, non-negative numbers.'); return; }
    const payload: ProjectBudgetItemInput = { ...draft, estimatedAmount, committedAmount, actualAmount };
    setSaving(true);
    try {
      const result = editor === 'new' ? await api.createBudgetItem(projectId, payload) : await api.updateBudgetItem(editor!, payload);
      setBudget(result); setCurrencyDraft(result.currencyCode); cancelEditor(); onToast(fa ? 'ردیف بودجه ذخیره شد.' : 'Budget item saved.');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'ذخیره‌ی ردیف بودجه انجام نشد.' : 'Could not save budget item.')); }
    finally { setSaving(false); }
  };
  const removeItem = async (item: ProjectBudgetItem) => {
    if (!window.confirm(fa ? `ردیف «${item.title}» از بودجه حذف شود؟` : `Delete “${item.title}” from the budget?`)) return;
    try { await api.deleteBudgetItem(item.id); setBudget(await api.projectBudget(projectId)); if (editor === item.id) cancelEditor(); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'حذف ردیف بودجه انجام نشد.' : 'Could not delete budget item.')); }
  };
  const saveCurrency = async () => {
    if (!budget || currencyDraft === budget.currencyCode) return;
    setSavingCurrency(true);
    try { const result = await api.updateBudgetCurrency(projectId, currencyDraft); setBudget(result); setCurrencyDraft(result.currencyCode); onToast(fa ? 'ارز بودجه به‌روزرسانی شد.' : 'Budget currency updated.'); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : (fa ? 'تغییر ارز انجام نشد.' : 'Could not update budget currency.')); }
    finally { setSavingCurrency(false); }
  };
  const setField = <K extends keyof BudgetDraft,>(key: K, value: BudgetDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return <section className="budget-panel">
    <header className="budget-heading"><div><span className="eyebrow">{fa ? 'کنترل مالی تولید' : 'PRODUCTION FINANCE'}</span><h3>{fa ? 'بودجه‌ی پروژه' : 'Project budget'}</h3><p>{fa ? 'برآورد، تعهد و هزینه‌ی واقعی را در یک ارز و یک دفتر ثبت کن.' : 'Track estimates, commitments, and actual costs in one project ledger.'}</p></div><div className="budget-heading-actions"><label className="budget-currency-field">{fa ? 'ارز پروژه' : 'Project currency'}<select value={currencyDraft} onChange={(event) => setCurrencyDraft(event.target.value as BudgetCurrency)} disabled={!canEdit || Boolean(budget?.currencyLocked)}>{budgetCurrencies.map((currency) => <option value={currency} key={currency}>{currency === 'IRR' ? (fa ? 'ریال · IRR' : 'IRR · Iranian rial') : currency}</option>)}</select></label>{canEdit && !budget?.currencyLocked && <button className="button button-quiet button-small" onClick={() => void saveCurrency()} disabled={savingCurrency || currencyDraft === budget?.currencyCode}><Check size={13} />{fa ? 'ثبت ارز' : 'Set currency'}</button>}{canEdit && <button className="button button-primary button-small" onClick={openNew}><Plus size={14} />{fa ? 'ردیف بودجه' : 'Add budget item'}</button>}</div></header>
    {budget?.currencyLocked && <p className="budget-currency-lock">{fa ? 'تا وقتی ردیف بودجه وجود دارد، ارز قفل است تا مبلغ‌ها با واحد دیگری نمایش داده نشوند.' : 'Currency is locked while budget items exist so amounts are never silently reinterpreted.'}</p>}
    {loading || !budget ? <div className="loading-line" /> : <>
      <div className="budget-summary-grid"><article><span>{fa ? 'برآورد کل' : 'Estimated total'}</span><strong>{formatMoney(budget.summary.estimated)}</strong><small>{fa ? 'مجموع ردیف‌های بودجه' : 'Across all budget items'}</small></article><article><span>{fa ? 'تعهدشده' : 'Committed'}</span><strong>{formatMoney(budget.summary.committed)}</strong><small>{fa ? 'هزینه‌های تأییدشده' : 'Approved commitments'}</small></article><article><span>{fa ? 'هزینه‌ی واقعی' : 'Actual spend'}</span><strong>{formatMoney(budget.summary.actual)}</strong><small>{fa ? 'ثبت‌شده به‌عنوان پرداخت' : 'Recorded as paid'}</small></article><article className={budget.summary.variance < 0 ? 'over-budget' : ''}><span>{budget.summary.variance < 0 ? (fa ? 'بیش‌بودجه' : 'Over estimate') : (fa ? 'مانده‌ی برآورد' : 'Estimate variance')}</span><strong>{formatMoney(Math.abs(budget.summary.variance))}</strong><small>{fa ? 'برآورد منهای هزینه‌ی واقعی' : 'Estimate minus actual spend'}</small></article></div>
      {editor && canEdit && <form className="budget-item-form" onSubmit={(event) => void saveItem(event)}><div className="budget-form-heading"><div><span className="eyebrow">{editor === 'new' ? (fa ? 'هزینه‌ی تازه' : 'NEW COST LINE') : (fa ? 'ویرایش هزینه' : 'EDIT COST LINE')}</span><strong>{fa ? 'جزئیات ردیف' : 'Budget item details'}</strong></div><button type="button" className="icon-button" onClick={cancelEditor} aria-label={fa ? 'بستن فرم' : 'Close form'}><X size={14} /></button></div><div className="budget-form-grid"><label className="budget-title-field">{fa ? 'عنوان هزینه' : 'Cost title'}<input value={draft.title} onChange={(event) => setField('title', event.target.value)} required maxLength={180} placeholder={fa ? 'مثلاً اجاره‌ی تجهیزات نور' : 'e.g. Lighting package rental'} /></label><label>{fa ? 'واحد' : 'Department'}<input value={draft.department} onChange={(event) => setField('department', event.target.value)} maxLength={120} placeholder={fa ? 'مثلاً فیلم‌برداری' : 'e.g. Camera'} /></label><label>{fa ? 'دسته' : 'Category'}<select value={draft.category} onChange={(event) => setField('category', event.target.value as BudgetCategory)}>{budgetCategories.map((category) => <option value={category} key={category}>{categoryLabel(category)}</option>)}</select></label><label>{fa ? 'فروشنده / طرف قرارداد' : 'Vendor / payee'}<input value={draft.vendorName} onChange={(event) => setField('vendorName', event.target.value)} maxLength={180} dir="auto" /></label><label>{fa ? 'سررسید' : 'Due date'}<input type="date" value={draft.dueDate ?? ''} onChange={(event) => setField('dueDate', event.target.value || null)} /></label><label>{fa ? 'برآورد' : 'Estimate'}<input type="number" min="0" max="1000000000000" step="1" value={draft.estimatedAmount} onChange={(event) => setField('estimatedAmount', event.target.value)} required /></label><label>{fa ? 'تعهدشده' : 'Committed'}<input type="number" min="0" max="1000000000000" step="1" value={draft.committedAmount} onChange={(event) => setField('committedAmount', event.target.value)} required /></label><label>{fa ? 'هزینه‌ی واقعی' : 'Actual cost'}<input type="number" min="0" max="1000000000000" step="1" value={draft.actualAmount} onChange={(event) => setField('actualAmount', event.target.value)} required /></label><label>{fa ? 'وضعیت' : 'Status'}<select value={draft.status} onChange={(event) => setField('status', event.target.value as BudgetItemStatus)}><option value="planned">{statusLabel('planned')}</option><option value="committed">{statusLabel('committed')}</option><option value="paid">{statusLabel('paid')}</option></select></label><label className="budget-notes-field">{fa ? 'یادداشت' : 'Notes'}<textarea value={draft.notes} onChange={(event) => setField('notes', event.target.value)} maxLength={4000} rows={2} dir="auto" /></label></div><footer><button type="button" className="button button-quiet button-small" onClick={cancelEditor}>{fa ? 'انصراف' : 'Cancel'}</button><button type="submit" className="button button-primary button-small" disabled={saving}><Save size={13} />{saving ? '…' : fa ? 'ذخیره‌ی ردیف' : 'Save item'}</button></footer></form>}
      <div className="budget-list-toolbar"><div className="budget-filter-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={fa ? 'جست‌وجو در هزینه‌ها' : 'Search costs'} aria-label={fa ? 'جست‌وجوی بودجه' : 'Search budget'} /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label={fa ? 'فیلتر وضعیت بودجه' : 'Filter budget status'}><option value="all">{fa ? 'همه‌ی وضعیت‌ها' : 'All statuses'}</option><option value="planned">{statusLabel('planned')}</option><option value="committed">{statusLabel('committed')}</option><option value="paid">{statusLabel('paid')}</option></select><span>{filteredItems.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {fa ? 'ردیف' : 'items'}</span></div>
      {filteredItems.length ? <div className="budget-item-list">{filteredItems.map((item) => <article className="budget-item-card" key={item.id}><div className="budget-item-main"><span className={`budget-status ${item.status}`}>{statusLabel(item.status)}</span><h4>{item.title}</h4><p>{[categoryLabel(item.category), item.department, item.vendorName].filter(Boolean).join(' · ')}</p>{item.dueDate && <small>{fa ? 'سررسید' : 'Due'} · {new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium' }).format(new Date(`${item.dueDate}T12:00:00`))}</small>}{item.notes && <small className="budget-item-note">{item.notes}</small>}</div><div className="budget-amounts"><div><span>{fa ? 'برآورد' : 'Estimate'}</span><strong>{formatMoney(item.estimatedAmount)}</strong></div><div><span>{fa ? 'تعهد' : 'Committed'}</span><strong>{formatMoney(item.committedAmount)}</strong></div><div><span>{fa ? 'واقعی' : 'Actual'}</span><strong>{formatMoney(item.actualAmount)}</strong></div></div>{canEdit && <div className="budget-item-actions"><button className="icon-button" onClick={() => openEdit(item)} aria-label={fa ? 'ویرایش ردیف بودجه' : 'Edit budget item'}><Pencil size={13} /></button><button className="icon-button task-delete" onClick={() => void removeItem(item)} aria-label={fa ? 'حذف ردیف بودجه' : 'Delete budget item'}><Trash2 size={13} /></button></div>}</article>)}</div> : <div className="budget-empty"><span><Banknote size={18} /></span><strong>{budget.items.length ? (fa ? 'ردیفی با این فیلتر پیدا نشد' : 'No budget items match this filter') : (fa ? 'دفتر بودجه هنوز خالی است' : 'Your budget ledger is empty')}</strong><p>{budget.items.length ? (fa ? 'فیلتر یا عبارت جست‌وجو را تغییر بده.' : 'Change the filter or search query.') : (fa ? 'برآوردها و هزینه‌های تولید را ثبت کن تا جمع‌ها و اختلاف بودجه به‌روز بمانند.' : 'Add estimates and costs to keep project totals and variance up to date.')}</p>{canEdit && !budget.items.length && <button className="button button-primary button-small" onClick={openNew}><Plus size={13} />{fa ? 'افزودن نخستین ردیف' : 'Add first budget item'}</button>}</div>}
    </>}
    {permissionsReady && !canEdit && <p className="budget-read-only">{fa ? 'دسترسی شما به بودجه فقط خواندن است.' : 'Your project role has read-only access to this budget.'}</p>}
  </section>;
}
