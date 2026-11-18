import { useEffect, useState, type FormEvent } from 'react';
import { Aperture, ArrowLeft, Languages, LockKeyhole, Mail, UserRound } from 'lucide-react';
import type { AuthUser } from '../../../shared/types';
import { api, setCsrfToken } from '../lib/api';
import type { Language } from '../lib/i18n';

type Mode = 'login' | 'register';

export function AuthScreen({ setupRequired, language, onLanguage, onAuthenticated, onRetry }: { setupRequired: boolean; language: Language; onLanguage: (language: Language) => void; onAuthenticated: (user: AuthUser) => void; onRetry: () => void }) {
  const fa = language === 'fa';
  const [mode, setMode] = useState<Mode>(setupRequired ? 'register' : 'login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (setupRequired) setMode('register'); }, [setupRequired]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setErrorMessage('');
    if (mode === 'register' && password !== confirmPassword) { setErrorMessage(fa ? 'تکرار گذرواژه با گذرواژه یکسان نیست.' : 'Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (mode === 'login' && pendingUser) {
        if (!invitationToken.trim()) { onAuthenticated(pendingUser); return; }
        const accepted = await api.acceptInvitation(invitationToken.trim());
        setCsrfToken(accepted.csrfToken); onAuthenticated(accepted.user); return;
      }
      const session = mode === 'login' ? await api.login(email, password) : await api.register({ displayName: displayName.trim(), email, password, invitationToken: invitationToken.trim() || undefined });
      setCsrfToken(session.csrfToken);
      if (mode === 'login' && invitationToken.trim()) {
        setPendingUser(session.user);
        try {
          const accepted = await api.acceptInvitation(invitationToken.trim());
          setCsrfToken(accepted.csrfToken); onAuthenticated(accepted.user); return;
        } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : (fa ? 'دعوت‌نامه پذیرفته نشد.' : 'The invitation could not be accepted.')); return; }
      }
      setCsrfToken(session.csrfToken); onAuthenticated(session.user);
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : (fa ? 'ارتباط با سرور برقرار نشد.' : 'Could not reach the server.')); }
    finally { setBusy(false); }
  };

  return <main className={`auth-screen ${fa ? '' : 'auth-english'}`} dir={fa ? 'rtl' : 'ltr'}>
    <section className="auth-brand-panel"><div className="auth-brand"><span className="brand-mark"><Aperture size={23} /></span><span><strong>{fa ? 'کادر' : 'Kadr'}</strong><small>{fa ? 'فضای کار فیلم‌سازی' : 'Filmmaking workspace'}</small></span></div><div className="auth-brand-copy"><span className="eyebrow">{fa ? 'هر قاب، یک داستان' : 'EVERY FRAME HAS A STORY'}</span><h1>{fa ? 'روایت را بساز، گروه را همراه کن.' : 'Shape the story. Bring the crew.'}</h1><p>{fa ? 'از نخستین ایده تا آخرین روز فیلم‌برداری، همه‌ی مسیر در یک فضای امن و منسجم.' : 'From first idea to final shoot day, keep the work in one focused, private space.'}</p><div className="auth-film-strip"><span /><span /><span /><span /><span /><span /><span /></div></div><div className="auth-brand-footer"><Aperture size={17} /><span>{fa ? 'ساخته‌شده برای قصه‌هایی که باید ساخته شوند.' : 'For stories ready to be made.'}</span></div></section>
    <section className="auth-form-panel"><button className="language-toggle auth-language" onClick={() => onLanguage(fa ? 'en' : 'fa')} aria-label={fa ? 'English' : 'فارسی'}><Languages size={15} />{fa ? 'EN' : 'فا'}</button><div className="auth-form-wrap"><div className="auth-mobile-brand"><span className="brand-mark"><Aperture size={22} /></span><strong>{fa ? 'کادر' : 'Kadr'}</strong></div><span className="eyebrow">{setupRequired ? (fa ? 'راه‌اندازی فضای کاری' : 'WORKSPACE SETUP') : mode === 'login' ? (fa ? 'خوش برگشتی' : 'WELCOME BACK') : (fa ? 'پذیرش دعوت‌نامه' : 'ACCEPT AN INVITATION')}</span><h2>{setupRequired ? (fa ? 'فضای کاری تو آماده‌ی شروع است.' : 'Set up your filmmaking workspace.') : mode === 'login' ? (fa ? 'ورود به کادر' : 'Sign in to Kadr') : (fa ? 'ساخت حساب همکار' : 'Create your collaborator account')}</h2><p className="auth-intro">{setupRequired ? (fa ? 'حساب نخست، مالک فضای کاری می‌شود و پروژه‌های محلی فعلی را در همان فضا نگه می‌دارد.' : 'The first account owns this workspace and keeps existing local projects in place.') : mode === 'login' ? (fa ? 'برای ادامه، اطلاعات حساب فضای کاری‌ات را وارد کن.' : 'Enter your workspace account details to continue.') : (fa ? 'برای ساخت حساب، از مدیر گروه دعوت‌نامه بگیر.' : 'Ask a workspace admin for an invitation token.')}</p>
      {pendingUser && <div className="auth-pending"><span>{fa ? 'ورود انجام شد؛ دعوت‌نامه را می‌توانی دوباره بررسی کنی یا ادامه بدهی.' : 'You are signed in. Retry the invitation or continue to your current workspace.'}</span><button className="button button-quiet" onClick={() => onAuthenticated(pendingUser)}>{fa ? 'ادامه بدون دعوت' : 'Continue without invite'}</button></div>}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>{mode === 'register' && <><label>{fa ? 'نام نمایشی' : 'Display name'}<span className="auth-input-wrap"><UserRound size={15} /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={120} /></span></label><label>{fa ? 'ایمیل حساب' : 'Account email'}<span className="auth-input-wrap"><Mail size={15} /><input dir="ltr" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>{!setupRequired && <label>{fa ? 'کد دعوت‌نامه' : 'Invitation token'}<span className="auth-input-wrap"><Aperture size={15} /><input dir="ltr" autoComplete="off" value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} required /></span></label>}</>}{mode === 'login' && <><label>{fa ? 'ایمیل حساب' : 'Account email'}<span className="auth-input-wrap"><Mail size={15} /><input dir="ltr" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>{!setupRequired && <label>{fa ? 'کد دعوت‌نامه (اختیاری)' : 'Invitation token (optional)'}<span className="auth-input-wrap"><Aperture size={15} /><input dir="ltr" autoComplete="off" value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} /></span></label>}</>}<label>{fa ? 'گذرواژه' : 'Password'}<span className="auth-input-wrap"><LockKeyhole size={15} /><input dir="ltr" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={1024} /></span>{mode === 'register' && <small>{fa ? 'دست‌کم ۱۰ نویسه' : 'At least 10 characters'}</small>}</label>{mode === 'register' && <label>{fa ? 'تکرار گذرواژه' : 'Confirm password'}<span className="auth-input-wrap"><LockKeyhole size={15} /><input dir="ltr" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={10} maxLength={1024} /></span></label>}{errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}<button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? '…' : mode === 'login' ? pendingUser ? (fa ? 'پذیرش دعوت‌نامه' : 'Accept invitation') : (fa ? 'ورود امن' : 'Sign in securely') : setupRequired ? (fa ? 'ساخت فضای کاری' : 'Create workspace') : (fa ? 'پذیرش دعوت و ساخت حساب' : 'Accept invite & create account')}<ArrowLeft size={15} /></button></form>
      {!setupRequired && <div className="auth-mode-switch">{mode === 'login' ? <><span>{fa ? 'حساب همکار نداری؟' : 'New to this workspace?'}</span><button onClick={() => { setMode('register'); setPendingUser(null); setErrorMessage(''); }}>{fa ? 'ساخت حساب با دعوت‌نامه' : 'Create account with invite'}</button></> : <><span>{fa ? 'از قبل حساب داری؟' : 'Already have an account?'}</span><button onClick={() => { setMode('login'); setPendingUser(null); setErrorMessage(''); }}>{fa ? 'ورود و پذیرش دعوت' : 'Sign in and accept invite'}</button></>}</div>}
      {setupRequired && <div className="auth-security-note"><LockKeyhole size={15} /><span>{fa ? 'گذرواژه با scrypt ذخیره می‌شود؛ نشست مرورگر HttpOnly است و اطلاعات پروژه روی همین سرور می‌ماند.' : 'Passwords are stored with scrypt; browser sessions use HttpOnly cookies and project data stays on this server.'}</span></div>}
      <button className="auth-retry-link" onClick={onRetry}>{fa ? 'تازه‌سازی وضعیت سرور' : 'Refresh server status'}</button>
    </div></section>
  </main>;
}
