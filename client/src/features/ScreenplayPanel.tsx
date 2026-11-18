import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Clapperboard, Download, FileText, History, Plus, RotateCcw, Save, Send, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AiAssistMode, AiSuggestion, ScreenplayDraft, ScreenplayRevision, ScreenplayRevisionSummary } from '../../../shared/types';
import { canonicalizeFountain, elementTypes, parseFountain, serializeFountain, type ElementType, type ScriptBlock } from './screenplay-format';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';

const modeLabels: Record<AiAssistMode, { fa: string; en: string }> = {
  'screenplay-analysis': { fa: 'تحلیل فیلمنامه', en: 'Screenplay analysis' },
  'character-analysis': { fa: 'تحلیل شخصیت', en: 'Character analysis' },
  'scene-breakdown': { fa: 'شکست اولیه‌ی صحنه', en: 'Preliminary scene breakdown' },
  'production-plan': { fa: 'پیشنهاد برنامه‌ی تولید', en: 'Production planning' },
};

export function ScreenplayPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const [drafts, setDrafts] = useState<ScreenplayDraft[]>([]);
  const [revisions, setRevisions] = useState<ScreenplayRevisionSummary[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<ScreenplayRevision | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<ScriptBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [aiMode, setAiMode] = useState<AiAssistMode>('screenplay-analysis');
  const [question, setQuestion] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const fa = language === 'fa';
  const body = useMemo(() => serializeFountain(blocks), [blocks]);
  const selectedDraft = drafts.find((draft) => draft.id === selectedId);
  const hasUnsavedChanges = Boolean(selectedDraft && (selectedDraft.title !== title || canonicalizeFountain(selectedDraft.body) !== canonicalizeFountain(body)));

  const selectDraft = (draft: ScreenplayDraft) => {
    if (hasUnsavedChanges && !window.confirm(fa ? 'تغییرات ذخیره‌نشده کنار گذاشته شوند و نسخه‌ی دیگری باز شود؟' : 'Discard unsaved changes and open another draft?')) return;
    setSelectedId(draft.id); setTitle(draft.title); setBlocks(parseFountain(draft.body)); setSelectedRevision(null); setSelectedRevisionId(''); setHistoryOpen(false);
  };
  const load = async () => {
    setLoading(true);
    try {
      const [draftRows, suggestionRows, permissions] = await Promise.all([api.drafts(projectId), api.aiSuggestions(projectId), api.projectPermissions(projectId)]);
      setDrafts(draftRows); setSuggestions(suggestionRows); setCanEdit(['owner', 'admin', 'producer', 'director', 'writer'].includes(permissions.role));
      const selected = draftRows.find((draft) => draft.id === selectedId) ?? draftRows[0];
      if (selected) selectDraft(selected); else { setSelectedId(''); setTitle(''); setBlocks([]); }
    } catch { onToast(t(language, 'error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => {
    if (!selectedId) { setRevisions([]); return; }
    let active = true;
    setHistoryLoading(true);
    void api.draftRevisions(selectedId).then((rows) => { if (active) setRevisions(rows); }).catch(() => { if (active) setRevisions([]); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [selectedId]);
  useEffect(() => {
    if (!historyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setHistoryOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen]);

  const create = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const draft = await api.createDraft(projectId, `${fa ? 'نسخه' : 'Draft'} ${drafts.length + 1}`);
      setDrafts((current) => [draft, ...current]); selectDraft(draft);
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!selectedId || !canEdit || !hasUnsavedChanges) return;
    setBusy(true);
    try {
      const updated = await api.updateDraft(selectedId, title, body);
      setDrafts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setRevisions(await api.draftRevisions(selectedId)); onToast(t(language, 'saved'));
    } catch { onToast(t(language, 'error')); }
    finally { setBusy(false); }
  };
  const selectRevision = async (revisionId: string) => {
    if (!selectedId) return;
    setSelectedRevisionId(revisionId); setSelectedRevision(null); setHistoryLoading(true);
    try { setSelectedRevision(await api.draftRevision(selectedId, revisionId)); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setHistoryLoading(false); }
  };
  const restoreRevision = async () => {
    if (!selectedId || !selectedRevision || !canEdit) return;
    const confirmation = hasUnsavedChanges
      ? (fa ? 'ابتدا تغییرات ذخیره‌نشده در تاریخچه ثبت می‌شوند، سپس این نسخه بازیابی می‌شود. ادامه می‌دهی؟' : 'Unsaved edits will be saved to history first, then this revision will be restored. Continue?')
      : (fa ? 'این نسخه به‌عنوان متن فعلی بازیابی شود؟ نسخه‌ی فعلی هم در تاریخچه باقی می‌ماند.' : 'Restore this revision as the current draft? The current draft will remain in history.');
    if (!window.confirm(confirmation)) return;
    setRestoreBusy(true);
    try {
      if (hasUnsavedChanges) {
        const savedCurrent = await api.updateDraft(selectedId, title, body);
        setDrafts((current) => current.map((item) => item.id === savedCurrent.id ? savedCurrent : item));
      }
      const updated = await api.restoreDraftRevision(selectedId, selectedRevision.id);
      setDrafts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setTitle(updated.title); setBlocks(parseFountain(updated.body));
      const rows = await api.draftRevisions(selectedId); setRevisions(rows); setHistoryOpen(false); setSelectedRevision(null); setSelectedRevisionId('');
      onToast(fa ? `نسخه‌ی ${rows[0]?.revisionNumber ?? ''} بازیابی شد؛ تاریخچه حفظ شد.` : `Restored as revision ${rows[0]?.revisionNumber ?? ''}; history is preserved.`);
    } catch (cause) { onToast(cause instanceof Error ? cause.message : t(language, 'error')); }
    finally { setRestoreBusy(false); }
  };
  const addBlock = (type: ElementType = 'action') => setBlocks((current) => [...current, { id: `${Date.now()}-${Math.random()}`, type, content: '' }]);
  const importFountain = async (file?: File) => {
    if (!file || !canEdit) return;
    if (file.size > 1_500_000) { onToast(fa ? 'فایل فیلمنامه باید حداکثر ۱٫۵ مگابایت باشد.' : 'Screenplay files must be 1.5 MB or smaller.'); return; }
    if (!/\.(?:fountain|txt)$/i.test(file.name)) { onToast(fa ? 'فقط فایل Fountain یا متن ساده پذیرفته می‌شود.' : 'Choose a Fountain or plain text file.'); return; }
... (+76 lines) [see remaining: rtk proxy git show HEAD:client/src/features/ScreenplayPanel.tsx | tail -n +121]
