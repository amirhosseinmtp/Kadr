import { useEffect, useState, type FormEvent } from 'react';
import { Banknote, CalendarDays, Check, Circle, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { projectWorkflowPhases, type ProductionTask, type ProjectMember, type ProjectWorkflowPhase, type TaskPriority, type TaskStatus } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';
import { t } from '../lib/i18n';
import { BudgetPanel } from './BudgetPanel';

export function ProductionPanel({ projectId, language, onToast }: { projectId: string; language: Language; onToast: (message: string) => void }) {
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState(language === 'fa' ? 'تولید' : 'Production');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [canEditTasks, setCanEditTasks] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'tasks' | 'budget'>('tasks');
  const [phaseFilter, setPhaseFilter] = useState<ProjectWorkflowPhase>('production');
  const load = async () => { setLoading(true); try { const [taskRows, memberRows, permissions] = await Promise.all([api.tasks(projectId), api.members(projectId), api.projectPermissions(projectId)]); setTasks(taskRows); setMembers(memberRows); setCanEditTasks(['owner', 'admin', 'producer', 'director', 'production'].includes(permissions.role)); } catch { onToast(t(language, 'error')); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [projectId]);

  const add = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    try {
      const task = await api.createTask(projectId, { title, department, phase: phaseFilter, priority, dueDate: dueDate || null, assigneeId: assigneeId || null });
      setTasks((current) => [task, ...current]); setTitle(''); setDueDate(''); setAssigneeId('');
    } catch { onToast(t(language, 'error')); }
  };
  const update = async (task: ProductionTask, status: TaskStatus) => {
    try { const updated = await api.updateTask(task.id, status); setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); }
    catch { onToast(t(language, 'error')); }
  };
  const assign = async (task: ProductionTask, memberId: string) => {
    try { const updated = await api.updateTask(task.id, { assigneeId: memberId || null }); setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); }
    catch { onToast(t(language, 'error')); }
  };
  const remove = async (id: string) => {
    try { await api.deleteTask(id); setTasks((current) => current.filter((item) => item.id !== id)); }
    catch { onToast(t(language, 'error')); }
  };
  const columns: TaskStatus[] = ['todo', 'doing', 'done'];
  const visibleTasks = tasks.filter((task) => task.phase === phaseFilter);
  const phaseLabels: Record<ProjectWorkflowPhase, string> = language === 'fa'
    ? { development: 'توسعه', 'pre-production': 'پیش‌تولید', production: 'تولید', 'post-production': 'پس‌تولید', archive: 'تحویل و آرشیو' }
    : { development: 'Development', 'pre-production': 'Pre-production', production: 'Production', 'post-production': 'Post-production', archive: 'Delivery & archive' };
  const postProductionStages = language === 'fa'
    ? [{ title: 'تدوین تصویر', department: 'تدوین' }, { title: 'تدوین و طراحی صدا', department: 'صدا' }, { title: 'ساخت و ضبط موسیقی', department: 'موسیقی' }, { title: 'اصلاح رنگ', department: 'رنگ' }, { title: 'جلوه‌های بصری', department: 'VFX' }, { title: 'بازبینی و اعمال اصلاحات', department: 'بازبینی' }, { title: 'آماده‌سازی نسخه‌ی تحویل', department: 'تحویل' }]
    : [{ title: 'Picture edit', department: 'Editorial' }, { title: 'Sound edit and mix', department: 'Sound' }, { title: 'Compose and record music', department: 'Music' }, { title: 'Color grade', department: 'Color' }, { title: 'Visual effects', department: 'VFX' }, { title: 'Review and revisions', department: 'Review' }, { title: 'Prepare delivery masters', department: 'Delivery' }];
  const addPostProductionStage = async (stage: { title: string; department: string }) => {
    if (tasks.some((task) => task.phase === 'post-production' && task.title === stage.title && task.department === stage.department)) return;
    try {
      const task = await api.createTask(projectId, { ...stage, phase: 'post-production', priority: 'medium', dueDate: null });
      setTasks((current) => [task, ...current]);
    } catch { onToast(t(language, 'error')); }
  };

  return <div className="production-page">
    <div className="module-header"><div><span className="eyebrow">{language === 'fa' ? 'از برنامه تا صحنه' : 'FROM PLAN TO SET'}</span><h2>{t(language, 'production')}</h2><p>{language === 'fa' ? 'برنامه‌ی روزانه‌ی گروه را شفاف و هماهنگ نگه دار.' : 'Keep the crew aligned from prep through the shoot.'}</p></div><div className="board-counter"><CalendarDays size={16} />{tasks.length.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} {t(language, 'tasksCount')}</div></div>
    <div className="production-workspace-tabs"><button className={workspaceTab === 'tasks' ? 'active' : ''} onClick={() => setWorkspaceTab('tasks')}><ClipboardList size={15} />{language === 'fa' ? 'وظیفه‌های تولید' : 'Production tasks'}<span>{tasks.length.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}</span></button><button className={workspaceTab === 'budget' ? 'active' : ''} onClick={() => setWorkspaceTab('budget')}><Banknote size={15} />{language === 'fa' ? 'بودجه' : 'Budget'}</button></div>
    {workspaceTab === 'tasks' ? <>
    <nav className="workflow-phase-tabs" aria-label={language === 'fa' ? 'مرحله‌ی گردش‌کار پروژه' : 'Project workflow phase'}>{projectWorkflowPhases.map((phase) => <button key={phase} className={phaseFilter === phase ? 'active' : ''} onClick={() => setPhaseFilter(phase)} aria-pressed={phaseFilter === phase}><span>{phaseLabels[phase]}</span><small>{tasks.filter((task) => task.phase === phase).length.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}</small></button>)}</nav>
    {phaseFilter === 'post-production' && <section className="post-production-starter"><div><span className="eyebrow">{language === 'fa' ? 'چک‌لیست قابل ویرایش' : 'EDITABLE WORKFLOW STARTER'}</span><h3>{language === 'fa' ? 'پایه‌های پس‌تولید' : 'Post-production starters'}</h3><p>{language === 'fa' ? 'موارد موردنیاز را به‌عنوان وظیفه‌ی واقعی پروژه اضافه کن؛ عنوان، مسئول و سررسید بعداً قابل ویرایش‌اند.' : 'Add the stages your film needs as real project tasks. You can assign owners and due dates afterward.'}</p></div>{canEditTasks ? <div className="post-production-stage-list">{postProductionStages.map((stage) => { const added = tasks.some((task) => task.phase === 'post-production' && task.title === stage.title && task.department === stage.department); return <button key={stage.title} onClick={() => void addPostProductionStage(stage)} disabled={added} className={added ? 'added' : ''}><span>{added ? <Check size={13} /> : <Plus size={13} />}</span>{stage.title}<small>{added ? (language === 'fa' ? 'افزوده شد' : 'Added') : stage.department}</small></button>; })}</div> : <p className="workflow-read-only">{language === 'fa' ? 'دسترسی این نقش فقط خواندنی است.' : 'Your project role has read-only workflow access.'}</p>}</section>}
    {canEditTasks && <form className="task-create-form" onSubmit={add}><label>{t(language, 'taskTitle')}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={language === 'fa' ? 'مثلاً: رزرو تجهیزات صدا' : 'e.g. Reserve sound equipment'} required /></label><label>{t(language, 'department')}<input value={department} onChange={(e) => setDepartment(e.target.value)} /></label><label>{t(language, 'dueDate')}<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><label>{t(language, 'priority')}<select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}><option value="low">{t(language, 'low')}</option><option value="medium">{t(language, 'medium')}</option><option value="high">{t(language, 'high')}</option></select></label><label>{language === 'fa' ? 'مسئول' : 'Assignee'}<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">{language === 'fa' ? 'بدون مسئول' : 'Unassigned'}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><button type="submit" className="button button-primary"><Plus size={16} />{t(language, 'addTask')}</button></form>}
    {loading ? <div className="loading-line" /> : <div className="task-board">{columns.map((status) => {
      const items = visibleTasks.filter((task) => task.status === status);
      return <section className="task-column" key={status}><div className="column-heading"><span className={`column-marker ${status}`} /> <strong>{t(language, status === 'todo' ? 'toDo' : status)}</strong><span className="column-count">{items.length.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}</span></div>
        <div className="task-list">{items.length === 0 && <div className="empty-column">{language === 'fa' ? 'وظیفه‌ای نیست' : 'No tasks here yet'}</div>}{items.map((task) => <article className={`task-card ${status === 'done' ? 'task-done' : ''}`} key={task.id}>
          <div className="task-card-top"><span className={`priority-tag ${task.priority}`}>{t(language, task.priority)}</span>{canEditTasks && <button className="icon-button task-delete" onClick={() => void remove(task.id)} aria-label={language === 'fa' ? 'حذف وظیفه' : 'Delete task'}><Trash2 size={14} /></button>}</div>
          <h4>{task.title}</h4><div className="task-meta"><span>{task.department}</span>{task.dueDate && <span>{new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(`${task.dueDate}T12:00:00`))}</span>}</div>{canEditTasks ? <label className="task-assignee">{language === 'fa' ? 'مسئول' : 'Assigned to'}<select value={task.assigneeId ?? ''} onChange={(event) => void assign(task, event.target.value)}><option value="">{language === 'fa' ? 'بدون مسئول' : 'Unassigned'}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label> : <small className="task-assignee-readonly">{language === 'fa' ? 'مسئول' : 'Assigned to'}: {task.assigneeName || (language === 'fa' ? 'تعیین‌نشده' : 'Unassigned')}</small>}
          {canEditTasks && <button className="task-complete" onClick={() => void update(task, status === 'todo' ? 'doing' : status === 'doing' ? 'done' : 'todo')}>{status === 'done' ? <Check size={15} /> : <Circle size={15} />}{status === 'todo' ? (language === 'fa' ? 'شروع وظیفه' : 'Start task') : status === 'doing' ? (language === 'fa' ? 'علامت‌گذاری به‌عنوان انجام‌شده' : 'Mark as done') : (language === 'fa' ? 'بازگرداندن به فهرست' : 'Move back to to do')}</button>}
        </article>)}</div>
      </section>;
    })}</div>}
    </> : <BudgetPanel projectId={projectId} language={language} onToast={onToast} />}
  </div>;
}
