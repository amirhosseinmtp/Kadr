import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, ArrowLeft, ArrowUpLeft, ArrowUpRight, BookOpen, CalendarCheck2, Check, ChevronDown, Clapperboard, Clock3, Film, FolderOpen, Languages, MapPin, Moon, MoreHorizontal, Plus, Search, Sparkles, Sun, UsersRound, X } from 'lucide-react';
import type { CastingRole, Project, ProjectFormat, ProjectNotification, ProjectStatus, ProductionTask, ShootingDay } from '../../shared/types';
import { Sidebar, type Section } from './components/Sidebar';
import { ProjectModal } from './components/ProjectModal';
import { CastingPanel } from './features/CastingPanel';
import { ProductionPanel } from './features/ProductionPanel';
import { SceneBreakdownPanel } from './features/SceneBreakdownPanel';
import { ScreenplayPanel } from './features/ScreenplayPanel';
import { ProjectDetailsPanel } from './features/ProjectDetailsPanel';
import { CrewPanel } from './features/CrewPanel';
import { ResourcesPanel } from './features/ResourcesPanel';
import { NotificationCenter } from './features/NotificationCenter';
import { AuthScreen } from './components/AuthScreen';
import { api } from './lib/api';
import { setCsrfToken } from './lib/api';
import type { AuthSession, AuthUser } from '../../shared/types';
import { t, type Language, type TranslationKey } from './lib/i18n';

const projectColors = ['rose', 'violet', 'sage', 'amber'];
const formats: ProjectFormat[] = ['feature', 'short', 'series', 'documentary', 'commercial'];
const statuses: ProjectStatus[] = ['development', 'pre-production', 'production', 'post-production', 'completed'];

function formatDate(date: string, language: Language) {
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(date));
}

