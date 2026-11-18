import { useEffect, useState } from 'react';
import { Bell, CheckCheck, ChevronLeft, Circle, X } from 'lucide-react';
import type { NotificationInbox, ProjectNotification } from '../../../shared/types';
import { api } from '../lib/api';
import type { Language } from '../lib/i18n';

const activityLabels: Record<string, [string, string]> = {
  'project.created': ['پروژه ساخته شد', 'Project created'],
  'project.updated': ['مشخصات پروژه به‌روزرسانی شد', 'Project details updated'],
  'project.document_uploaded': ['فایل تازه‌ای به پروژه افزوده شد', 'Project file uploaded'],
  'project.document_deleted': ['یکی از پیوست‌های پروژه حذف شد', 'Project attachment deleted'],
  'screenplay.created': ['نسخه‌ی فیلمنامه ساخته شد', 'Screenplay draft created'],
  'screenplay.updated': ['فیلمنامه به‌روزرسانی شد', 'Screenplay updated'],
  'discussion.comment_created': ['دیدگاه تازه ثبت شد', 'New comment posted'],
  'discussion.comment_updated': ['دیدگاه ویرایش شد', 'Comment edited'],
  'discussion.comment_deleted': ['دیدگاه حذف شد', 'Comment deleted'],
  'casting.role_created': ['نقش تازه به گروه بازیگران اضافه شد', 'Casting role added'],
  'production.task_created': ['وظیفه‌ی تازه‌ای به پروژه اضافه شد', 'Project task added'],
  'production.task_updated': ['وظیفه‌ی پروژه به‌روزرسانی شد', 'Project task updated'],
  'production.task_phase_updated': ['مرحله‌ی گردش‌کار وظیفه تغییر کرد', 'Task workflow phase changed'],
  'production.scene_created': ['صحنه‌ای به برنامه‌ی تولید اضافه شد', 'Scene breakdown added'],
  'production.scene_updated': ['جزئیات صحنه تغییر کرد', 'Scene breakdown updated'],
  'production.shooting_day_created': ['روز فیلم‌برداری برنامه‌ریزی شد', 'Shooting day scheduled'],
  'production.call_sheet_updated': ['برگه‌ی فراخوان تغییر کرد', 'Call sheet updated'],
  'production.budget_currency_updated': ['ارز بودجه‌ی پروژه تغییر کرد', 'Project budget currency updated'],
  'production.budget_item_created': ['ردیف هزینه به بودجه اضافه شد', 'Budget item added'],
  'production.budget_item_updated': ['ردیف بودجه به‌روزرسانی شد', 'Budget item updated'],
  'production.budget_item_deleted': ['ردیف بودجه حذف شد', 'Budget item deleted'],
};

export function NotificationCenter({ language, onOpenProject }: { language: Language; onOpenProject: (notification: ProjectNotification) => void }) {
  const fa = language === 'fa';
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<NotificationInbox>({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.notifications();
        if (active) { setInbox(result); setError(false); }
      } catch {
        if (active) setError(true);
      } finally { if (active) setLoading(false); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('keydown', onKeyDown); };
  }, []);

  const markRead = async (notification: ProjectNotification) => {
    if (notification.readAt) return;
    try {
      const updated = await api.markNotificationRead(notification.id);
      setInbox((current) => ({
        notifications: current.notifications.map((item) => item.id === updated.id ? updated : item),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }));
    } catch { setError(true); }
  };

  const markAllRead = async () => {
    if (!inbox.unreadCount) return;
    try {
      await api.markAllNotificationsRead();
      const now = new Date().toISOString();
      setInbox((current) => ({ unreadCount: 0, notifications: current.notifications.map((item) => item.readAt ? item : { ...item, readAt: now }) }));
      setError(false);
    } catch { setError(true); }
  };

  const openNotification = async (notification: ProjectNotification) => {
    await markRead(notification);
    setOpen(false);
    onOpenProject(notification);
  };

  const eventLabel = (eventType: string) => activityLabels[eventType]?.[fa ? 0 : 1] ?? (fa ? 'پروژه به‌روزرسانی شد' : 'Project updated');
  const countLabel = inbox.unreadCount > 99 ? '99+' : inbox.unreadCount.toLocaleString(fa ? 'fa-IR' : 'en-US');

  return <div className="notification-wrap">
    <button className="notification-button" aria-label={fa ? `اعلان‌ها، ${inbox.unreadCount} خوانده‌نشده` : `Notifications, ${inbox.unreadCount} unread`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
      <Bell size={18} />{inbox.unreadCount > 0 && <span className="notification-unread-count">{countLabel}</span>}
    </button>
    {open && <section className="notification-popover" role="dialog" aria-label={fa ? 'اعلان‌های پروژه' : 'Project notifications'}>
      <header className="notification-heading"><div><strong>{fa ? 'اعلان‌های پروژه' : 'Project notifications'}</strong><small>{fa ? `${inbox.unreadCount.toLocaleString('fa-IR')} خوانده‌نشده` : `${inbox.unreadCount.toLocaleString('en-US')} unread`}</small></div><div><button className="notification-mark-all" onClick={() => void markAllRead()} disabled={!inbox.unreadCount}>{fa ? 'خواندن همه' : 'Mark all read'}</button><button className="icon-button" onClick={() => setOpen(false)} aria-label={fa ? 'بستن اعلان‌ها' : 'Close notifications'}><X size={15} /></button></div></header>
      {error && <div className="notification-error"><span>{fa ? 'بارگذاری اعلان‌ها انجام نشد.' : 'Could not load notifications.'}</span><button onClick={() => { setLoading(true); void api.notifications().then((result) => { setInbox(result); setError(false); }).catch(() => setError(true)).finally(() => setLoading(false)); }}>{fa ? 'تلاش دوباره' : 'Retry'}</button></div>}
      {loading ? <div className="notification-empty">{fa ? 'در حال بارگذاری…' : 'Loading…'}</div> : inbox.notifications.length ? <div className="notification-list">{inbox.notifications.map((notification) => <button key={notification.id} className={`notification-item ${notification.readAt ? '' : 'unread'}`} onClick={() => void openNotification(notification)}><span className="notification-item-mark">{notification.readAt ? <Circle size={8} /> : <span />}</span><span className="notification-item-copy"><strong>{notification.actorName} · {eventLabel(notification.eventType)}</strong><span>{notification.projectTitle}</span><time dateTime={notification.createdAt}>{new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}</time></span><ChevronLeft size={14} /></button>)}</div> : !error && <div className="notification-empty"><CheckCheck size={20} /><strong>{fa ? 'همه‌چیز به‌روز است' : 'You’re all caught up'}</strong><span>{fa ? 'رویدادهای تازه‌ی پروژه‌ها اینجا نمایش داده می‌شوند.' : 'New project activity will show up here.'}</span></div>}
    </section>}
  </div>;
}