type Theme = 'light' | 'dark';
type AgendaItem = { kind: 'task' | 'shoot'; id: string; projectId: string; projectTitle: string; title: string; date: string; meta: string; overdue: boolean };
function initialTheme(): Theme {
  try { return window.localStorage.getItem('kadr.theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function StatCard({ icon: Icon, label, value, note, color }: { icon: typeof Clapperboard; label: string; value: string | number; note: string; color: string }) {
  return <article className="stat-card"><div className={`stat-icon ${color}`}><Icon size={19} strokeWidth={1.8} /></div><div className="stat-main"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><span className="stat-sparkline" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span></article>;
}

function WorkspaceApp({ user, initialLanguage, onLogout, onWorkspaceChange, onWorkspaceCreate }: { user: AuthUser; initialLanguage: Language; onLogout: () => Promise<void>; onWorkspaceChange: (workspaceId: string) => Promise<void>; onWorkspaceCreate: (name: string) => Promise<void> }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [active, setActive] = useState<Section>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [roleCount, setRoleCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [projectCounts, setProjectCounts] = useState({ drafts: 0, roles: 0, tasks: 0 });
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const canCreateProject = user.workspaceMember && ['owner', 'admin', 'producer', 'director'].includes(user.role);
  const filteredProjects = useMemo(() => projects.filter((project) => `${project.title} ${project.logline}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [projects, search]);
  const activeProjects = projects.filter((project) => project.status !== 'completed');
  const inProduction = projects.filter((project) => project.status === 'production' || project.status === 'post-production').length;

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.projects(); setProjects(result);
      setSelectedProjectId((current) => result.some((project) => project.id === current) ? current : '');
      const summaries = await Promise.all(result.map(async (project) => {
        const [roles, tasks, shootingDays] = await Promise.all([api.roles(project.id), api.tasks(project.id), api.shootingDays(project.id)]);
        return { project, roles, tasks, shootingDays };
      }));
      setRoleCount(summaries.reduce((total, item) => total + item.roles.filter((role: CastingRole) => role.status === 'open').length, 0));
      setTaskCount(summaries.reduce((total, item) => total + item.tasks.filter((task: ProductionTask) => task.status !== 'done').length, 0));
      const today = new Date().toISOString().slice(0, 10);
      const taskItems: AgendaItem[] = summaries.flatMap(({ project, tasks }) => tasks.flatMap((task) => task.status !== 'done' && task.dueDate ? [{ kind: 'task' as const, id: task.id, projectId: project.id, projectTitle: project.title, title: task.title, date: task.dueDate, meta: task.department, overdue: task.dueDate < today }] : []));
      const shootItems: AgendaItem[] = summaries.flatMap(({ project, shootingDays }) => shootingDays.map((day: ShootingDay) => ({ kind: 'shoot' as const, id: day.id, projectId: project.id, projectTitle: project.title, title: day.title || (language === 'fa' ? 'روز فیلم‌برداری' : 'Shooting day'), date: day.shootDate, meta: `${day.sceneCount.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} ${language === 'fa' ? 'صحنه' : 'scenes'}`, overdue: false })).filter((item) => item.date >= today));
      setAgenda([...taskItems, ...shootItems].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'shoot' ? -1 : 1)).slice(0, 8));
    } catch { showToast(language === 'fa' ? 'اتصال به فضای ذخیره‌سازی برقرار نشد.' : 'Could not reach the local database.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedProjectId) { setProjectCounts({ drafts: 0, roles: 0, tasks: 0 }); return; }
    let current = true;
    void Promise.all([api.drafts(selectedProjectId), api.roles(selectedProjectId), api.tasks(selectedProjectId)]).then(([drafts, roles, tasks]) => {
      if (current) setProjectCounts({ drafts: drafts.length, roles: roles.length, tasks: tasks.length });
    }).catch(() => { if (current) setProjectCounts({ drafts: 0, roles: 0, tasks: 0 }); });
    return () => { current = false; };
  }, [selectedProjectId]);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'; }, [language]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem('kadr.theme', theme); } catch { /* Theme still applies for this session. */ }
  }, [theme]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === 'Escape') { setSearch(''); searchInput.current?.blur(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if ((active === 'screenplay' || active === 'scenes' || active === 'casting' || active === 'production' || active === 'team' || active === 'library') && !selectedProjectId && projects.length > 0) setSelectedProjectId(projects[0].id);
  }, [active, projects, selectedProjectId]);

  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(''), 3000); }
  function requestCreateProject() { if (canCreateProject) setShowCreate(true); }
  async function createProject(input: { title: string; format: ProjectFormat; logline: string; genre?: string; languageCode?: string }) {
    try {
      const project = await api.createProject(input); setProjects((current) => [project, ...current]); setSelectedProjectId(project.id); setActive('projects'); showToast(t(language, 'createSuccess'));
    } catch { showToast(t(language, 'error')); throw new Error('create failed'); }
  }
  async function updateProject(input: Parameters<typeof api.updateProject>[1]) {
    if (!selectedProject) return;
    try { const updated = await api.updateProject(selectedProject.id, input); setProjects((current) => current.map((project) => project.id === updated.id ? updated : project)); showToast(t(language, 'saved')); }
    catch { showToast(t(language, 'error')); }
  }
  async function deleteSelectedProject() {
    if (!selectedProject || !window.confirm(t(language, 'confirmDelete'))) return;
    try { await api.deleteProject(selectedProject.id); setProjects((current) => current.filter((project) => project.id !== selectedProject.id)); setSelectedProjectId(''); showToast(language === 'fa' ? 'پروژه حذف شد.' : 'Project deleted.'); }
    catch { showToast(t(language, 'error')); }
  }

  function openNotification(notification: ProjectNotification) {
    const event = notification.eventType;
    const section: Section = event.startsWith('screenplay.') ? 'screenplay'
      : event.startsWith('casting.') ? 'casting'
        : event.startsWith('discussion.') ? 'team'
          : event.includes('scene') || event.includes('shooting_day') || event.includes('call_sheet') ? 'scenes'
            : event === 'project.created' || event === 'project.updated' ? 'projects' : 'production';
    setSelectedProjectId(notification.projectId);
    setActive(section);
  }

  const pageTitle: Record<Section, TranslationKey> = { dashboard: 'dashboard', projects: 'projects', screenplay: 'screenplay', scenes: 'scenes', casting: 'casting', production: 'production', team: 'team', library: 'library', settings: 'settings' };
  const getStatusLabel = (status: ProjectStatus) => t(language, status as TranslationKey);
  const renderProjectCard = (project: Project, index: number) => <button className="project-card" key={project.id} onClick={() => { setSelectedProjectId(project.id); setActive('projects'); }}>
    <div className={`project-art ${projectColors[index % projectColors.length]}`}><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-glow" /><span className="art-format">{t(language, project.format as TranslationKey)}</span><span className="art-frame"><Film size={24} /></span><span className="art-index">0{index + 1}</span></div>
    <div className="project-card-content"><div className="project-card-heading"><div><h3>{project.title}</h3><span>{getStatusLabel(project.status)}</span></div><MoreHorizontal size={19} /></div>
      <p className="project-logline">{project.logline || (language === 'fa' ? 'خلاصه‌ی پروژه هنوز نوشته نشده.' : 'No project summary yet.')}</p>
      <div className="progress-row"><span>{t(language, 'progress')}</span><strong>{project.progress.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}٪</strong></div><div className="progress-track"><i style={{ width: `${project.progress}%` }} /></div>
      <div className="project-card-footer"><span className="project-updated"><span className="tiny-dot" />{formatDate(project.updatedAt, language)}</span><span className="project-private-label">{language === 'fa' ? 'ذخیره‌ی محلی' : 'Saved locally'}</span></div>
    </div>
  </button>;

  const renderDashboard = () => <>
    <section className="welcome-row"><div><div className="eyebrow date-eyebrow">{new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</div><h1>{t(language, 'welcome')} <span className="welcome-star">✳</span></h1><p>{t(language, 'dashboardIntro')}</p></div>{canCreateProject && <button className="button button-primary new-project-button" onClick={requestCreateProject}><Plus size={17} />{t(language, 'newProject')}</button>}</section>
    <section className="stats-grid"><StatCard icon={Clapperboard} label={t(language, 'activeProjects')} value={activeProjects.length.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} note={language === 'fa' ? `${projects.length} روایت در فضای کارت` : `${projects.length} stories in your workspace`} color="coral" /><StatCard icon={Film} label={t(language, 'inProduction')} value={inProduction.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} note={language === 'fa' ? 'در برابر دوربین یا پس‌تولید' : 'On set or in post'} color="lilac" /><StatCard icon={UsersRound} label={t(language, 'openRoles')} value={roleCount.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} note={language === 'fa' ? 'آماده‌ی انتخاب بازیگر' : 'Ready for casting'} color="mint" /><StatCard icon={CalendarCheck2} label={t(language, 'upcomingTasks')} value={taskCount.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} note={language === 'fa' ? 'کارهای باقی‌مانده‌ی گروه' : 'Crew tasks in progress'} color="butter" /></section>
    <section className="dashboard-agenda"><div className="section-heading compact"><div><span className="eyebrow">{language === 'fa' ? 'موعدها و برنامه‌ی صحنه' : 'DEADLINES & SHOOT DAYS'}</span><h2>{language === 'fa' ? 'تقویم نزدیک' : 'Coming up'}</h2></div><button className="text-link" onClick={() => setActive('production')}>{language === 'fa' ? 'برنامه‌ی تولید' : 'Production plan'} <ArrowUpLeft size={14} /></button></div>{agenda.length ? <div className="agenda-list">{agenda.map((item) => <button className={`agenda-item ${item.overdue ? 'overdue' : ''}`} key={`${item.kind}-${item.id}`} onClick={() => { setSelectedProjectId(item.projectId); setActive(item.kind === 'shoot' ? 'scenes' : 'production'); }}><span className={`agenda-icon ${item.kind}`}>{item.kind === 'shoot' ? <Film size={15} /> : item.overdue ? <Clock3 size={15} /> : <CalendarCheck2 size={15} />}</span><span className="agenda-copy"><strong>{item.title}</strong><small>{item.projectTitle} · {item.meta}</small></span><span className="agenda-date">{new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(`${item.date}T12:00:00`))}{item.overdue && <b>{language === 'fa' ? 'عقب‌افتاده' : 'Overdue'}</b>}</span><ArrowLeft size={14} /></button>)}</div> : <div className="agenda-empty"><CalendarCheck2 size={17} /><span>{language === 'fa' ? 'هنوز موعدی ثبت نشده. برای وظایف یا روزهای فیلم‌برداری تاریخ تعیین کن.' : 'No dated work yet. Add due dates to tasks or create shooting days.'}</span><button onClick={() => setActive('production')}>{language === 'fa' ? 'افزودن وظیفه' : 'Add production task'} <ArrowUpLeft size={13} /></button></div>}</section>
    <section className="content-section"><div className="section-heading"><div><span className="eyebrow">{language === 'fa' ? 'در جریان ساخت' : 'IN THE MAKING'}</span><h2>{t(language, 'recentProjects')}</h2></div><button className="text-link" onClick={() => setActive('projects')}>{t(language, 'viewAll')} <ArrowUpLeft size={15} /></button></div>
      {loading ? <div className="loading-grid"><div /><div /><div /></div> : projects.length ? <div className="project-grid dashboard-project-grid">{projects.slice(0, 3).map((project, index) => renderProjectCard(project, index))}{canCreateProject && <button className="new-project-tile" onClick={requestCreateProject}><span className="plus-orbit"><Plus size={20} /></span><strong>{language === 'fa' ? 'شروع یک پروژه‌ی تازه' : 'Start a new project'}</strong><small>{language === 'fa' ? 'ایده‌ی بعدی‌ات را ثبت کن' : 'Capture the next idea'}</small><span className="tile-arrow">↗</span></button>}</div> : <EmptyProjects language={language} canCreate={canCreateProject} onCreate={requestCreateProject} />}
    </section>
    <section className="bottom-grid"><div className="team-spaces-panel"><div className="section-heading compact"><div><span className="eyebrow">{language === 'fa' ? 'همکاری خلاق' : 'CREATIVE COLLABORATION'}</span><h2>{t(language, 'teamSpaces')}</h2></div><button className="icon-button" onClick={() => setActive('team')}><ArrowUpLeft size={17} /></button></div><div className="space-list"><button onClick={() => setActive('screenplay')}><span className="space-icon script-space"><BookOpen size={17} /></span><span><strong>{t(language, 'writingRoom')}</strong><small>{language === 'fa' ? 'فیلمنامه و نسخه‌ها' : 'Scripts and revisions'}</small></span><ArrowLeft size={16} /></button><button onClick={() => setActive('casting')}><span className="space-icon cast-space"><UsersRound size={17} /></span><span><strong>{t(language, 'castingRoom')}</strong><small>{language === 'fa' ? 'نقش‌ها و بازیگران' : 'Roles and performers'}</small></span><ArrowLeft size={16} /></button><button onClick={() => setActive('production')}><span className="space-icon prod-space"><CalendarCheck2 size={17} /></span><span><strong>{t(language, 'productionCrew')}</strong><small>{language === 'fa' ? 'برنامه‌ی تولید و وظایف' : 'Schedule and crew tasks'}</small></span><ArrowLeft size={16} /></button></div></div>
      <div className="quote-panel"><div className="quote-mark">“</div><span className="eyebrow">{language === 'fa' ? 'یادداشت روز' : 'A NOTE FOR TODAY'}</span><blockquote>{language === 'fa' ? 'فیلم‌سازی، هنرِ سازمان‌دادن به رؤیاست.' : 'Filmmaking is the art of organizing a dream.'}</blockquote><div className="quote-line" /><small>{language === 'fa' ? 'کادر، برای قصه‌های در حال ساخت' : 'Kadr, for stories in the making'}</small><span className="quote-aperture"><Film size={34} /></span></div></section>
  </>;

  const renderProjects = () => selectedProject ? <section className="workspace-view">
    <div className="workspace-back-row"><button className="back-link" onClick={() => setSelectedProjectId('')}><ArrowUpRight size={15} />{t(language, 'backToProjects')}</button><button className="icon-button delete-button" onClick={() => void deleteSelectedProject()} title={t(language, 'deleteProject')}><X size={17} /></button></div>
    <div className="workspace-cover"><div className={`workspace-cover-art ${projectColors[projects.findIndex((p) => p.id === selectedProject.id) % projectColors.length]}`}><span>{t(language, selectedProject.format as TranslationKey)}</span><Film size={30} /></div><div className="workspace-title"><span className="eyebrow">{language === 'fa' ? 'پرونده‌ی پروژه' : 'PROJECT WORKSPACE'}</span><h1>{selectedProject.title}</h1><p>{selectedProject.logline || (language === 'fa' ? 'برای این پروژه خلاصه‌ای نوشته نشده.' : 'Add a short summary to frame this project.')}</p><div className="workspace-chips"><span className={`status-chip project-status-${selectedProject.status}`}>{getStatusLabel(selectedProject.status)}</span><span className="muted-meta">{language === 'fa' ? `ساخته‌شده در ${formatDate(selectedProject.createdAt, language)}` : `Created ${formatDate(selectedProject.createdAt, language)}`}</span></div></div></div>
    <div className="workspace-tabs">{(['overview', 'screenplay', 'scenes', 'casting', 'production', 'team', 'library'] as const).map((tab) => <button key={tab} className={`workspace-tab ${active === (tab === 'overview' ? 'projects' : tab) && (tab !== 'overview' || !['screenplay', 'scenes', 'casting', 'production', 'team', 'library'].includes(active)) ? 'active' : ''}`} onClick={() => setActive(tab === 'overview' ? 'projects' : tab)}>{t(language, tab)}</button>)}</div>
    {active === 'screenplay' ? <ScreenplayPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'scenes' ? <SceneBreakdownPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'casting' ? <CastingPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'production' ? <ProductionPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'team' ? <CrewPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'library' ? <ResourcesPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : <div className="project-overview-grid">
      <article className="overview-progress-card"><div className="section-heading compact"><div><span className="eyebrow">{language === 'fa' ? 'مسیر ساخت' : 'PROJECT JOURNEY'}</span><h2>{t(language, 'progress')}</h2></div><strong className="big-percent">{selectedProject.progress.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}٪</strong></div><div className="progress-track large"><i style={{ width: `${selectedProject.progress}%` }} /></div><div className="progress-range-row"><span>{language === 'fa' ? 'ایده' : 'IDEA'}</span><input type="range" min="0" max="100" value={selectedProject.progress} onChange={(e) => setProjects((current) => current.map((project) => project.id === selectedProject.id ? { ...project, progress: Number(e.target.value) } : project))} onMouseUp={(e) => void updateProject({ progress: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void updateProject({ progress: Number((e.target as HTMLInputElement).value) })} aria-label={t(language, 'progress')} /><span>{language === 'fa' ? 'نمایش' : 'SCREEN'}</span></div><div className="overview-field"><label>{t(language, 'status')}</label><select value={selectedProject.status} onChange={(e) => void updateProject({ status: e.target.value as ProjectStatus })}>{statuses.map((status) => <option key={status} value={status}>{getStatusLabel(status)}</option>)}</select></div></article>
      <article className="overview-status-card"><div className="section-heading compact"><div><span className="eyebrow">{language === 'fa' ? 'داده‌های پیوندخورده' : 'CONNECTED WORK'}</span><h2>{language === 'fa' ? 'در یک نگاه' : 'At a glance'}</h2></div><Sparkles size={18} className="sparkle-icon" /></div><div className="overview-metric-row"><span className="metric-icon plum"><BookOpen size={17} /></span><span>{t(language, 'screenplay')}</span><strong>{projectCounts.drafts.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} {t(language, 'scriptsCount')}</strong></div><div className="overview-metric-row"><span className="metric-icon peach"><UsersRound size={17} /></span><span>{t(language, 'casting')}</span><strong>{projectCounts.roles.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} {t(language, 'rolesCount')}</strong></div><div className="overview-metric-row"><span className="metric-icon blue"><CalendarCheck2 size={17} /></span><span>{t(language, 'production')}</span><strong>{projectCounts.tasks.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')} {t(language, 'tasksCount')}</strong></div></article>
      <article className="overview-note-card"><span className="eyebrow">{language === 'fa' ? 'درباره‌ی این روایت' : 'THE STORY SO FAR'}</span><textarea value={selectedProject.logline} onChange={(e) => setProjects((current) => current.map((project) => project.id === selectedProject.id ? { ...project, logline: e.target.value } : project))} onBlur={(e) => void updateProject({ logline: e.target.value })} placeholder={language === 'fa' ? 'خلاصه‌ی یک‌خطی پروژه...' : 'Add a one-line project summary...'} aria-label={t(language, 'logline')} /><small>{language === 'fa' ? 'با ویرایش متن، تغییرات ذخیره می‌شوند.' : 'Changes save when you leave this field.'}</small></article>
      <ProjectDetailsPanel project={selectedProject} language={language} onSave={updateProject} />
    </div>}
  </section> : <>
    <section className="welcome-row projects-welcome"><div><div className="eyebrow">{language === 'fa' ? 'آرشیو روایت‌ها' : 'YOUR STORY ARCHIVE'}</div><h1>{t(language, 'allProjects')}</h1><p>{language === 'fa' ? 'از اولین جرقه تا آخرین نما، همه‌ی پروژه‌ها در یک قاب.' : 'Every story, from the first spark to the final cut.'}</p></div>{canCreateProject && <button className="button button-primary" onClick={requestCreateProject}><Plus size={17} />{t(language, 'newProject')}</button>}</section>
    {loading ? <div className="loading-grid"><div /><div /><div /></div> : filteredProjects.length ? <div className="project-grid all-projects-grid">{filteredProjects.map((project) => renderProjectCard(project, projects.findIndex((item) => item.id === project.id)))}</div> : <EmptyProjects language={language} canCreate={canCreateProject} onCreate={requestCreateProject} />}
  </>;

  const renderMain = () => {
    if (active === 'dashboard') return renderDashboard();
    if (active === 'projects') return renderProjects();
    if (active === 'screenplay' || active === 'scenes' || active === 'casting' || active === 'production' || active === 'team' || active === 'library') {
      if (!selectedProject) return <section className="empty-module-page"><EmptyProjects language={language} canCreate={canCreateProject} onCreate={requestCreateProject} /></section>;
      return <section className="standalone-module"><div className="module-project-switcher"><label>{language === 'fa' ? 'پروژه‌ی جاری' : 'CURRENT PROJECT'}<select value={selectedProject.id} onChange={(e) => setSelectedProjectId(e.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><ChevronDown size={14} /></label><span className="status-chip project-status">{getStatusLabel(selectedProject.status)}</span></div>
        {active === 'screenplay' ? <ScreenplayPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'scenes' ? <SceneBreakdownPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'casting' ? <CastingPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'production' ? <ProductionPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : active === 'team' ? <CrewPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} /> : <ResourcesPanel key={selectedProject.id} projectId={selectedProject.id} language={language} onToast={showToast} />}</section>;
    }
    return <section className="placeholder-page"><div className="placeholder-art"><Languages size={29} /></div><span className="eyebrow">{language === 'fa' ? 'فضای کاری تو' : 'YOUR WORKSPACE'}</span><h1>{t(language, 'settings')}</h1><div className="setting-row"><span><strong>{language === 'fa' ? 'زبان رابط کاربری' : 'Interface language'}</strong><small>{language === 'fa' ? 'زبان و جهت نوشتار' : 'Language and text direction'}</small></span><button className="button button-quiet" onClick={() => setLanguage((current) => current === 'fa' ? 'en' : 'fa')}><Languages size={16} />{t(language, 'language')}</button></div><div className="setting-row"><span><strong>{language === 'fa' ? 'نمایش' : 'Appearance'}</strong><small>{language === 'fa' ? 'حالت روشن یا تاریک؛ ذخیره روی همین دستگاه' : 'Light or dark appearance, saved on this device'}</small></span><button className="button button-quiet" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? (language === 'fa' ? 'حالت روشن' : 'Light mode') : (language === 'fa' ? 'حالت تاریک' : 'Dark mode')}</button></div><div className="setting-row"><span><strong>{language === 'fa' ? 'پایگاه داده' : 'Database'}</strong><small>{language === 'fa' ? 'SQLite محلی، ذخیره‌شده در پوشه‌ی پروژه' : 'Local SQLite, stored in the project directory'}</small></span><span className="connected-label"><i />{language === 'fa' ? 'متصل' : 'Connected'}</span></div></section>;
  };

  return <div className={`app-shell ${language === 'en' ? 'english' : ''} ${theme === 'dark' ? 'dark' : ''}`}>
    <Sidebar active={active} onChange={(section) => { setActive(section); if (section === 'screenplay' || section === 'scenes' || section === 'casting' || section === 'production' || section === 'team' || section === 'library') setSelectedProjectId((current) => current || projects[0]?.id || ''); }} language={language} projectCount={projects.length} user={user} onLogout={onLogout} onWorkspaceChange={onWorkspaceChange} onWorkspaceCreate={onWorkspaceCreate} />
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><span>{t(language, 'brand')}</span><span className="breadcrumb-slash">/</span><strong>{t(language, pageTitle[active])}</strong>{selectedProject && active !== 'dashboard' && <><span className="breadcrumb-slash">/</span><span>{selectedProject.title}</span></>}</div><div className="topbar-actions"><label className="search-box"><Search size={17} /><input ref={searchInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(language, 'search')} onFocus={() => { if (active === 'dashboard') setActive('projects'); }} />{search && <button onClick={() => setSearch('')} aria-label="Clear"><X size={14} /></button>}<kbd>⌘ K</kbd></label><button className="theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? (language === 'fa' ? 'تغییر به حالت روشن' : 'Switch to light mode') : (language === 'fa' ? 'تغییر به حالت تاریک' : 'Switch to dark mode')} title={theme === 'dark' ? (language === 'fa' ? 'حالت روشن' : 'Light mode') : (language === 'fa' ? 'حالت تاریک' : 'Dark mode')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="language-toggle" onClick={() => setLanguage((current) => current === 'fa' ? 'en' : 'fa')} aria-label={t(language, 'language')}>{language === 'fa' ? 'EN' : 'فا'}</button><NotificationCenter language={language} onOpenProject={openNotification} /><div className="topbar-avatar">ک</div></div></header>
      <div className="page-content" key={active}>{renderMain()}</div>
    </main>
    {showCreate && <ProjectModal language={language} onClose={() => setShowCreate(false)} onCreate={createProject} />}
    {toast && <div className="toast-message"><span className="toast-check"><Check size={14} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button></div>}
    <div className="mobile-nav"><button className={active === 'dashboard' ? 'active' : ''} onClick={() => setActive('dashboard')}><FolderOpen size={18} /><span>{t(language, 'dashboard')}</span></button><button className={active === 'projects' ? 'active' : ''} onClick={() => setActive('projects')}><Clapperboard size={18} /><span>{t(language, 'projects')}</span></button>{canCreateProject && <button className="mobile-create" onClick={requestCreateProject}><Plus size={20} /></button>}<button className={active === 'screenplay' ? 'active' : ''} onClick={() => setActive('screenplay')}><BookOpen size={18} /><span>{t(language, 'screenplay')}</span></button><button className={active === 'production' ? 'active' : ''} onClick={() => setActive('production')}><CalendarCheck2 size={18} /><span>{t(language, 'production')}</span></button></div>
  </div>;
}

function EmptyProjects({ language, canCreate, onCreate }: { language: Language; canCreate: boolean; onCreate: () => void }) {
  return <div className="empty-card empty-projects"><div className="empty-icon"><Clapperboard size={23} /></div><h3>{t(language, 'noProjects')}</h3><p>{t(language, 'startProject')}</p>{canCreate && <button className="button button-primary" onClick={onCreate}><Plus size={16} />{t(language, 'newProject')}</button>}</div>;
}

function initialLanguage(): Language {
  try { return window.localStorage.getItem('kadr.language') === 'en' ? 'en' : 'fa'; }
  catch { return 'fa'; }
}

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { try { window.localStorage.setItem('kadr.language', language); } catch { /* Localization remains active for this session. */ } }, [language]);
  useEffect(() => { document.documentElement.dataset.theme = initialTheme(); }, []);
  useEffect(() => {
    let active = true;
    void api.authSession().then((result) => {
      if (!active) return;
      if (result.authenticated && result.csrfToken) setCsrfToken(result.csrfToken);
      setSession(result);
    }).catch(() => { if (active) setSession({ authenticated: false, setupRequired: false }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'; }, [language]);
  if (loading) return <div className="auth-loading" dir={language === 'fa' ? 'rtl' : 'ltr'}><span className="brand-mark"><Aperture size={22} /></span><span>{language === 'fa' ? 'در حال اتصال به فضای کاری…' : 'Connecting to your workspace…'}</span></div>;
  if (!session?.authenticated || !session.user) return <AuthScreen setupRequired={session?.setupRequired ?? false} language={language} onLanguage={setLanguage} onAuthenticated={(user) => setSession({ authenticated: true, setupRequired: false, user })} onRetry={() => { setLoading(true); setAttempt((current) => current + 1); }} />;
  const logout = async () => {
    try { await api.logout(); }
    finally { setCsrfToken(null); setSession({ authenticated: false, setupRequired: false }); }
  };
  return <WorkspaceApp key={`${session.user.id}:${session.user.workspaceId}`} user={session.user} initialLanguage={language} onLogout={logout} onWorkspaceChange={async (workspaceId) => {
    const switched = await api.selectWorkspace(workspaceId);
    setCsrfToken(switched.csrfToken);
    setSession({ authenticated: true, setupRequired: false, user: switched.user });
  }} onWorkspaceCreate={async (name) => {
    const created = await api.createWorkspace(name);
    setCsrfToken(created.csrfToken);
    setSession({ authenticated: true, setupRequired: false, user: created.user });
  }} />;
}
