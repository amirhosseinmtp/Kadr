import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { db } from './db.js';
import { budgetCategories, budgetCurrencies, projectDocumentCategories, projectWorkflowPhases, type AiAssistMode, type AiSuggestion, type AvailabilityStatus, type BudgetCategory, type BudgetCurrency, type BudgetItemStatus, type CallSheet, type ProjectBudgetItemInput, type ProjectDocument, type ProjectDocumentCategory, type ProjectWorkflowPhase, type ProductionScene, type SceneEnvironment, type SceneShootStatus, type SceneTimeOfDay, type ShootingDay } from '../../shared/types.js';
import { extractFountainSceneHeadings, parseSceneHeading } from './domain/scenes.js';
import { castForScheduledScenes } from './domain/call-sheet.js';
import { summarizeBudget } from './domain/budget.js';
import { configuredAiProvider } from './services/ai.js';
import { constantTimeEqual, createOpaqueToken, hashPassword, hashToken, verifyPassword } from './services/auth.js';
import type { AuthUser, WorkspaceRole } from '../../shared/types.js';

const app = express();
const port = Number(process.env.PORT ?? 5174);
const host = process.env.KADR_HOST ?? '127.0.0.1';
const uploadDirectory = path.resolve(process.env.KADR_UPLOAD_DIR ?? path.join(process.cwd(), 'server/data/uploads'));
const maxProjectFileBytes = 25 * 1024 * 1024;
const fileTypes: Record<string, { extension: string; category: ProjectDocumentCategory }> = {
  'application/pdf': { extension: '.pdf', category: 'reference' },
  'text/plain': { extension: '.txt', category: 'script' },
  'image/jpeg': { extension: '.jpg', category: 'image' },
  'image/png': { extension: '.png', category: 'image' },
  'image/webp': { extension: '.webp', category: 'image' },
  'image/gif': { extension: '.gif', category: 'image' },
  'video/mp4': { extension: '.mp4', category: 'video' },
  'video/quicktime': { extension: '.mov', category: 'video' },
  'audio/mpeg': { extension: '.mp3', category: 'audio' },
  'audio/wav': { extension: '.wav', category: 'audio' },
  'audio/x-wav': { extension: '.wav', category: 'audio' },
  'audio/mp4': { extension: '.m4a', category: 'audio' },
};
const extensionsByMime: Record<string, string[]> = {
  'application/pdf': ['.pdf'], 'text/plain': ['.txt', '.fountain'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'],
  'image/webp': ['.webp'], 'image/gif': ['.gif'], 'video/mp4': ['.mp4'], 'video/quicktime': ['.mov'],
  'audio/mpeg': ['.mp3'], 'audio/wav': ['.wav'], 'audio/x-wav': ['.wav'], 'audio/mp4': ['.m4a'],
};
app.use(express.json({ limit: '2mb' }));

const projectColumns = `id, title, format, status, progress, logline, synopsis, genre, duration_minutes AS durationMinutes, language_code AS languageCode, budget_currency AS budgetCurrency, director, writer, producer, target_date AS targetDate, created_at AS createdAt, updated_at AS updatedAt`;
const draftColumns = `id, project_id AS projectId, title, body, updated_at AS updatedAt`;
const roleColumns = `id, project_id AS projectId, character, description, status, candidate, created_at AS createdAt`;
const taskColumns = `t.id, t.project_id AS projectId, t.title, t.department, t.phase, t.due_date AS dueDate, t.status, t.priority, t.assignee_id AS assigneeId, m.name AS assigneeName, t.created_at AS createdAt`;
const sceneColumns = `s.id, s.project_id AS projectId, s.screenplay_order AS screenplayOrder, s.heading, s.environment, s.location, s.location_id AS locationId, s.time_of_day AS timeOfDay, s.characters_json AS charactersJson, s.props_json AS propsJson, s.costumes_json AS costumesJson, s.set_dressing_json AS setDressingJson, s.estimated_minutes AS estimatedMinutes, s.production_notes AS productionNotes, s.continuity_notes AS continuityNotes, s.shoot_status AS shootStatus, s.shooting_day_id AS shootingDayId, s.shooting_order AS shootingOrder, d.shoot_date AS shootingDate, d.title AS shootingDayTitle, s.created_at AS createdAt, s.updated_at AS updatedAt`;
const documentColumns = `d.id, d.project_id AS projectId, d.scene_id AS sceneId, s.heading AS sceneHeading, d.title, d.original_name AS originalName,
  d.category, d.content_type AS contentType, d.size_bytes AS sizeBytes, COALESCE(u.display_name, '') AS uploadedByName, d.created_at AS createdAt`;
const shootingDayColumns = `d.id, d.project_id AS projectId, d.shoot_date AS shootDate, d.title, d.call_time AS callTime, d.notes, COUNT(s.id) AS sceneCount, COALESCE(SUM(s.estimated_minutes), 0) AS totalEstimatedMinutes, d.created_at AS createdAt`;
const aiSuggestionColumns = `id, project_id AS projectId, draft_id AS draftId, mode, source_text AS sourceText, result, status, created_at AS createdAt, reviewed_at AS reviewedAt`;
const sceneEnvironments: SceneEnvironment[] = ['interior', 'exterior', 'mixed', 'unspecified'];
const sceneTimes: SceneTimeOfDay[] = ['day', 'night', 'dawn', 'dusk', 'unspecified'];
const sceneStatuses: SceneShootStatus[] = ['unplanned', 'scheduled', 'shot'];
const aiModes: AiAssistMode[] = ['screenplay-analysis', 'character-analysis', 'scene-breakdown', 'production-plan'];
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionCookie = 'kadr_session';

interface AuthContext { sessionId: string; userId: string; workspaceId: string; csrfToken: string; user: AuthUser; }
type AuthenticatedRequest = Request & { auth?: AuthContext; projectRole?: WorkspaceRole };

function error(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function projectExists(projectId: string) {
  return Boolean(db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId));
}

function cookieValue(req: Request, name: string): string | null {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function resolveAuth(req: Request): AuthContext | null {
  const token = cookieValue(req, sessionCookie);
  if (!token) return null;
  const session = db.prepare(`SELECT id AS sessionId, user_id AS userId, workspace_id AS workspaceId, csrf_token AS csrfToken
    FROM auth_sessions WHERE token_hash = ? AND expires_at > ?`).get(hashToken(token), new Date().toISOString()) as { sessionId: string; userId: string; workspaceId: string; csrfToken: string } | undefined;
  if (!session) return null;
  const user = db.prepare(`SELECT u.id, u.display_name AS displayName, u.email, w.id AS workspaceId, w.name AS workspaceName,
      COALESCE(wm.role, (SELECT pa.role FROM project_access pa JOIN projects p ON p.id = pa.project_id WHERE pa.user_id = u.id AND p.workspace_id = w.id ORDER BY pa.created_at LIMIT 1)) AS role,
      CASE WHEN wm.user_id IS NULL THEN 0 ELSE 1 END AS workspaceMember
    FROM users u JOIN workspaces w ON w.id = ? LEFT JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = u.id WHERE u.id = ?`).get(session.workspaceId, session.userId) as AuthUser | undefined;
  if (!user || !user.role) return null;
  return { ...session, user: { ...user, workspaceMember: Boolean(user.workspaceMember) } };
}

function activeAuth(req: Request): AuthContext | null { return (req as AuthenticatedRequest).auth ?? resolveAuth(req); }

function recordActivity(projectId: string, auth: AuthContext, eventType: string, entityType: string, entityId: string | null = null) {
  const activityId = randomUUID(); const createdAt = new Date().toISOString();
  const insertActivity = db.prepare(`INSERT INTO project_activity (id, project_id, actor_id, actor_name, event_type, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertNotification = db.prepare(`INSERT OR IGNORE INTO user_notifications (id, recipient_user_id, project_id, activity_id, created_at)
    VALUES (?, ?, ?, ?, ?)`);
  const recipients = db.prepare(`SELECT user_id AS userId FROM (
    SELECT wm.user_id FROM workspace_memberships wm JOIN projects p ON p.workspace_id = wm.workspace_id WHERE p.id = ?
    UNION SELECT pa.user_id FROM project_access pa WHERE pa.project_id = ?
  ) WHERE user_id <> ?`).all(projectId, projectId, auth.userId) as { userId: string }[];
  db.transaction(() => {
    insertActivity.run(activityId, projectId, auth.userId, auth.user.displayName, eventType, entityType, entityId, createdAt);
    for (const recipient of recipients) insertNotification.run(randomUUID(), recipient.userId, projectId, activityId, createdAt);
  })();
}

const notificationColumns = `n.id, n.project_id AS projectId, p.title AS projectTitle, a.actor_name AS actorName,
  a.event_type AS eventType, n.created_at AS createdAt, n.read_at AS readAt`;

function notificationAccessSql(alias = 'n') {
  return `EXISTS (SELECT 1 FROM projects access_project WHERE access_project.id = ${alias}.project_id AND access_project.workspace_id = ?
    AND (EXISTS (SELECT 1 FROM workspace_memberships access_member WHERE access_member.workspace_id = access_project.workspace_id AND access_member.user_id = ?)
      OR EXISTS (SELECT 1 FROM project_access access_role WHERE access_role.project_id = access_project.id AND access_role.user_id = ?)))`;
}

function projectAccessRole(userId: string, projectId: string, workspaceId: string): WorkspaceRole | null {
  const project = db.prepare('SELECT id, workspace_id AS workspaceId FROM projects WHERE id = ?').get(projectId) as { id: string; workspaceId: string | null } | undefined;
  if (!project) return null;
  if (project.workspaceId === workspaceId) {
    const member = db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) as { role: WorkspaceRole } | undefined;
    if (member) return member.role;
  }
  return (db.prepare('SELECT role FROM project_access WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { role: WorkspaceRole } | undefined)?.role ?? null;
}

function workspaceMembershipRole(auth: AuthContext): WorkspaceRole | null {
  return (db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(auth.workspaceId, auth.userId) as { role: WorkspaceRole } | undefined)?.role ?? null;
}

function canManageTalent(auth: AuthContext): boolean {
  return ['owner', 'admin', 'producer', 'casting_director'].includes(workspaceMembershipRole(auth) ?? '');
}

function canManageProductionLibrary(auth: AuthContext): boolean {
  return ['owner', 'admin', 'producer', 'director', 'production'].includes(workspaceMembershipRole(auth) ?? '');
}

function canSeeTalent(auth: AuthContext, talentId: string): boolean {
  if (workspaceMembershipRole(auth)) return Boolean(db.prepare('SELECT 1 FROM talent_profiles WHERE id = ? AND workspace_id = ?').get(talentId, auth.workspaceId));
  return Boolean(db.prepare(`SELECT 1 FROM talent_profiles t JOIN casting_assignments a ON a.talent_id = t.id
    JOIN casting_roles r ON r.id = a.role_id JOIN project_access pa ON pa.project_id = r.project_id
    WHERE t.id = ? AND t.workspace_id = ? AND pa.user_id = ?`).get(talentId, auth.workspaceId, auth.userId));
}

function canEditCategory(role: WorkspaceRole, category: 'project' | 'screenplay' | 'casting' | 'production' | 'scene' | 'ai' | 'team' | 'workspace' | 'discussion' | 'documents') {
  if (['owner', 'admin', 'producer'].includes(role)) return true;
  const allowed: Record<typeof category, WorkspaceRole[]> = {
    project: ['director'], screenplay: ['director', 'writer'], casting: ['casting_director'],
    production: ['director', 'production'], scene: ['director', 'writer', 'production'],
    ai: ['director', 'writer'], team: [], workspace: [], discussion: ['director', 'writer', 'casting_director', 'production'],
    documents: ['director', 'writer', 'casting_director', 'production'],
  };
  return allowed[category].includes(role);
}

function setAuthSession(userId: string, workspaceId: string, res: Response) {
  const token = createOpaqueToken(); const csrfToken = createOpaqueToken(); const now = new Date();
  db.prepare('INSERT INTO auth_sessions (id, user_id, workspace_id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, workspaceId, hashToken(token), csrfToken, now.toISOString(), new Date(now.getTime() + sessionLifetimeMs).toISOString());
  setSessionCookie(res, token);
  const auth = resolveAuth({ headers: { cookie: `${sessionCookie}=${encodeURIComponent(token)}` } } as Request);
  return auth ? { user: auth.user, csrfToken } : null;
}

function requireProjectAccess(req: Request, res: Response, next: (error?: unknown) => void) {
  const auth = activeAuth(req); const projectId = String(req.params.projectId ?? '');
  if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  const role = projectAccessRole(auth.userId, projectId, auth.workspaceId);
  if (!role) return error(res, 404, 'پروژه پیدا نشد.');
  (req as AuthenticatedRequest).projectRole = role;
  if (req.method !== 'GET') {
    const path = req.originalUrl.split('?')[0].slice(`/api/projects/${projectId}`.length);
    const category = path.startsWith('/drafts') ? 'screenplay' : path.startsWith('/roles') ? 'casting' : path.startsWith('/budget') ? 'production' : path.startsWith('/documents') ? 'documents' : path.startsWith('/tasks') || path.startsWith('/shooting-days') || path.startsWith('/members') ? (path.startsWith('/members') ? 'team' : 'production') : path.startsWith('/scenes') ? 'scene' : path.startsWith('/ai-') ? 'ai' : path.startsWith('/comments') ? 'discussion' : 'project';
    if (!path.startsWith('/personal-note') && !canEditCategory(role, category)) return error(res, 403, 'نقش شما اجازه‌ی ویرایش این بخش را نمی‌دهد.');
  }
  next();
}

function protectChildProject(table: 'screenplay_drafts' | 'casting_roles' | 'production_tasks' | 'production_scenes' | 'shooting_days' | 'ai_suggestions' | 'casting_assignments' | 'project_comments' | 'project_budget_items' | 'project_documents', idParameter: string) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    const auth = activeAuth(req); if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
    const id = req.params[idParameter];
    let projectId: string | undefined;
    if (table === 'casting_assignments') projectId = (db.prepare('SELECT r.project_id AS projectId FROM casting_assignments a JOIN casting_roles r ON r.id = a.role_id WHERE a.id = ?').get(id) as { projectId: string } | undefined)?.projectId;
    else projectId = (db.prepare(`SELECT project_id AS projectId FROM ${table} WHERE id = ?`).get(id) as { projectId: string } | undefined)?.projectId;
    if (!projectId) return error(res, 404, 'رکورد پیدا نشد.');
    const role = projectAccessRole(auth.userId, projectId, auth.workspaceId);
    if (!role) return error(res, 404, 'رکورد پیدا نشد.');
    (req as AuthenticatedRequest).projectRole = role;
    if (req.method !== 'GET') {
      const category = table === 'project_comments' ? 'discussion' : table === 'screenplay_drafts' ? 'screenplay' : table === 'project_documents' ? 'documents' : table === 'casting_roles' || table === 'casting_assignments' ? 'casting' : table === 'production_tasks' || table === 'shooting_days' || table === 'project_budget_items' ? 'production' : table === 'ai_suggestions' ? 'ai' : 'scene';
      if (!canEditCategory(role, category)) return error(res, 403, 'نقش شما اجازه‌ی ویرایش این بخش را نمی‌دهد.');
    }
    next();
  };
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodedHeader(value: string | undefined) {
  if (!value) return '';
  try { return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
  catch { return ''; }
}

function safeDocumentFilename(value: string) {
  const basename = value.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  return basename.replace(/\s+/g, ' ').slice(0, 255);
}

function documentFilePath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|txt|jpg|jpeg|png|webp|gif|mp4|mov|mp3|wav|m4a)$/i.test(storageKey)) return null;
  const fullPath = path.resolve(uploadDirectory, storageKey);
  return fullPath.startsWith(`${uploadDirectory}${path.sep}`) ? fullPath : null;
}

function validFileSignature(contentType: string, bytes: Buffer) {
  if (contentType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (contentType === 'video/mp4' || contentType === 'video/quicktime' || contentType === 'audio/mp4') return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  if (contentType === 'audio/mpeg') return bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  if (contentType === 'text/plain') {
    if (bytes.includes(0)) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
  }
  return false;
}

function stringList(value: unknown, fallback: string[] = []): string[] | null {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || item.length > 200)) return null;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 250 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= 1024;
}

function issueSession(userId: string, workspaceId: string, res: Response) {
  const created = setAuthSession(userId, workspaceId, res);
  if (!created) return error(res, 500, 'نشست کاربری ساخته نشد.');
  return res.json({ authenticated: true, setupRequired: false, ...created });
}

app.get('/api/auth/session', (req, res) => {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  const auth = resolveAuth(req);
  if (auth) return res.json({ setupRequired: false, authenticated: true, user: auth.user, csrfToken: auth.csrfToken });
  if (cookieValue(req, sessionCookie)) clearSessionCookie(res);
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  res.json({ setupRequired: count.count === 0, authenticated: false });
});

app.post('/api/auth/register', (req, res) => {
  const email = normalizedEmail(req.body.email);
  const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  const password = req.body.password;
  if (!email || !displayName || displayName.length > 120 || !validPassword(password)) return error(res, 400, 'نام، ایمیل معتبر و گذرواژه‌ی دست‌کم ۱۰ نویسه‌ای لازم است.');
  const invitationToken = typeof req.body.invitationToken === 'string' ? req.body.invitationToken.trim() : '';
  let workspaceId = '';
  const userId = randomUUID(); const now = new Date().toISOString();
  try {
    const registration = db.transaction(() => {
      const currentUserCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
      if (currentUserCount === 0) {
        if (invitationToken) throw new Error('bootstrap_invite_not_allowed');
        workspaceId = randomUUID();
        db.prepare('INSERT INTO users (id, display_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, displayName, email, hashPassword(password), now);
        db.prepare('INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, `${displayName} · Kadr`, userId, now);
        db.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, userId, 'owner', now);
        db.prepare('UPDATE projects SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
        db.prepare('UPDATE talent_profiles SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
        db.prepare('UPDATE production_locations SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
        db.prepare('UPDATE production_resources SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
        return;
      }
      if (!invitationToken) throw new Error('invitation_required');
      const invitation = db.prepare(`SELECT id, workspace_id AS workspaceId, project_id AS projectId, role
        FROM workspace_invitations WHERE token_hash = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?`).get(hashToken(invitationToken), email, now) as { id: string; workspaceId: string; projectId: string | null; role: WorkspaceRole } | undefined;
      if (!invitation) throw new Error('invalid_invitation');
      db.prepare('INSERT INTO users (id, display_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, displayName, email, hashPassword(password), now);
      if (invitation.projectId) db.prepare('INSERT INTO project_access (project_id, user_id, role, created_by, created_at) VALUES (?, ?, ?, NULL, ?)').run(invitation.projectId, userId, invitation.role, now);
      else db.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(invitation.workspaceId, userId, invitation.role, now);
      db.prepare('UPDATE workspace_invitations SET accepted_at = ? WHERE id = ?').run(now, invitation.id);
      workspaceId = invitation.workspaceId;
    });
    registration();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : '';
    if (reason === 'invitation_required') return error(res, 403, 'برای ساخت حساب تازه، دعوت‌نامه‌ی معتبر لازم است.');
    if (reason === 'invalid_invitation') return error(res, 400, 'دعوت‌نامه معتبر نیست، منقضی شده یا برای این ایمیل صادر نشده است.');
    if (reason === 'bootstrap_invite_not_allowed') return error(res, 400, 'برای ساخت فضای کاری نخست، کد دعوت لازم نیست.');
    if (String(cause).includes('UNIQUE constraint failed: users.email')) return error(res, 409, 'برای این ایمیل حساب کاربری وجود دارد.');
    return error(res, 500, 'ساخت حساب انجام نشد.');
  }
  return issueSession(userId, workspaceId, res);
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizedEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || password.length > 1024) return error(res, 401, 'ایمیل یا گذرواژه درست نیست.');
  const remoteHash = hashToken(req.ip || 'local');
  const attempt = db.prepare('SELECT failed_count AS failedCount, locked_until AS lockedUntil FROM auth_login_attempts WHERE email = ? AND remote_hash = ?').get(email, remoteHash) as { failedCount: number; lockedUntil: string | null } | undefined;
  if (attempt?.lockedUntil && Date.parse(attempt.lockedUntil) > Date.now()) return error(res, 429, 'ورود موقتاً محدود شده است. کمی بعد دوباره تلاش کنید.');
  const account = db.prepare('SELECT id, password_hash AS passwordHash FROM users WHERE email = ?').get(email) as { id: string; passwordHash: string } | undefined;
  if (!account || !verifyPassword(password, account.passwordHash)) {
    const failedCount = (attempt?.failedCount ?? 0) + 1;
    const lockedUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    db.prepare(`INSERT INTO auth_login_attempts (email, remote_hash, failed_count, locked_until) VALUES (?, ?, ?, ?)
      ON CONFLICT(email, remote_hash) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until`).run(email, remoteHash, lockedUntil ? 0 : failedCount, lockedUntil);
    return error(res, 401, 'ایمیل یا گذرواژه درست نیست.');
  }
  db.prepare('DELETE FROM auth_login_attempts WHERE email = ? AND remote_hash = ?').run(email, remoteHash);
  const membership = db.prepare(`SELECT workspace_id AS workspaceId FROM workspace_memberships WHERE user_id = ? ORDER BY created_at LIMIT 1`).get(account.id) as { workspaceId: string } | undefined;
  const scopedProject = !membership ? db.prepare(`SELECT p.workspace_id AS workspaceId FROM project_access pa JOIN projects p ON p.id = pa.project_id WHERE pa.user_id = ? ORDER BY pa.created_at LIMIT 1`).get(account.id) as { workspaceId: string } | undefined : undefined;
  const workspaceId = membership?.workspaceId ?? scopedProject?.workspaceId;
  if (!workspaceId) return error(res, 403, 'این حساب هنوز به فضای کاری‌ای دسترسی ندارد.');
  return issueSession(account.id, workspaceId, res);
});

app.post('/api/auth/logout', (req, res) => {
  const auth = resolveAuth(req);
  if (auth) {
    const csrf = req.get('x-csrf-token') ?? '';
    if (!constantTimeEqual(csrf, auth.csrfToken)) return error(res, 403, 'درخواست خروج معتبر نیست.');
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(auth.sessionId);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  const auth = resolveAuth(req);
  if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const csrf = req.get('x-csrf-token') ?? '';
    if (!constantTimeEqual(csrf, auth.csrfToken)) return error(res, 403, 'درخواست معتبر نیست. صفحه را تازه‌سازی کنید.');
  }
  (req as AuthenticatedRequest).auth = auth;
  next();
});

app.use('/api/projects/:projectId', requireProjectAccess);
app.use('/api/drafts/:draftId', protectChildProject('screenplay_drafts', 'draftId'));
app.use('/api/roles/:roleId', protectChildProject('casting_roles', 'roleId'));
app.use('/api/tasks/:taskId', protectChildProject('production_tasks', 'taskId'));
app.use('/api/scenes/:sceneId', protectChildProject('production_scenes', 'sceneId'));
app.use('/api/shooting-days/:dayId', protectChildProject('shooting_days', 'dayId'));
app.use('/api/ai-suggestions/:suggestionId', protectChildProject('ai_suggestions', 'suggestionId'));
app.use('/api/casting-assignments/:assignmentId', protectChildProject('casting_assignments', 'assignmentId'));
app.use('/api/comments/:commentId', protectChildProject('project_comments', 'commentId'));
app.use('/api/budget-items/:itemId', protectChildProject('project_budget_items', 'itemId'));
app.use('/api/documents/:documentId', protectChildProject('project_documents', 'documentId'));

app.use('/api/talents/:talentId', (req, res, next) => {
  const auth = activeAuth(req); if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  if (!canSeeTalent(auth, req.params.talentId)) return error(res, 404, 'پروفایل پیدا نشد.');
  const privateRoute = req.path.endsWith('/private');
  const workspaceRole = workspaceMembershipRole(auth);
  const privateProjectAccess = privateRoute && Boolean(db.prepare(`SELECT 1 FROM casting_assignments a JOIN casting_roles r ON r.id = a.role_id
    JOIN project_access pa ON pa.project_id = r.project_id WHERE a.talent_id = ? AND pa.user_id = ? AND pa.role = 'casting_director'`)
    .get(req.params.talentId, auth.userId));
  if (privateRoute && !canManageTalent(auth) && !privateProjectAccess) return error(res, 403, 'برای اطلاعات خصوصی دسترسی لازم را ندارید.');
  if (req.method !== 'GET' && !canManageTalent(auth)) return error(res, 403, 'برای ویرایش پروفایل دسترسی لازم را ندارید.');
  next();
});
app.use('/api/locations/:locationId', (req, res, next) => {
  const auth = activeAuth(req); if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  const visible = workspaceMembershipRole(auth) ? db.prepare('SELECT 1 FROM production_locations WHERE id = ? AND workspace_id = ?').get(req.params.locationId, auth.workspaceId) : db.prepare(`SELECT 1 FROM production_locations l JOIN production_scenes s ON s.location_id = l.id
    JOIN projects p ON p.id = s.project_id JOIN project_access pa ON pa.project_id = p.id WHERE l.id = ? AND l.workspace_id = ? AND pa.user_id = ?`).get(req.params.locationId, auth.workspaceId, auth.userId);
  if (!visible) return error(res, 404, 'لوکیشن پیدا نشد.');
  if (req.method !== 'GET' && !canManageProductionLibrary(auth)) return error(res, 403, 'برای ویرایش لوکیشن دسترسی لازم را ندارید.');
  next();
});
app.use('/api/resources/:resourceId', (req, res, next) => {
  const auth = activeAuth(req); if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  const visible = workspaceMembershipRole(auth) ? db.prepare('SELECT 1 FROM production_resources WHERE id = ? AND workspace_id = ?').get(req.params.resourceId, auth.workspaceId) : db.prepare(`SELECT 1 FROM production_resources r JOIN scene_resources sr ON sr.resource_id = r.id
    JOIN production_scenes s ON s.id = sr.scene_id JOIN projects p ON p.id = s.project_id JOIN project_access pa ON pa.project_id = p.id
    WHERE r.id = ? AND r.workspace_id = ? AND pa.user_id = ?`).get(req.params.resourceId, auth.workspaceId, auth.userId);
  if (!visible) return error(res, 404, 'منبع پیدا نشد.');
  if (req.method !== 'GET' && !canManageProductionLibrary(auth)) return error(res, 403, 'برای ویرایش منابع دسترسی لازم را ندارید.');
  next();
});

app.post('/api/auth/accept-invitation', (req, res) => {
  const auth = activeAuth(req)!;
  const token = typeof req.body.invitationToken === 'string' ? req.body.invitationToken.trim() : '';
  if (!token || token.length > 256) return error(res, 400, 'کد دعوت‌نامه معتبر نیست.');
  const invitation = db.prepare(`SELECT id, workspace_id AS workspaceId, project_id AS projectId, role
    FROM workspace_invitations WHERE token_hash = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?`)
    .get(hashToken(token), auth.user.email.toLowerCase(), new Date().toISOString()) as { id: string; workspaceId: string; projectId: string | null; role: WorkspaceRole } | undefined;
  if (!invitation) return error(res, 400, 'دعوت‌نامه معتبر نیست، منقضی شده یا برای ایمیل این حساب صادر نشده است.');
  try {
    db.transaction(() => {
      if (invitation.projectId) {
        db.prepare(`INSERT INTO project_access (project_id, user_id, role, created_by, created_at)
          VALUES (?, ?, ?, NULL, ?) ON CONFLICT(project_id, user_id) DO NOTHING`).run(invitation.projectId, auth.userId, invitation.role, new Date().toISOString());
      } else {
        db.prepare(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO NOTHING`).run(invitation.workspaceId, auth.userId, invitation.role, new Date().toISOString());
      }
      db.prepare('UPDATE workspace_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL').run(new Date().toISOString(), invitation.id);
      db.prepare('UPDATE auth_sessions SET workspace_id = ? WHERE id = ?').run(invitation.workspaceId, auth.sessionId);
    })();
  } catch { return error(res, 500, 'پذیرش دعوت‌نامه انجام نشد.'); }
  const updatedAuth = resolveAuth(req);
  if (!updatedAuth) return error(res, 500, 'نشست پس از پذیرش دعوت‌نامه بازیابی نشد.');
  res.json({ user: updatedAuth.user, csrfToken: updatedAuth.csrfToken });
});

app.get('/api/workspaces', (req, res) => {
  const auth = activeAuth(req)!;
  const workspaces = db.prepare(`SELECT w.id, w.name,
      COALESCE((SELECT wm.role FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ?),
        (SELECT pa.role FROM project_access pa JOIN projects p ON p.id = pa.project_id WHERE pa.user_id = ? AND p.workspace_id = w.id ORDER BY pa.created_at LIMIT 1)) AS role
    FROM workspaces w WHERE EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ?)
      OR EXISTS (SELECT 1 FROM project_access pa JOIN projects p ON p.id = pa.project_id WHERE p.workspace_id = w.id AND pa.user_id = ?)
    ORDER BY w.name COLLATE NOCASE`).all(auth.userId, auth.userId, auth.userId, auth.userId);
  res.json(workspaces);
});

app.post('/api/workspaces', (req, res) => {
  const auth = activeAuth(req)!;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 100) return error(res, 400, 'نام فضای کاری باید بین ۲ تا ۱۰۰ نویسه باشد.');
  const workspaceId = randomUUID(); const now = new Date().toISOString();
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, name, auth.userId, now);
      db.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, auth.userId, 'owner', now);
      db.prepare('UPDATE auth_sessions SET workspace_id = ? WHERE id = ?').run(workspaceId, auth.sessionId);
    })();
  } catch { return error(res, 500, 'فضای کاری ساخته نشد.'); }
  const updatedAuth = resolveAuth(req);
  if (!updatedAuth) return error(res, 500, 'فضای کاری ساخته شد اما نشست فعال نشد.');
  res.status(201).json({ user: updatedAuth.user, csrfToken: updatedAuth.csrfToken });
});

app.post('/api/auth/select-workspace', (req, res) => {
  const auth = activeAuth(req)!;
  const workspaceId = typeof req.body.workspaceId === 'string' ? req.body.workspaceId : '';
  if (!workspaceId || !db.prepare(`SELECT id FROM workspaces w WHERE w.id = ? AND (
    EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ?)
    OR EXISTS (SELECT 1 FROM project_access pa JOIN projects p ON p.id = pa.project_id WHERE p.workspace_id = w.id AND pa.user_id = ?)
  )`).get(workspaceId, auth.userId, auth.userId)) return error(res, 404, 'فضای کاری پیدا نشد یا دسترسی ندارید.');
  db.prepare('UPDATE auth_sessions SET workspace_id = ? WHERE id = ?').run(workspaceId, auth.sessionId);
  const updatedAuth = resolveAuth(req);
  if (!updatedAuth) return error(res, 500, 'فضای کاری فعال بازیابی نشد.');
  res.json({ user: updatedAuth.user, csrfToken: updatedAuth.csrfToken });
});

app.get('/api/workspace', (req, res) => {
  const auth = activeAuth(req)!;
  const workspace = db.prepare('SELECT id, name, created_at AS createdAt FROM workspaces WHERE id = ?').get(auth.workspaceId) as Record<string, unknown> | undefined;
  const workspaceRole = db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(auth.workspaceId, auth.userId);
  const members = workspaceRole ? db.prepare(`SELECT u.id AS userId, u.display_name AS displayName, u.email, wm.role, wm.created_at AS joinedAt
    FROM workspace_memberships wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name COLLATE NOCASE`).all(auth.workspaceId) : [];
  res.json({ ...(workspace ?? {}), members, currentUserId: auth.userId, currentRole: auth.user.role });
});

app.get('/api/workspace/invitations', (req, res) => {
  const auth = activeAuth(req)!;
  if (!['owner', 'admin', 'producer'].includes(auth.user.role)) return error(res, 403, 'برای مدیریت دعوت‌ها دسترسی لازم را ندارید.');
  const workspaceAdmin = db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(auth.workspaceId, auth.userId);
  const rows = db.prepare(`SELECT id, email, role, project_id AS projectId, expires_at AS expiresAt, created_at AS createdAt
    FROM workspace_invitations WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? AND (? = 1 OR created_by = ?) ORDER BY created_at DESC`).all(auth.workspaceId, new Date().toISOString(), workspaceAdmin ? 1 : 0, auth.userId);
  res.json(rows);
});

app.post('/api/workspace/invitations', (req, res) => {
  const auth = activeAuth(req)!;
  if (!['owner', 'admin', 'producer'].includes(auth.user.role)) return error(res, 403, 'برای دعوت همکار دسترسی لازم را ندارید.');
  const email = normalizedEmail(req.body.email);
  const role = typeof req.body.role === 'string' ? req.body.role as WorkspaceRole : null;
  const projectId = typeof req.body.projectId === 'string' && req.body.projectId ? req.body.projectId : null;
  const inviteRoles: WorkspaceRole[] = ['admin', 'producer', 'director', 'writer', 'casting_director', 'production', 'viewer'];
  if (!email || !role || !inviteRoles.includes(role)) return error(res, 400, 'ایمیل یا نقش دعوت معتبر نیست.');
  if (projectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, auth.workspaceId);
    if (!project) return error(res, 404, 'پروژه پیدا نشد.');
    if (role === 'admin') return error(res, 400, 'برای دعوت پروژه‌ای از نقش مدیر فضای کاری استفاده نکنید.');
    const currentProjectRole = projectAccessRole(auth.userId, projectId, auth.workspaceId);
    if (!currentProjectRole || !['owner', 'admin', 'producer'].includes(currentProjectRole)) return error(res, 403, 'برای دعوت به این پروژه دسترسی لازم را ندارید.');
  } else if (!db.prepare('SELECT 1 FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(auth.workspaceId, auth.userId)) return error(res, 403, 'عضویت فضای کاری برای دعوت سراسری لازم است.');
  const token = createOpaqueToken(); const id = randomUUID(); const now = new Date(); const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO workspace_invitations (id, workspace_id, project_id, email, role, token_hash, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, auth.workspaceId, projectId, email, role, hashToken(token), expiresAt, auth.userId, now.toISOString());
  res.status(201).json({ id, email, role, projectId, expiresAt, invitationToken: token });
});

app.delete('/api/workspace/invitations/:invitationId', (req, res) => {
  const auth = activeAuth(req)!;
  if (!['owner', 'admin', 'producer'].includes(auth.user.role)) return error(res, 403, 'برای لغو دعوت دسترسی لازم را ندارید.');
  const workspaceAdmin = db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?').get(auth.workspaceId, auth.userId);
  const result = db.prepare(`DELETE FROM workspace_invitations WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND (? = 1 OR created_by = ?)`)
    .run(req.params.invitationId, auth.workspaceId, workspaceAdmin ? 1 : 0, auth.userId);
  if (!result.changes) return error(res, 404, 'دعوت پیدا نشد یا پذیرفته شده است.');
  res.status(204).end();
});

function mapScene(row: Record<string, unknown>): ProductionScene {
  return {
    ...row,
    characters: JSON.parse(String(row.charactersJson)) as string[],
    props: JSON.parse(String(row.propsJson)) as string[],
    costumes: JSON.parse(String(row.costumesJson)) as string[],
    setDressing: JSON.parse(String(row.setDressingJson)) as string[],
  } as unknown as ProductionScene;
}

function mapAiSuggestion(row: unknown): AiSuggestion { return row as AiSuggestion; }

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/projects', (req, res) => {
  const auth = activeAuth(req)!;
  const projects = workspaceMembershipRole(auth)
    ? db.prepare(`SELECT ${projectColumns} FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC`).all(auth.workspaceId)
    : db.prepare(`SELECT ${projectColumns} FROM projects WHERE workspace_id = ? AND id IN (SELECT project_id FROM project_access WHERE user_id = ?) ORDER BY updated_at DESC`).all(auth.workspaceId, auth.userId);
  res.json(projects);
});

app.get('/api/projects/:projectId/permissions', (req, res) => {
  const role = (req as AuthenticatedRequest).projectRole ?? 'viewer';
  res.json({
    role,
    canComment: canEditCategory(role, 'discussion'),
    canManageTeam: canEditCategory(role, 'team'),
    canInvite: ['owner', 'admin', 'producer'].includes(role),
  });
});

function readProjectDocuments(projectId: string): ProjectDocument[] {
  const rows = db.prepare(`SELECT ${documentColumns} FROM project_documents d
    LEFT JOIN production_scenes s ON s.id = d.scene_id LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.project_id = ? ORDER BY d.created_at DESC`).all(projectId) as Omit<ProjectDocument, 'downloadUrl'>[];
  return rows.map((document) => ({ ...document, downloadUrl: `/api/documents/${document.id}/file` }));
}

app.get('/api/projects/:projectId/documents', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(readProjectDocuments(req.params.projectId));
});

app.post('/api/projects/:projectId/documents', express.raw({ type: '*/*', limit: maxProjectFileBytes }), async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxProjectFileBytes) return error(res, 400, 'فایل خالی یا بزرگ‌تر از حد مجاز است.');
  const originalName = safeDocumentFilename(decodedHeader(req.get('x-original-name')));
  if (!originalName) return error(res, 400, 'نام فایل معتبر نیست.');
  const originalExtension = path.extname(originalName).toLowerCase();
  const requestedType = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const inferredType = Object.entries(extensionsByMime).find(([, extensions]) => extensions.includes(originalExtension))?.[0];
  const contentType = !requestedType || requestedType === 'application/octet-stream' ? inferredType ?? '' : requestedType;
  const fileType = fileTypes[contentType];
  if (!fileType || (originalExtension && !extensionsByMime[contentType]?.includes(originalExtension)) || !validFileSignature(contentType, bytes)) return error(res, 400, 'قالب فایل پشتیبانی نمی‌شود یا محتوای آن با نوع اعلام‌شده سازگار نیست.');
  const title = decodedHeader(req.get('x-document-title')) || originalName.replace(/\.[^.]*$/, '');
  if (!title || title.length > 180) return error(res, 400, 'عنوان فایل باید بین ۱ تا ۱۸۰ نویسه باشد.');
  const requestedCategory = decodedHeader(req.get('x-document-category'));
  const category = requestedCategory || fileType.category;
  if (!projectDocumentCategories.includes(category as ProjectDocumentCategory)) return error(res, 400, 'دسته‌ی فایل معتبر نیست.');
  const sceneId = decodedHeader(req.get('x-document-scene')) || null;
  if (sceneId && !db.prepare('SELECT id FROM production_scenes WHERE id = ? AND project_id = ?').get(sceneId, projectId)) return error(res, 400, 'صحنه به این پروژه تعلق ندارد.');
  const auth = activeAuth(req)!; const id = randomUUID(); const storageKey = `${id}${fileType.extension}`; const filePath = documentFilePath(storageKey)!; const now = new Date().toISOString();
  try {
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch { return error(res, 500, 'ذخیره‌ی فایل روی دیسک انجام نشد.'); }
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO project_documents (id, project_id, scene_id, uploaded_by, title, original_name, category, content_type, size_bytes, storage_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, sceneId, auth.userId, title, originalName, category, contentType, bytes.length, storageKey, now);
      recordActivity(projectId, auth, 'project.document_uploaded', 'document', id);
    })();
  } catch {
    await unlink(filePath).catch(() => undefined);
    return error(res, 500, 'ثبت فایل در پروژه انجام نشد.');
  }
  res.status(201).json(readProjectDocuments(projectId).find((document) => document.id === id));
});

app.get('/api/documents/:documentId/file', (req, res) => {
  const document = db.prepare('SELECT original_name AS originalName, size_bytes AS sizeBytes, storage_key AS storageKey FROM project_documents WHERE id = ?').get(req.params.documentId) as { originalName: string; sizeBytes: number; storageKey: string } | undefined;
  if (!document) return error(res, 404, 'فایل پیدا نشد.');
  const filePath = documentFilePath(document.storageKey);
  if (!filePath) return error(res, 404, 'فایل پیدا نشد.');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', document.sizeBytes);
  res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = createReadStream(filePath);
  stream.on('error', () => { if (!res.headersSent) error(res, 404, 'فایل پیدا نشد.'); else res.destroy(); });
  stream.pipe(res);
});

app.delete('/api/documents/:documentId', async (req, res) => {
  const document = db.prepare('SELECT id, project_id AS projectId, storage_key AS storageKey FROM project_documents WHERE id = ?').get(req.params.documentId) as { id: string; projectId: string; storageKey: string } | undefined;
  if (!document) return error(res, 404, 'فایل پیدا نشد.');
  const auth = activeAuth(req)!; const filePath = documentFilePath(document.storageKey);
  if (!filePath) return error(res, 500, 'مسیر ذخیره‌ی فایل معتبر نیست.');
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM project_documents WHERE id = ?').run(document.id);
      recordActivity(document.projectId, auth, 'project.document_deleted', 'document', document.id);
    })();
  } catch { return error(res, 500, 'حذف فایل از پروژه انجام نشد.'); }
  try { await unlink(filePath); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') return error(res, 500, 'رکورد حذف شد، اما پاک‌سازی فایل از دیسک انجام نشد.'); }
  res.status(204).end();
});

app.post('/api/projects', (req, res) => {
  const auth = activeAuth(req)!;
  const workspaceRole = workspaceMembershipRole(auth);
  if (!workspaceRole || !canEditCategory(workspaceRole, 'project')) return error(res, 403, 'نقش فضای کاری شما اجازه‌ی ساخت پروژه را نمی‌دهد.');
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 160) return error(res, 400, 'نام پروژه الزامی است و باید کمتر از ۱۶۰ نویسه باشد.');
  const allowedFormats = ['feature', 'short', 'series', 'documentary', 'commercial'];
  const format = allowedFormats.includes(req.body.format) ? req.body.format : 'feature';
  if (typeof req.body.logline === 'string' && req.body.logline.length > 500) return error(res, 400, 'خلاصه‌ی یک‌خطی بیش از حد طولانی است.');
  const logline = typeof req.body.logline === 'string' ? req.body.logline.trim() : '';
  const genre = typeof req.body.genre === 'string' ? req.body.genre.trim().slice(0, 100) : '';
  const languageCode = typeof req.body.languageCode === 'string' && ['fa', 'en', 'other'].includes(req.body.languageCode) ? req.body.languageCode : 'fa';
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO projects (id, title, format, logline, genre, language_code, workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, title.slice(0, 160), format, logline, genre, languageCode, auth.workspaceId, now, now);
  recordActivity(id, auth, 'project.created', 'project', id);
  res.status(201).json(db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(id));
});

app.patch('/api/projects/:projectId', (req, res) => {
  if (!canEditCategory((req as AuthenticatedRequest).projectRole ?? 'viewer', 'project')) return error(res, 403, 'نقش شما اجازه‌ی ویرایش مشخصات پروژه را نمی‌دهد.');
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const sets: string[] = [];
  const values: unknown[] = [];
  const allowedStatuses = ['development', 'pre-production', 'production', 'post-production', 'completed'];
  if (typeof req.body.status === 'string' && allowedStatuses.includes(req.body.status)) {
    sets.push('status = ?'); values.push(req.body.status);
  }
  if (Number.isInteger(req.body.progress) && req.body.progress >= 0 && req.body.progress <= 100) {
    sets.push('progress = ?'); values.push(req.body.progress);
  }
  if (req.body.title !== undefined && (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.length > 160)) return error(res, 400, 'نام پروژه معتبر نیست.');
  if (typeof req.body.title === 'string' && req.body.title.trim()) {
    sets.push('title = ?'); values.push(req.body.title.trim());
  }
  if (req.body.logline !== undefined && (typeof req.body.logline !== 'string' || req.body.logline.length > 500)) return error(res, 400, 'خلاصه‌ی یک‌خطی معتبر نیست.');
  if (typeof req.body.logline === 'string') { sets.push('logline = ?'); values.push(req.body.logline.trim()); }
  const projectTextFields = [['synopsis', 'synopsis', 8000], ['genre', 'genre', 100], ['director', 'director', 160], ['writer', 'writer', 160], ['producer', 'producer', 160]] as const;
  for (const [key, column, max] of projectTextFields) {
    if (req.body[key] !== undefined) {
      if (typeof req.body[key] !== 'string' || req.body[key].length > max) return error(res, 400, 'یکی از مشخصات پروژه معتبر نیست.');
      sets.push(`${column} = ?`); values.push(req.body[key].trim());
    }
  }
  if (req.body.durationMinutes !== undefined) {
    if (req.body.durationMinutes !== null && (!Number.isInteger(req.body.durationMinutes) || req.body.durationMinutes < 1 || req.body.durationMinutes > 100000)) return error(res, 400, 'مدت پروژه معتبر نیست.');
    sets.push('duration_minutes = ?'); values.push(req.body.durationMinutes);
  }
  if (req.body.languageCode !== undefined) {
    if (!['fa', 'en', 'other'].includes(req.body.languageCode)) return error(res, 400, 'زبان پروژه معتبر نیست.');
    sets.push('language_code = ?'); values.push(req.body.languageCode);
  }
  if (req.body.targetDate !== undefined) {
    if (req.body.targetDate !== null && !isDateOnly(req.body.targetDate)) return error(res, 400, 'تاریخ هدف معتبر نیست.');
    sets.push('target_date = ?'); values.push(req.body.targetDate);
  }
  if (sets.length === 0) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?'); values.push(new Date().toISOString(), projectId);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  recordActivity(projectId, activeAuth(req)!, 'project.updated', 'project', projectId);
  res.json(db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(projectId));
});

app.delete('/api/projects/:projectId', async (req, res) => {
  if (!['owner', 'admin', 'producer'].includes((req as AuthenticatedRequest).projectRole ?? 'viewer')) return error(res, 403, 'حذف پروژه فقط برای تهیه‌کننده یا مدیر فضای کاری مجاز است.');
  const storageKeys = db.prepare('SELECT storage_key AS storageKey FROM project_documents WHERE project_id = ?').all(req.params.projectId) as { storageKey: string }[];
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.projectId);
  if (result.changes === 0) return error(res, 404, 'پروژه پیدا نشد.');
  await Promise.all(storageKeys.map(async ({ storageKey }) => {
    const filePath = documentFilePath(storageKey);
    if (filePath) await unlink(filePath).catch(() => undefined);
  }));
  res.status(204).end();
});

app.get('/api/projects/:projectId/drafts', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(db.prepare(`SELECT ${draftColumns} FROM screenplay_drafts WHERE project_id = ? ORDER BY updated_at DESC`).all(req.params.projectId));
});

app.post('/api/projects/:projectId/drafts', (req, res) => {
  const projectId = req.params.projectId;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'نسخه‌ی تازه';
  const body = typeof req.body.body === 'string' ? req.body.body : '';
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare('INSERT INTO screenplay_drafts (id, project_id, title, body, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, title, body, now);
  recordActivity(projectId, activeAuth(req)!, 'screenplay.created', 'screenplay', id);
  res.status(201).json(db.prepare(`SELECT ${draftColumns} FROM screenplay_drafts WHERE id = ?`).get(id));
});

app.patch('/api/drafts/:draftId', (req, res) => {
  const draft = db.prepare('SELECT id, project_id AS projectId FROM screenplay_drafts WHERE id = ?').get(req.params.draftId) as { id: string; projectId: string } | undefined;
  if (!draft) return error(res, 404, 'پیش‌نویس پیدا نشد.');
  const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'نسخه‌ی تازه';
  const body = typeof req.body.body === 'string' ? req.body.body : '';
  db.prepare('UPDATE screenplay_drafts SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(title, body, new Date().toISOString(), req.params.draftId);
  recordActivity(draft.projectId, activeAuth(req)!, 'screenplay.updated', 'screenplay', draft.id);
  res.json(db.prepare(`SELECT ${draftColumns} FROM screenplay_drafts WHERE id = ?`).get(req.params.draftId));
});

const commentColumns = `c.id, c.project_id AS projectId, c.author_id AS authorId, c.author_name AS authorName, c.scope_type AS scopeType, c.scope_id AS scopeId, c.body, c.created_at AS createdAt, c.updated_at AS updatedAt`;
app.get('/api/projects/:projectId/activity', (req, res) => {
  const rows = db.prepare(`SELECT id, project_id AS projectId, actor_name AS actorName, event_type AS eventType,
      entity_type AS entityType, entity_id AS entityId, created_at AS createdAt
    FROM project_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.params.projectId);
  res.json(rows);
});

app.get('/api/notifications', (req, res) => {
  const auth = activeAuth(req)!; const access = notificationAccessSql();
  const notifications = db.prepare(`SELECT ${notificationColumns} FROM user_notifications n
    JOIN projects p ON p.id = n.project_id JOIN project_activity a ON a.id = n.activity_id
    WHERE n.recipient_user_id = ? AND ${access} ORDER BY n.created_at DESC LIMIT 60`)
    .all(auth.userId, auth.workspaceId, auth.userId, auth.userId);
  const unreadCount = (db.prepare(`SELECT COUNT(*) AS count FROM user_notifications n WHERE n.recipient_user_id = ? AND n.read_at IS NULL AND ${access}`)
    .get(auth.userId, auth.workspaceId, auth.userId, auth.userId) as { count: number }).count;
  res.json({ notifications, unreadCount });
});

app.patch('/api/notifications/:notificationId/read', (req, res) => {
  const auth = activeAuth(req); if (!auth) return error(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  const access = notificationAccessSql();
  const row = db.prepare(`SELECT n.id FROM user_notifications n WHERE n.id = ? AND n.recipient_user_id = ? AND ${access}`)
    .get(req.params.notificationId, auth.userId, auth.workspaceId, auth.userId, auth.userId);
  if (!row) return error(res, 404, 'اعلان پیدا نشد.');
  db.prepare('UPDATE user_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_user_id = ?')
    .run(new Date().toISOString(), req.params.notificationId, auth.userId);
  res.json(db.prepare(`SELECT ${notificationColumns} FROM user_notifications n
    JOIN projects p ON p.id = n.project_id JOIN project_activity a ON a.id = n.activity_id WHERE n.id = ?`).get(req.params.notificationId));
});

app.patch('/api/notifications/read-all', (req, res) => {
  const auth = activeAuth(req)!;
  const updated = db.prepare(`UPDATE user_notifications SET read_at = ? WHERE recipient_user_id = ? AND read_at IS NULL
    AND ${notificationAccessSql('user_notifications')}`).run(new Date().toISOString(), auth.userId, auth.workspaceId, auth.userId, auth.userId);
  res.json({ updatedCount: updated.changes });
});

app.get('/api/projects/:projectId/personal-note', (req, res) => {
  const auth = activeAuth(req)!;
  const note = db.prepare('SELECT body, updated_at AS updatedAt FROM project_personal_notes WHERE project_id = ? AND user_id = ?').get(req.params.projectId, auth.userId) as { body: string; updatedAt: string } | undefined;
  res.json(note ?? { body: '', updatedAt: null });
});

app.put('/api/projects/:projectId/personal-note', (req, res) => {
  const auth = activeAuth(req)!;
  if (typeof req.body.body !== 'string' || req.body.body.length > 8000) return error(res, 400, 'یادداشت شخصی باید حداکثر ۸۰۰۰ نویسه باشد.');
  const body = req.body.body.trim();
  if (!body) {
    db.prepare('DELETE FROM project_personal_notes WHERE project_id = ? AND user_id = ?').run(req.params.projectId, auth.userId);
    return res.json({ body: '', updatedAt: null });
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_personal_notes (id, project_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`)
    .run(randomUUID(), req.params.projectId, auth.userId, body, now, now);
  res.json(db.prepare('SELECT body, updated_at AS updatedAt FROM project_personal_notes WHERE project_id = ? AND user_id = ?').get(req.params.projectId, auth.userId));
});

app.get('/api/projects/:projectId/comments', (req, res) => {
  const auth = activeAuth(req)!;
  const rows = db.prepare(`SELECT ${commentColumns} FROM project_comments c WHERE c.project_id = ? ORDER BY c.created_at ASC`).all(req.params.projectId) as (Record<string, unknown> & { authorId: string | null })[];
  const elevated = ['owner', 'admin', 'producer'].includes(projectAccessRole(auth.userId, req.params.projectId, auth.workspaceId) ?? '');
  res.json(rows.map((row) => ({ ...row, canEdit: row.authorId === auth.userId || elevated })));
});

app.post('/api/projects/:projectId/comments', (req, res) => {
  const auth = activeAuth(req)!;
  const projectId = req.params.projectId;
  const scopeType = req.body.scopeType;
  const scopeId = typeof req.body.scopeId === 'string' ? req.body.scopeId : null;
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!['project', 'screenplay', 'scene'].includes(scopeType) || !body || body.length > 8000) return error(res, 400, 'متن یا محدوده‌ی دیدگاه معتبر نیست.');
  if (scopeType === 'project' && scopeId) return error(res, 400, 'دیدگاه پروژه نباید شناسه‌ی صحنه یا فیلمنامه داشته باشد.');
  if (scopeType === 'screenplay' && (!scopeId || !db.prepare('SELECT id FROM screenplay_drafts WHERE id = ? AND project_id = ?').get(scopeId, projectId))) return error(res, 400, 'نسخه‌ی فیلمنامه‌ی این پروژه پیدا نشد.');
  if (scopeType === 'scene' && (!scopeId || !db.prepare('SELECT id FROM production_scenes WHERE id = ? AND project_id = ?').get(scopeId, projectId))) return error(res, 400, 'صحنه‌ی این پروژه پیدا نشد.');
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_comments (id, project_id, author_id, author_name, scope_type, scope_id, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, auth.userId, auth.user.displayName, scopeType, scopeType === 'project' ? null : scopeId, body, now, now);
  recordActivity(projectId, auth, 'discussion.comment_created', 'comment', id);
  res.status(201).json({ ...(db.prepare(`SELECT ${commentColumns} FROM project_comments c WHERE c.id = ?`).get(id) as Record<string, unknown>), canEdit: true });
});

app.patch('/api/comments/:commentId', (req, res) => {
  const auth = activeAuth(req)!;
  const comment = db.prepare('SELECT id, project_id AS projectId, author_id AS authorId FROM project_comments WHERE id = ?').get(req.params.commentId) as { id: string; projectId: string; authorId: string | null } | undefined;
  if (!comment) return error(res, 404, 'دیدگاه پیدا نشد.');
  const canManage = ['owner', 'admin', 'producer'].includes(projectAccessRole(auth.userId, comment.projectId, auth.workspaceId) ?? '');
  if (comment.authorId !== auth.userId && !canManage) return error(res, 403, 'فقط نویسنده یا مدیر پروژه می‌تواند دیدگاه را ویرایش کند.');
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 8000) return error(res, 400, 'متن دیدگاه باید بین ۱ تا ۸۰۰۰ نویسه باشد.');
  db.prepare('UPDATE project_comments SET body = ?, updated_at = ? WHERE id = ?').run(body, new Date().toISOString(), comment.id);
  recordActivity(comment.projectId, auth, 'discussion.comment_updated', 'comment', comment.id);
  res.json({ ...(db.prepare(`SELECT ${commentColumns} FROM project_comments c WHERE c.id = ?`).get(comment.id) as Record<string, unknown>), canEdit: true });
});

app.delete('/api/comments/:commentId', (req, res) => {
  const auth = activeAuth(req)!;
  const comment = db.prepare('SELECT id, project_id AS projectId, author_id AS authorId FROM project_comments WHERE id = ?').get(req.params.commentId) as { id: string; projectId: string; authorId: string | null } | undefined;
  if (!comment) return error(res, 404, 'دیدگاه پیدا نشد.');
  const canManage = ['owner', 'admin', 'producer'].includes(projectAccessRole(auth.userId, comment.projectId, auth.workspaceId) ?? '');
  if (comment.authorId !== auth.userId && !canManage) return error(res, 403, 'فقط نویسنده یا مدیر پروژه می‌تواند دیدگاه را حذف کند.');
  recordActivity(comment.projectId, auth, 'discussion.comment_deleted', 'comment', comment.id);
  db.prepare('DELETE FROM project_comments WHERE id = ?').run(comment.id);
  res.status(204).end();
});

app.get('/api/projects/:projectId/roles', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(db.prepare(`SELECT ${roleColumns} FROM casting_roles WHERE project_id = ? ORDER BY created_at DESC`).all(req.params.projectId));
});

app.post('/api/projects/:projectId/roles', (req, res) => {
  const projectId = req.params.projectId;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const character = typeof req.body.character === 'string' ? req.body.character.trim() : '';
  if (!character) return error(res, 400, 'نام نقش الزامی است.');
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare('INSERT INTO casting_roles (id, project_id, character, description, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, projectId, character, typeof req.body.description === 'string' ? req.body.description.trim() : '', now);
  recordActivity(projectId, activeAuth(req)!, 'casting.role_created', 'casting_role', id);
  res.status(201).json(db.prepare(`SELECT ${roleColumns} FROM casting_roles WHERE id = ?`).get(id));
});

app.patch('/api/roles/:roleId', (req, res) => {
  const status = ['open', 'shortlist', 'cast'].includes(req.body.status) ? req.body.status : null;
  if (!status) return error(res, 400, 'وضعیت انتخاب‌شده معتبر نیست.');
  const result = db.prepare('UPDATE casting_roles SET status = ?, candidate = ? WHERE id = ?')
    .run(status, typeof req.body.candidate === 'string' ? req.body.candidate.trim() : '', req.params.roleId);
  if (result.changes === 0) return error(res, 404, 'نقش پیدا نشد.');
  res.json(db.prepare(`SELECT ${roleColumns} FROM casting_roles WHERE id = ?`).get(req.params.roleId));
});

app.delete('/api/roles/:roleId', (req, res) => {
  const result = db.prepare('DELETE FROM casting_roles WHERE id = ?').run(req.params.roleId);
  if (!result.changes) return error(res, 404, 'نقش پیدا نشد.');
  res.status(204).end();
});

const talentColumns = `id, name, profession, biography, skills_json AS skillsJson, languages_json AS languagesJson, tags_json AS tagsJson, showreel_url AS showreelUrl, created_at AS createdAt, updated_at AS updatedAt`;
function mapTalent(row: Record<string, unknown>, privateDetails?: { contactEmail: string; contactPhone: string; privateNotes: string }) {
  const result = {
    ...row,
    skills: JSON.parse(String(row.skillsJson)) as string[],
    languages: JSON.parse(String(row.languagesJson)) as string[],
    tags: JSON.parse(String(row.tagsJson)) as string[],
  } as Record<string, unknown>;
  delete result.skillsJson; delete result.languagesJson; delete result.tagsJson;
  if (privateDetails) result.private = { contactEmail: privateDetails.contactEmail, contactPhone: privateDetails.contactPhone, notes: privateDetails.privateNotes };
  return result;
}

app.get('/api/talents', (req, res) => {
  const auth = activeAuth(req)!;
  const search = typeof req.query.q === 'string' ? `%${req.query.q.trim().slice(0, 100)}%` : null;
  const scoped = workspaceMembershipRole(auth) ? '' : ` AND id IN (SELECT a.talent_id FROM casting_assignments a JOIN casting_roles r ON r.id = a.role_id JOIN project_access pa ON pa.project_id = r.project_id WHERE pa.user_id = ?)`;
  const rows = search
    ? db.prepare(`SELECT ${talentColumns} FROM talent_profiles WHERE workspace_id = ? AND (name LIKE ? OR profession LIKE ? OR biography LIKE ?)${scoped} ORDER BY name COLLATE NOCASE`).all(...[auth.workspaceId, search, search, search, ...(scoped ? [auth.userId] : [])]) as Record<string, unknown>[]
    : db.prepare(`SELECT ${talentColumns} FROM talent_profiles WHERE workspace_id = ?${scoped} ORDER BY name COLLATE NOCASE`).all(...[auth.workspaceId, ...(scoped ? [auth.userId] : [])]) as Record<string, unknown>[];
  res.json(rows.map((row) => mapTalent(row)));
});

app.post('/api/talents', (req, res) => {
  const auth = activeAuth(req)!;
  if (!canManageTalent(auth)) return error(res, 403, 'برای ساخت پروفایل هنرمند دسترسی لازم را ندارید.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 160) return error(res, 400, 'نام هنرمند الزامی است.');
  const skills = stringList(req.body.skills); const languages = stringList(req.body.languages); const tags = stringList(req.body.tags);
  if (!skills || !languages || !tags) return error(res, 400, 'مهارت‌ها، زبان‌ها یا برچسب‌ها معتبر نیستند.');
  const id = randomUUID(); const now = new Date().toISOString();
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const showreelUrl = text(req.body.showreelUrl, 500);
  if (showreelUrl && !/^https?:\/\//i.test(showreelUrl)) return error(res, 400, 'نشانی شو‌ریل باید با http یا https آغاز شود.');
  const contactEmail = text(req.body.contactEmail, 250);
  if (contactEmail && !normalizedEmail(contactEmail)) return error(res, 400, 'ایمیل تماس معتبر نیست.');
  db.prepare(`INSERT INTO talent_profiles (id, workspace_id, name, profession, biography, skills_json, languages_json, tags_json, showreel_url, contact_email, contact_phone, private_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, auth.workspaceId, name, text(req.body.profession, 100) || 'actor', text(req.body.biography, 4000), JSON.stringify(skills), JSON.stringify(languages), JSON.stringify(tags), showreelUrl, contactEmail, text(req.body.contactPhone, 100), text(req.body.privateNotes, 4000), now, now);
  res.status(201).json(mapTalent(db.prepare(`SELECT ${talentColumns} FROM talent_profiles WHERE id = ?`).get(id) as Record<string, unknown>));
});

app.get('/api/talents/:talentId/private', (req, res) => {
  const row = db.prepare('SELECT contact_email AS contactEmail, contact_phone AS contactPhone, private_notes AS privateNotes FROM talent_profiles WHERE id = ?').get(req.params.talentId);
  if (!row) return error(res, 404, 'پروفایل پیدا نشد.');
  res.json(row);
});

app.patch('/api/talents/:talentId', (req, res) => {
  const current = db.prepare('SELECT id FROM talent_profiles WHERE id = ?').get(req.params.talentId);
  if (!current) return error(res, 404, 'پروفایل پیدا نشد.');
  const sets: string[] = []; const values: unknown[] = [];
  const fields = [['name', 'name', 160], ['profession', 'profession', 100], ['biography', 'biography', 4000], ['showreelUrl', 'showreel_url', 500], ['contactEmail', 'contact_email', 250], ['contactPhone', 'contact_phone', 100], ['privateNotes', 'private_notes', 4000]] as const;
  for (const [key, column, max] of fields) if (req.body[key] !== undefined) {
    if (typeof req.body[key] !== 'string' || req.body[key].length > max || (key === 'name' && !req.body[key].trim())) return error(res, 400, 'یکی از مشخصات پروفایل معتبر نیست.');
    sets.push(`${column} = ?`); values.push(req.body[key].trim());
  }
  if (req.body.contactEmail !== undefined && req.body.contactEmail && !normalizedEmail(req.body.contactEmail)) return error(res, 400, 'ایمیل تماس معتبر نیست.');
  for (const [key, column] of [['skills', 'skills_json'], ['languages', 'languages_json'], ['tags', 'tags_json']] as const) if (req.body[key] !== undefined) {
    const list = stringList(req.body[key]); if (!list) return error(res, 400, 'فهرست پروفایل معتبر نیست.');
    sets.push(`${column} = ?`); values.push(JSON.stringify(list));
  }
  if (req.body.showreelUrl !== undefined && req.body.showreelUrl && !/^https?:\/\//i.test(req.body.showreelUrl)) return error(res, 400, 'نشانی شو‌ریل باید با http یا https آغاز شود.');
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?'); values.push(new Date().toISOString(), req.params.talentId);
  db.prepare(`UPDATE talent_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  res.json(mapTalent(db.prepare(`SELECT ${talentColumns} FROM talent_profiles WHERE id = ?`).get(req.params.talentId) as Record<string, unknown>));
});

app.delete('/api/talents/:talentId', (req, res) => {
  const result = db.prepare('DELETE FROM talent_profiles WHERE id = ?').run(req.params.talentId);
  if (!result.changes) return error(res, 404, 'پروفایل پیدا نشد.');
  res.status(204).end();
});

const assignmentColumns = `id, role_id AS roleId, talent_id AS talentId, status, notes, created_at AS createdAt`;
app.get('/api/roles/:roleId/assignments', (req, res) => {
  if (!db.prepare('SELECT id FROM casting_roles WHERE id = ?').get(req.params.roleId)) return error(res, 404, 'نقش پیدا نشد.');
  res.json(db.prepare(`SELECT ${assignmentColumns} FROM casting_assignments WHERE role_id = ? ORDER BY created_at DESC`).all(req.params.roleId));
});

app.post('/api/roles/:roleId/assignments', (req, res) => {
  const role = db.prepare('SELECT r.id, p.workspace_id AS workspaceId FROM casting_roles r JOIN projects p ON p.id = r.project_id WHERE r.id = ?').get(req.params.roleId) as { id: string; workspaceId: string } | undefined;
  if (!role) return error(res, 404, 'نقش پیدا نشد.');
  const talentId = typeof req.body.talentId === 'string' ? req.body.talentId : '';
  if (!talentId || !db.prepare('SELECT id FROM talent_profiles WHERE id = ? AND workspace_id = ?').get(talentId, role.workspaceId)) return error(res, 400, 'هنرمند انتخاب‌شده پیدا نشد.');
  const status = ['considering', 'audition', 'shortlist', 'cast', 'declined'].includes(req.body.status) ? req.body.status : 'considering';
  const id = randomUUID(); const now = new Date().toISOString();
  try { db.prepare('INSERT INTO casting_assignments (id, role_id, talent_id, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.roleId, talentId, status, typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : '', now); }
  catch { return error(res, 409, 'این هنرمند پیش‌تر برای همین نقش ثبت شده است.'); }
  res.status(201).json(db.prepare(`SELECT ${assignmentColumns} FROM casting_assignments WHERE id = ?`).get(id));
});

app.patch('/api/casting-assignments/:assignmentId', (req, res) => {
  const current = db.prepare('SELECT id FROM casting_assignments WHERE id = ?').get(req.params.assignmentId);
  if (!current) return error(res, 404, 'گزینه‌ی انتخاب بازیگر پیدا نشد.');
  const sets: string[] = []; const values: unknown[] = [];
  if (req.body.status !== undefined) {
    if (!['considering', 'audition', 'shortlist', 'cast', 'declined'].includes(req.body.status)) return error(res, 400, 'وضعیت انتخاب بازیگر معتبر نیست.');
    sets.push('status = ?'); values.push(req.body.status);
  }
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== 'string' || req.body.notes.length > 2000) return error(res, 400, 'یادداشت معتبر نیست.');
    sets.push('notes = ?'); values.push(req.body.notes.trim());
  }
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  values.push(req.params.assignmentId);
  db.prepare(`UPDATE casting_assignments SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare(`SELECT ${assignmentColumns} FROM casting_assignments WHERE id = ?`).get(req.params.assignmentId));
});

app.delete('/api/casting-assignments/:assignmentId', (req, res) => {
  const result = db.prepare('DELETE FROM casting_assignments WHERE id = ?').run(req.params.assignmentId);
  if (!result.changes) return error(res, 404, 'گزینه‌ی انتخاب بازیگر پیدا نشد.');
  res.status(204).end();
});

const locationColumns = `id, name, category, address, notes, contact_name AS contactName, contact_phone AS contactPhone, created_at AS createdAt, updated_at AS updatedAt`;
app.get('/api/locations', (req, res) => {
  const auth = activeAuth(req)!;
  const rows = workspaceMembershipRole(auth)
    ? db.prepare(`SELECT ${locationColumns} FROM production_locations WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`).all(auth.workspaceId)
    : db.prepare(`SELECT ${locationColumns} FROM production_locations WHERE workspace_id = ? AND id IN (SELECT s.location_id FROM production_scenes s JOIN project_access pa ON pa.project_id = s.project_id WHERE pa.user_id = ?) ORDER BY name COLLATE NOCASE`).all(auth.workspaceId, auth.userId);
  res.json(rows);
});
app.post('/api/locations', (req, res) => {
  const auth = activeAuth(req)!;
  if (!canManageProductionLibrary(auth)) return error(res, 403, 'برای ساخت لوکیشن دسترسی لازم را ندارید.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 180) return error(res, 400, 'نام لوکیشن الزامی است.');
  const val = (key: string, max: number) => typeof req.body[key] === 'string' ? req.body[key].trim().slice(0, max) : '';
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare('INSERT INTO production_locations (id, workspace_id, name, category, address, notes, contact_name, contact_phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, auth.workspaceId, name, val('category', 100), val('address', 500), val('notes', 4000), val('contactName', 160), val('contactPhone', 100), now, now);
  res.status(201).json(db.prepare(`SELECT ${locationColumns} FROM production_locations WHERE id = ?`).get(id));
});
app.patch('/api/locations/:locationId', (req, res) => {
  const fields = [['name', 'name', 180], ['category', 'category', 100], ['address', 'address', 500], ['notes', 'notes', 4000], ['contactName', 'contact_name', 160], ['contactPhone', 'contact_phone', 100]] as const;
  const sets: string[] = []; const values: unknown[] = [];
  for (const [key, column, max] of fields) if (req.body[key] !== undefined) {
    if (typeof req.body[key] !== 'string' || req.body[key].length > max || (key === 'name' && !req.body[key].trim())) return error(res, 400, 'یکی از مشخصات لوکیشن معتبر نیست.');
    sets.push(`${column} = ?`); values.push(req.body[key].trim());
  }
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?'); values.push(new Date().toISOString(), req.params.locationId);
  const result = db.prepare(`UPDATE production_locations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  if (!result.changes) return error(res, 404, 'لوکیشن پیدا نشد.');
  res.json(db.prepare(`SELECT ${locationColumns} FROM production_locations WHERE id = ?`).get(req.params.locationId));
});
app.delete('/api/locations/:locationId', (req, res) => {
  const result = db.prepare('DELETE FROM production_locations WHERE id = ?').run(req.params.locationId);
  if (!result.changes) return error(res, 404, 'لوکیشن پیدا نشد.');
  res.status(204).end();
});

const resourceColumns = `id, name, kind, description, quantity, notes, created_at AS createdAt, updated_at AS updatedAt`;
function mapResource(row: Record<string, unknown>) {
  const sceneIds = (db.prepare('SELECT scene_id AS sceneId FROM scene_resources WHERE resource_id = ? ORDER BY scene_id').all(row.id) as { sceneId: string }[]).map((item) => item.sceneId);
  return { ...row, sceneIds };
}
app.get('/api/resources', (req, res) => {
  const auth = activeAuth(req)!;
  const rows = workspaceMembershipRole(auth)
    ? db.prepare(`SELECT ${resourceColumns} FROM production_resources WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`).all(auth.workspaceId) as Record<string, unknown>[]
    : db.prepare(`SELECT ${resourceColumns} FROM production_resources WHERE workspace_id = ? AND id IN (SELECT sr.resource_id FROM scene_resources sr JOIN production_scenes s ON s.id = sr.scene_id JOIN project_access pa ON pa.project_id = s.project_id WHERE pa.user_id = ?) ORDER BY name COLLATE NOCASE`).all(auth.workspaceId, auth.userId) as Record<string, unknown>[];
  res.json(rows.map(mapResource));
});
app.post('/api/resources', (req, res) => {
  const auth = activeAuth(req)!;
  if (!canManageProductionLibrary(auth)) return error(res, 403, 'برای ساخت منبع دسترسی لازم را ندارید.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const kinds = ['prop', 'costume', 'set-dressing', 'equipment', 'vehicle', 'other'];
  if (!name || name.length > 180 || !kinds.includes(req.body.kind)) return error(res, 400, 'نام یا نوع منبع معتبر نیست.');
  const quantity = Number.isInteger(req.body.quantity) && req.body.quantity > 0 && req.body.quantity <= 100000 ? req.body.quantity : 1;
  const id = randomUUID(); const now = new Date().toISOString();
  const val = (key: string, max: number) => typeof req.body[key] === 'string' ? req.body[key].trim().slice(0, max) : '';
  db.prepare('INSERT INTO production_resources (id, workspace_id, name, kind, description, quantity, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, auth.workspaceId, name, req.body.kind, val('description', 2000), quantity, val('notes', 4000), now, now);
  res.status(201).json(mapResource(db.prepare(`SELECT ${resourceColumns} FROM production_resources WHERE id = ?`).get(id) as Record<string, unknown>));
});
app.patch('/api/resources/:resourceId', (req, res) => {
  const fields = [['name', 'name', 180], ['description', 'description', 2000], ['notes', 'notes', 4000]] as const;
  const sets: string[] = []; const values: unknown[] = [];
  for (const [key, column, max] of fields) if (req.body[key] !== undefined) {
    if (typeof req.body[key] !== 'string' || req.body[key].length > max || (key === 'name' && !req.body[key].trim())) return error(res, 400, 'یکی از مشخصات منبع معتبر نیست.');
    sets.push(`${column} = ?`); values.push(req.body[key].trim());
  }
  if (req.body.kind !== undefined) { if (!['prop', 'costume', 'set-dressing', 'equipment', 'vehicle', 'other'].includes(req.body.kind)) return error(res, 400, 'نوع منبع معتبر نیست.'); sets.push('kind = ?'); values.push(req.body.kind); }
  if (req.body.quantity !== undefined) { if (!Number.isInteger(req.body.quantity) || req.body.quantity < 1 || req.body.quantity > 100000) return error(res, 400, 'تعداد منبع معتبر نیست.'); sets.push('quantity = ?'); values.push(req.body.quantity); }
  if (Array.isArray(req.body.sceneIds)) {
    if (req.body.sceneIds.length > 1000 || req.body.sceneIds.some((id: unknown) => typeof id !== 'string')) return error(res, 400, 'فهرست صحنه‌ها معتبر نیست.');
    const ids = [...new Set(req.body.sceneIds as string[])];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const auth = activeAuth(req)!;
      const count = (db.prepare(`SELECT COUNT(*) AS count FROM production_scenes s JOIN projects p ON p.id = s.project_id WHERE s.id IN (${placeholders}) AND (p.workspace_id = ? OR p.id IN (SELECT project_id FROM project_access WHERE user_id = ?))`).get(...ids, auth.workspaceId, auth.userId) as { count: number }).count;
      if (count !== ids.length) return error(res, 400, 'یکی از صحنه‌های انتخاب‌شده پیدا نشد.');
    }
    const updateLinks = db.transaction(() => {
      db.prepare('DELETE FROM scene_resources WHERE resource_id = ?').run(req.params.resourceId);
      const insert = db.prepare('INSERT INTO scene_resources (scene_id, resource_id) VALUES (?, ?)');
      ids.forEach((sceneId) => insert.run(sceneId, req.params.resourceId));
    });
    updateLinks();
  }
  if (!sets.length && req.body.sceneIds === undefined) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  if (sets.length) {
    sets.push('updated_at = ?'); values.push(new Date().toISOString(), req.params.resourceId);
    const result = db.prepare(`UPDATE production_resources SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    if (!result.changes) return error(res, 404, 'منبع پیدا نشد.');
  } else if (!db.prepare('SELECT id FROM production_resources WHERE id = ?').get(req.params.resourceId)) return error(res, 404, 'منبع پیدا نشد.');
  res.json(mapResource(db.prepare(`SELECT ${resourceColumns} FROM production_resources WHERE id = ?`).get(req.params.resourceId) as Record<string, unknown>));
});
app.delete('/api/resources/:resourceId', (req, res) => {
  const result = db.prepare('DELETE FROM production_resources WHERE id = ?').run(req.params.resourceId);
  if (!result.changes) return error(res, 404, 'منبع پیدا نشد.');
  res.status(204).end();
});

const memberColumns = `id, project_id AS projectId, name, role, department, created_at AS createdAt`;
app.get('/api/projects/:projectId/members', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(db.prepare(`SELECT ${memberColumns} FROM project_members WHERE project_id = ? ORDER BY name COLLATE NOCASE`).all(req.params.projectId));
});
app.post('/api/projects/:projectId/members', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 160) return error(res, 400, 'نام عضو گروه الزامی است.');
  const role = typeof req.body.role === 'string' ? req.body.role.trim().slice(0, 120) : '';
  const department = typeof req.body.department === 'string' ? req.body.department.trim().slice(0, 120) : '';
  const id = randomUUID(); const now = new Date().toISOString();
  try { db.prepare('INSERT INTO project_members (id, project_id, name, role, department, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.projectId, name, role, department, now); }
  catch { return error(res, 409, 'این عضو با همین نقش در گروه پروژه ثبت شده است.'); }
  res.status(201).json(db.prepare(`SELECT ${memberColumns} FROM project_members WHERE id = ?`).get(id));
});
app.delete('/api/project-members/:memberId', (req, res) => {
  const result = db.prepare('DELETE FROM project_members WHERE id = ?').run(req.params.memberId);
  if (!result.changes) return error(res, 404, 'عضو گروه پیدا نشد.');
  res.status(204).end();
});

app.get('/api/projects/:projectId/tasks', (req, res) => {
  if (!projectExists(req.params.projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(db.prepare(`SELECT ${taskColumns} FROM production_tasks t LEFT JOIN project_members m ON m.id = t.assignee_id WHERE t.project_id = ? ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.created_at DESC`).all(req.params.projectId));
});

app.post('/api/projects/:projectId/tasks', (req, res) => {
  const projectId = req.params.projectId;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 200) return error(res, 400, 'عنوان وظیفه الزامی است و باید کمتر از ۲۰۰ نویسه باشد.');
  const dueDate = typeof req.body.dueDate === 'string' && req.body.dueDate ? req.body.dueDate : null;
  if (dueDate && !isDateOnly(dueDate)) return error(res, 400, 'تاریخ سررسید معتبر نیست.');
  const phase = req.body.phase === undefined ? 'production' : req.body.phase as ProjectWorkflowPhase;
  if (!projectWorkflowPhases.includes(phase)) return error(res, 400, 'مرحله‌ی گردش‌کار معتبر نیست.');
  const assigneeId = typeof req.body.assigneeId === 'string' && req.body.assigneeId ? req.body.assigneeId : null;
  if (assigneeId && !db.prepare('SELECT id FROM project_members WHERE id = ? AND project_id = ?').get(assigneeId, projectId)) return error(res, 400, 'مسئول باید عضو همین پروژه باشد.');
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare('INSERT INTO production_tasks (id, project_id, title, department, phase, due_date, priority, assignee_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, title, typeof req.body.department === 'string' ? req.body.department.trim().slice(0, 120) : 'تولید', phase, dueDate, ['low', 'medium', 'high'].includes(req.body.priority) ? req.body.priority : 'medium', assigneeId, now);
  recordActivity(projectId, activeAuth(req)!, 'production.task_created', 'task', id);
  res.status(201).json(db.prepare(`SELECT ${taskColumns} FROM production_tasks t LEFT JOIN project_members m ON m.id = t.assignee_id WHERE t.id = ?`).get(id));
});

app.patch('/api/tasks/:taskId', (req, res) => {
  const task = db.prepare('SELECT id, project_id AS projectId FROM production_tasks WHERE id = ?').get(req.params.taskId) as { id: string; projectId: string } | undefined;
  if (!task) return error(res, 404, 'وظیفه پیدا نشد.');
  const sets: string[] = []; const values: unknown[] = [];
  if (req.body.status !== undefined) { if (!['todo', 'doing', 'done'].includes(req.body.status)) return error(res, 400, 'وضعیت وظیفه معتبر نیست.'); sets.push('status = ?'); values.push(req.body.status); }
  if (req.body.phase !== undefined) { if (!projectWorkflowPhases.includes(req.body.phase as ProjectWorkflowPhase)) return error(res, 400, 'مرحله‌ی گردش‌کار معتبر نیست.'); sets.push('phase = ?'); values.push(req.body.phase); }
  if (req.body.assigneeId !== undefined) {
    const assigneeId = typeof req.body.assigneeId === 'string' && req.body.assigneeId ? req.body.assigneeId : null;
    if (assigneeId && !db.prepare('SELECT id FROM project_members WHERE id = ? AND project_id = ?').get(assigneeId, task.projectId)) return error(res, 400, 'مسئول باید عضو همین پروژه باشد.');
    sets.push('assignee_id = ?'); values.push(assigneeId);
  }
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  values.push(req.params.taskId);
  db.prepare(`UPDATE production_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  recordActivity(task.projectId, activeAuth(req)!, req.body.phase !== undefined ? 'production.task_phase_updated' : 'production.task_updated', 'task', task.id);
  res.json(db.prepare(`SELECT ${taskColumns} FROM production_tasks t LEFT JOIN project_members m ON m.id = t.assignee_id WHERE t.id = ?`).get(req.params.taskId));
});

app.delete('/api/tasks/:taskId', (req, res) => {
  const result = db.prepare('DELETE FROM production_tasks WHERE id = ?').run(req.params.taskId);
  if (!result.changes) return error(res, 404, 'وظیفه پیدا نشد.');
  res.status(204).end();
});

const budgetItemColumns = `id, project_id AS projectId, title, department, category, vendor_name AS vendorName,
  estimated_amount AS estimatedAmount, committed_amount AS committedAmount, actual_amount AS actualAmount,
  status, due_date AS dueDate, notes, created_at AS createdAt, updated_at AS updatedAt`;
const budgetStatuses: BudgetItemStatus[] = ['planned', 'committed', 'paid'];

function parseBudgetItemInput(value: unknown): ProjectBudgetItemInput | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 180) return null;
  const stringField = (key: string, max: number) => typeof body[key] === 'string' && body[key].length <= max ? (body[key] as string).trim() : null;
  const department = stringField('department', 120);
  const vendorName = stringField('vendorName', 180);
  const notes = stringField('notes', 4000);
  if (department === null || vendorName === null || notes === null) return null;
  if (!budgetCategories.includes(body.category as BudgetCategory) || !budgetStatuses.includes(body.status as BudgetItemStatus)) return null;
  const amounts = [body.estimatedAmount, body.committedAmount, body.actualAmount];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 1_000_000_000_000)) return null;
  const dueDate = body.dueDate === null || body.dueDate === '' ? null : body.dueDate;
  if (dueDate !== null && !isDateOnly(dueDate)) return null;
  return {
    title, department, vendorName, notes, category: body.category as BudgetCategory, status: body.status as BudgetItemStatus,
    estimatedAmount: Number(body.estimatedAmount), committedAmount: Number(body.committedAmount), actualAmount: Number(body.actualAmount), dueDate,
  };
}

function readProjectBudget(projectId: string) {
  const project = db.prepare('SELECT budget_currency AS currencyCode FROM projects WHERE id = ?').get(projectId) as { currencyCode: BudgetCurrency } | undefined;
  if (!project) return null;
  const items = db.prepare(`SELECT ${budgetItemColumns} FROM project_budget_items WHERE project_id = ?
    ORDER BY CASE status WHEN 'committed' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, due_date IS NULL, due_date, created_at DESC`).all(projectId);
  return {
    projectId, currencyCode: project.currencyCode, currencyLocked: items.length > 0, items,
    summary: summarizeBudget(items as { estimatedAmount: number; committedAmount: number; actualAmount: number }[]),
  };
}

function budgetTotalsRemainSafe(projectId: string, input: ProjectBudgetItemInput, replacingItemId?: string) {
  const rows = db.prepare(`SELECT estimated_amount AS estimatedAmount, committed_amount AS committedAmount, actual_amount AS actualAmount
    FROM project_budget_items WHERE project_id = ? AND (? IS NULL OR id <> ?)`)
    .all(projectId, replacingItemId ?? null, replacingItemId ?? null) as { estimatedAmount: number; committedAmount: number; actualAmount: number }[];
  try { summarizeBudget([...rows, input]); return true; }
  catch { return false; }
}

app.get('/api/projects/:projectId/budget', (req, res) => {
  const budget = readProjectBudget(req.params.projectId);
  if (!budget) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(budget);
});

app.patch('/api/projects/:projectId/budget/currency', (req, res) => {
  const currency = req.body.currencyCode;
  if (!budgetCurrencies.includes(currency as BudgetCurrency)) return error(res, 400, 'ارز بودجه معتبر نیست.');
  const projectId = req.params.projectId;
  const current = db.prepare('SELECT budget_currency AS currencyCode FROM projects WHERE id = ?').get(projectId) as { currencyCode: BudgetCurrency } | undefined;
  if (!current) return error(res, 404, 'پروژه پیدا نشد.');
  if (current.currencyCode !== currency && db.prepare('SELECT 1 FROM project_budget_items WHERE project_id = ? LIMIT 1').get(projectId)) return error(res, 409, 'پس از ثبت نخستین ردیف بودجه، ارز پروژه قابل تغییر نیست.');
  if (current.currencyCode !== currency) {
    db.prepare('UPDATE projects SET budget_currency = ?, updated_at = ? WHERE id = ?').run(currency, new Date().toISOString(), projectId);
    recordActivity(projectId, activeAuth(req)!, 'production.budget_currency_updated', 'project', projectId);
  }
  res.json(readProjectBudget(projectId));
});

app.post('/api/projects/:projectId/budget/items', (req, res) => {
  const projectId = req.params.projectId;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const input = parseBudgetItemInput(req.body);
  if (!input) return error(res, 400, 'مشخصات ردیف بودجه معتبر نیست.');
  if (!budgetTotalsRemainSafe(projectId, input)) return error(res, 400, 'جمع بودجه از محدوده‌ی امن عددی بیشتر می‌شود.');
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_budget_items (id, project_id, title, department, category, vendor_name, estimated_amount, committed_amount, actual_amount, status, due_date, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, input.title, input.department, input.category, input.vendorName, input.estimatedAmount, input.committedAmount, input.actualAmount, input.status, input.dueDate, input.notes, activeAuth(req)!.userId, now, now);
  recordActivity(projectId, activeAuth(req)!, 'production.budget_item_created', 'budget_item', id);
  res.status(201).json(readProjectBudget(projectId));
});

app.put('/api/budget-items/:itemId', (req, res) => {
  const item = db.prepare('SELECT id, project_id AS projectId FROM project_budget_items WHERE id = ?').get(req.params.itemId) as { id: string; projectId: string } | undefined;
  if (!item) return error(res, 404, 'ردیف بودجه پیدا نشد.');
  const input = parseBudgetItemInput(req.body);
  if (!input) return error(res, 400, 'مشخصات ردیف بودجه معتبر نیست.');
  if (!budgetTotalsRemainSafe(item.projectId, input, item.id)) return error(res, 400, 'جمع بودجه از محدوده‌ی امن عددی بیشتر می‌شود.');
  db.prepare(`UPDATE project_budget_items SET title = ?, department = ?, category = ?, vendor_name = ?, estimated_amount = ?,
    committed_amount = ?, actual_amount = ?, status = ?, due_date = ?, notes = ?, updated_at = ? WHERE id = ?`)
    .run(input.title, input.department, input.category, input.vendorName, input.estimatedAmount, input.committedAmount, input.actualAmount, input.status, input.dueDate, input.notes, new Date().toISOString(), item.id);
  recordActivity(item.projectId, activeAuth(req)!, 'production.budget_item_updated', 'budget_item', item.id);
  res.json(readProjectBudget(item.projectId));
});

app.delete('/api/budget-items/:itemId', (req, res) => {
  const item = db.prepare('SELECT id, project_id AS projectId FROM project_budget_items WHERE id = ?').get(req.params.itemId) as { id: string; projectId: string } | undefined;
  if (!item) return error(res, 404, 'ردیف بودجه پیدا نشد.');
  recordActivity(item.projectId, activeAuth(req)!, 'production.budget_item_deleted', 'budget_item', item.id);
  db.prepare('DELETE FROM project_budget_items WHERE id = ?').run(item.id);
  res.status(204).end();
});

app.get('/api/projects/:projectId/scenes', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const rows = db.prepare(`SELECT ${sceneColumns} FROM production_scenes s LEFT JOIN shooting_days d ON d.id = s.shooting_day_id WHERE s.project_id = ? ORDER BY s.screenplay_order`).all(projectId) as Record<string, unknown>[];
  res.json(rows.map(mapScene));
});

app.post('/api/projects/:projectId/scenes', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const heading = typeof req.body.heading === 'string' ? req.body.heading.trim() : '';
  if (!heading || heading.length > 300) return error(res, 400, 'سرصحنه الزامی است و باید کمتر از ۳۰۰ نویسه باشد.');
  const orderRow = db.prepare('SELECT COALESCE(MAX(screenplay_order), 0) + 1 AS nextOrder FROM production_scenes WHERE project_id = ?').get(projectId) as { nextOrder: number };
  const parsed = parseSceneHeading(heading);
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO production_scenes (id, project_id, screenplay_order, heading, environment, time_of_day, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, orderRow.nextOrder, heading, parsed.environment, parsed.timeOfDay, now, now);
  recordActivity(projectId, activeAuth(req)!, 'production.scene_created', 'scene', id);
  const row = db.prepare(`SELECT ${sceneColumns} FROM production_scenes s LEFT JOIN shooting_days d ON d.id = s.shooting_day_id WHERE s.id = ?`).get(id) as Record<string, unknown>;
  res.status(201).json(mapScene(row));
});

app.post('/api/projects/:projectId/scenes/import-headings', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const draftId = typeof req.body.draftId === 'string' ? req.body.draftId : '';
  if (!draftId) return error(res, 400, 'پیش‌نویس فیلمنامه انتخاب نشده است.');
  const draft = db.prepare('SELECT id, body FROM screenplay_drafts WHERE id = ? AND project_id = ?').get(draftId, projectId) as { id: string; body: string } | undefined;
  if (!draft) return error(res, 404, 'پیش‌نویس این پروژه پیدا نشد.');
  const sourceText = typeof req.body.sourceText === 'string' ? req.body.sourceText : draft.body;
  if (sourceText.length > 100_000) return error(res, 413, 'متن فیلمنامه بیش از حد طولانی است.');
  const headings = extractFountainSceneHeadings(sourceText);
  if (!headings.length) return error(res, 422, 'سرصحنه‌ای با قالب فیلمنامه پیدا نشد. از INT.، EXT. یا داخلی / خارجی استفاده کنید.');
  const existing = db.prepare('SELECT id, heading FROM production_scenes WHERE project_id = ? ORDER BY screenplay_order').all(projectId) as { id: string; heading: string }[];
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(screenplay_order), 0) AS maxOrder FROM production_scenes WHERE project_id = ?').get(projectId) as { maxOrder: number }).maxOrder;
  const queues = new Map<string, { id: string; heading: string }[]>();
  for (const scene of existing) {
    const key = scene.heading.trim().toLocaleLowerCase();
    queues.set(key, [...(queues.get(key) ?? []), scene]);
  }
  const now = new Date().toISOString();
  const addScene = db.prepare(`INSERT INTO production_scenes (id, project_id, screenplay_order, heading, environment, time_of_day, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateOrder = db.prepare('UPDATE production_scenes SET screenplay_order = ? WHERE id = ?');
  const importHeadings = db.transaction(() => {
    const ordered: { id: string; heading: string }[] = [];
    for (const heading of headings) {
      const key = heading.trim().toLocaleLowerCase();
      const match = queues.get(key)?.shift();
      if (match) ordered.push(match);
      else {
        const id = randomUUID(); const parsed = parseSceneHeading(heading);
        addScene.run(id, projectId, maxOrder + headings.length + 100 + ordered.length, heading, parsed.environment, parsed.timeOfDay, now, now);
        ordered.push({ id, heading });
      }
    }
    const used = new Set(ordered.map((scene) => scene.id));
    for (const scene of existing) if (!used.has(scene.id)) ordered.push(scene);
    const holdingBase = maxOrder + headings.length + existing.length + 10_000;
    ordered.forEach((scene, index) => updateOrder.run(holdingBase + index, scene.id));
    ordered.forEach((scene, index) => updateOrder.run(index + 1, scene.id));
    return ordered.length;
  });
  res.json({ imported: headings.length, total: importHeadings(), scenes: (db.prepare(`SELECT ${sceneColumns} FROM production_scenes s LEFT JOIN shooting_days d ON d.id = s.shooting_day_id WHERE s.project_id = ? ORDER BY s.screenplay_order`).all(projectId) as Record<string, unknown>[]).map(mapScene) });
});

app.patch('/api/scenes/:sceneId', (req, res) => {
  const current = db.prepare('SELECT id, project_id AS projectId, shooting_day_id AS shootingDayId, shoot_status AS shootStatus, screenplay_order AS screenplayOrder FROM production_scenes WHERE id = ?').get(req.params.sceneId) as { id: string; projectId: string; shootingDayId: string | null; shootStatus: string; screenplayOrder: number } | undefined;
  if (!current) return error(res, 404, 'صحنه پیدا نشد.');
  const values: unknown[] = []; const sets: string[] = [];
  const body = req.body as Record<string, unknown>;
  if (typeof body.heading === 'string') {
    const heading = body.heading.trim(); if (!heading || heading.length > 300) return error(res, 400, 'سرصحنه معتبر نیست.');
    const parsed = parseSceneHeading(heading);
    sets.push('heading = ?', 'environment = ?', 'time_of_day = ?'); values.push(heading, sceneEnvironments.includes(body.environment as SceneEnvironment) ? body.environment : parsed.environment, sceneTimes.includes(body.timeOfDay as SceneTimeOfDay) ? body.timeOfDay : parsed.timeOfDay);
  } else {
    if (sceneEnvironments.includes(body.environment as SceneEnvironment)) { sets.push('environment = ?'); values.push(body.environment); }
    if (sceneTimes.includes(body.timeOfDay as SceneTimeOfDay)) { sets.push('time_of_day = ?'); values.push(body.timeOfDay); }
  }
  for (const [key, column] of [['location', 'location'], ['productionNotes', 'production_notes'], ['continuityNotes', 'continuity_notes']] as const) {
    if (typeof body[key] === 'string') { if (body[key].length > 4000) return error(res, 400, 'یکی از یادداشت‌ها بیش از حد طولانی است.'); sets.push(`${column} = ?`); values.push(body[key].trim()); }
  }
  if (body.locationId !== undefined) {
    const locationId = typeof body.locationId === 'string' && body.locationId ? body.locationId : null;
    if (locationId) {
      const auth = activeAuth(req)!;
      const location = db.prepare('SELECT name FROM production_locations WHERE id = ? AND workspace_id = ?').get(locationId, auth.workspaceId) as { name: string } | undefined;
      if (!location) return error(res, 400, 'لوکیشن انتخاب‌شده پیدا نشد.');
      sets.push('location_id = ?', 'location = ?'); values.push(locationId, location.name);
    } else { sets.push('location_id = NULL'); }
  }
  for (const [key, column] of [['characters', 'characters_json'], ['props', 'props_json'], ['costumes', 'costumes_json'], ['setDressing', 'set_dressing_json']] as const) {
    if (body[key] !== undefined) { const list = stringList(body[key]); if (!list) return error(res, 400, 'فهرست منابع معتبر نیست.'); sets.push(`${column} = ?`); values.push(JSON.stringify(list)); }
  }
  if (body.estimatedMinutes !== undefined) { if (!Number.isInteger(body.estimatedMinutes) || Number(body.estimatedMinutes) < 0 || Number(body.estimatedMinutes) > 1440) return error(res, 400, 'مدت تخمینی باید بین صفر تا ۱۴۴۰ دقیقه باشد.'); sets.push('estimated_minutes = ?'); values.push(body.estimatedMinutes); }

  let dayId = current.shootingDayId; let status = current.shootStatus as SceneShootStatus; let shootingOrder: number | null | undefined;
  if (body.shootingDayId !== undefined) {
    dayId = typeof body.shootingDayId === 'string' && body.shootingDayId ? body.shootingDayId : null;
    if (dayId) {
      const day = db.prepare('SELECT id FROM shooting_days WHERE id = ? AND project_id = ?').get(dayId, current.projectId);
      if (!day) return error(res, 400, 'روز فیلم‌برداری باید متعلق به همین پروژه باشد.');
      status = 'scheduled';
      shootingOrder = Number.isInteger(body.shootingOrder) && Number(body.shootingOrder) > 0 ? Number(body.shootingOrder) : (db.prepare('SELECT COALESCE(MAX(shooting_order), 0) + 1 AS next FROM production_scenes WHERE shooting_day_id = ? AND id <> ?').get(dayId, current.id) as { next: number }).next;
    } else { status = 'unplanned'; shootingOrder = null; }
    sets.push('shooting_day_id = ?', 'shooting_order = ?', 'shoot_status = ?'); values.push(dayId, shootingOrder, status);
  } else if (body.shootingOrder !== undefined && current.shootingDayId) {
    if (!Number.isInteger(body.shootingOrder) || Number(body.shootingOrder) < 1) return error(res, 400, 'ترتیب فیلم‌برداری معتبر نیست.');
    sets.push('shooting_order = ?'); values.push(body.shootingOrder);
  }
  if (body.shootStatus !== undefined) {
    if (!sceneStatuses.includes(body.shootStatus as SceneShootStatus)) return error(res, 400, 'وضعیت صحنه معتبر نیست.');
    if (body.shootStatus === 'scheduled' && !dayId) return error(res, 400, 'برای برنامه‌ریزی صحنه ابتدا یک روز فیلم‌برداری انتخاب کنید.');
    if (body.shootStatus === 'unplanned') { sets.push('shooting_day_id = NULL', 'shooting_order = NULL'); dayId = null; }
    sets.push('shoot_status = ?'); values.push(body.shootStatus); status = body.shootStatus as SceneShootStatus;
  }
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  sets.push('updated_at = ?'); values.push(new Date().toISOString(), current.id);
  db.prepare(`UPDATE production_scenes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  recordActivity(current.projectId, activeAuth(req)!, 'production.scene_updated', 'scene', current.id);
  res.json(mapScene(db.prepare(`SELECT ${sceneColumns} FROM production_scenes s LEFT JOIN shooting_days d ON d.id = s.shooting_day_id WHERE s.id = ?`).get(current.id) as Record<string, unknown>));
});

app.delete('/api/scenes/:sceneId', (req, res) => {
  const result = db.prepare('DELETE FROM production_scenes WHERE id = ?').run(req.params.sceneId);
  if (!result.changes) return error(res, 404, 'صحنه پیدا نشد.');
  res.status(204).end();
});

app.get('/api/projects/:projectId/shooting-days', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const days = db.prepare(`SELECT ${shootingDayColumns} FROM shooting_days d LEFT JOIN production_scenes s ON s.shooting_day_id = d.id WHERE d.project_id = ? GROUP BY d.id ORDER BY d.shoot_date`).all(projectId);
  res.json(days);
});

app.post('/api/projects/:projectId/shooting-days', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  const shootDate = typeof req.body.shootDate === 'string' ? req.body.shootDate.trim() : '';
  if (!isDateOnly(shootDate)) return error(res, 400, 'تاریخ فیلم‌برداری معتبر نیست.');
  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
  const callTime = typeof req.body.callTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.callTime) ? req.body.callTime : null;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : '';
  const id = randomUUID(); const now = new Date().toISOString();
  try { db.prepare('INSERT INTO shooting_days (id, project_id, shoot_date, title, call_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, projectId, shootDate, title, callTime, notes, now); }
  catch { return error(res, 409, 'برای این تاریخ، روز فیلم‌برداری دیگری ثبت شده است.'); }
  recordActivity(projectId, activeAuth(req)!, 'production.shooting_day_created', 'shooting_day', id);
  res.status(201).json(db.prepare(`SELECT ${shootingDayColumns} FROM shooting_days d LEFT JOIN production_scenes s ON s.shooting_day_id = d.id WHERE d.id = ? GROUP BY d.id`).get(id));
});

app.patch('/api/shooting-days/:dayId', (req, res) => {
  const day = db.prepare('SELECT id, project_id AS projectId, shoot_date AS shootDate FROM shooting_days WHERE id = ?').get(req.params.dayId) as { id: string; projectId: string; shootDate: string } | undefined;
  if (!day) return error(res, 404, 'روز فیلم‌برداری پیدا نشد.');
  const sets: string[] = []; const values: unknown[] = [];
  if (req.body.shootDate !== undefined) { if (!isDateOnly(req.body.shootDate)) return error(res, 400, 'تاریخ فیلم‌برداری معتبر نیست.'); sets.push('shoot_date = ?'); values.push(req.body.shootDate); }
  if (req.body.title !== undefined) { if (typeof req.body.title !== 'string') return error(res, 400, 'عنوان معتبر نیست.'); sets.push('title = ?'); values.push(req.body.title.trim().slice(0, 120)); }
  if (req.body.callTime !== undefined) { if (req.body.callTime !== null && (typeof req.body.callTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.callTime))) return error(res, 400, 'ساعت فراخوان معتبر نیست.'); sets.push('call_time = ?'); values.push(req.body.callTime); }
  if (req.body.notes !== undefined) { if (typeof req.body.notes !== 'string') return error(res, 400, 'یادداشت معتبر نیست.'); sets.push('notes = ?'); values.push(req.body.notes.trim().slice(0, 4000)); }
  if (!sets.length) return error(res, 400, 'تغییری برای ذخیره وجود ندارد.');
  values.push(day.id);
  try { db.prepare(`UPDATE shooting_days SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
  catch { return error(res, 409, 'برای این تاریخ، روز فیلم‌برداری دیگری ثبت شده است.'); }
  res.json(db.prepare(`SELECT ${shootingDayColumns} FROM shooting_days d LEFT JOIN production_scenes s ON s.shooting_day_id = d.id WHERE d.id = ? GROUP BY d.id`).get(day.id));
});

app.delete('/api/shooting-days/:dayId', (req, res) => {
  const removeDay = db.transaction((id: string) => {
    db.prepare("UPDATE production_scenes SET shoot_status = 'unplanned', shooting_order = NULL, updated_at = ? WHERE shooting_day_id = ?").run(new Date().toISOString(), id);
    return db.prepare('DELETE FROM shooting_days WHERE id = ?').run(id);
  });
  const result = removeDay(req.params.dayId);
  if (!result.changes) return error(res, 404, 'روز فیلم‌برداری پیدا نشد.');
  res.status(204).end();
});

function readCallSheet(dayId: string): CallSheet | null {
  const day = db.prepare(`SELECT d.id AS shootingDayId, d.project_id AS projectId, d.shoot_date AS shootDate,
      d.title AS dayTitle, d.call_time AS dayCallTime, p.title AS projectTitle
    FROM shooting_days d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`).get(dayId) as {
      shootingDayId: string; projectId: string; shootDate: string; dayTitle: string; dayCallTime: string | null; projectTitle: string;
    } | undefined;
  if (!day) return null;
  const saved = db.prepare(`SELECT id, unit_call_time AS unitCallTime, meal_time AS mealTime, meeting_point AS meetingPoint,
      transport_notes AS transportNotes, safety_notes AS safetyNotes, general_notes AS generalNotes, updated_at AS updatedAt
    FROM call_sheets WHERE shooting_day_id = ?`).get(dayId) as Omit<CallSheet, 'projectId' | 'projectTitle' | 'shootingDayId' | 'shootDate' | 'dayTitle' | 'castCalls' | 'scenes'> | undefined;
  const sceneRows = db.prepare(`SELECT s.id, s.screenplay_order AS screenplayOrder, COALESCE(s.shooting_order, s.screenplay_order) AS shootingOrder,
      s.heading, s.environment, COALESCE(NULLIF(s.location, ''), l.name, '') AS location,
      s.time_of_day AS timeOfDay, s.characters_json AS charactersJson, s.estimated_minutes AS estimatedMinutes,
      s.production_notes AS productionNotes, s.continuity_notes AS continuityNotes
    FROM production_scenes s LEFT JOIN production_locations l ON l.id = s.location_id
    WHERE s.shooting_day_id = ? ORDER BY COALESCE(s.shooting_order, s.screenplay_order), s.screenplay_order`).all(dayId) as (Omit<CallSheet['scenes'][number], 'characters' | 'resources'> & { charactersJson: string })[];
  const scenes = sceneRows.map((scene) => ({
    id: scene.id, screenplayOrder: scene.screenplayOrder, shootingOrder: scene.shootingOrder, heading: scene.heading,
    environment: scene.environment, location: scene.location, timeOfDay: scene.timeOfDay,
    characters: JSON.parse(scene.charactersJson) as string[], estimatedMinutes: scene.estimatedMinutes,
    productionNotes: scene.productionNotes, continuityNotes: scene.continuityNotes,
    resources: db.prepare(`SELECT r.name FROM production_resources r JOIN scene_resources sr ON sr.resource_id = r.id
      WHERE sr.scene_id = ? ORDER BY r.name COLLATE NOCASE`).all(scene.id).map((row) => (row as { name: string }).name),
  }));
  const castRows = db.prepare(`SELECT a.id AS assignmentId, r.character, t.name AS talentName
    FROM casting_assignments a JOIN casting_roles r ON r.id = a.role_id JOIN talent_profiles t ON t.id = a.talent_id
    WHERE r.project_id = ? AND a.status = 'cast' ORDER BY r.character COLLATE NOCASE, t.name COLLATE NOCASE`).all(day.projectId) as { assignmentId: string; character: string; talentName: string }[];
  const dayCast = castForScheduledScenes(scenes.map((scene) => scene.characters), castRows);
  const savedCast = saved?.id ? db.prepare(`SELECT assignment_id AS assignmentId, call_time AS callTime, availability_status AS availability, notes
    FROM call_sheet_cast_calls WHERE call_sheet_id = ?`).all(saved.id) as { assignmentId: string; callTime: string; availability: AvailabilityStatus; notes: string }[] : [];
  const savedCastById = new Map(savedCast.map((call) => [call.assignmentId, call]));
  const castCalls = dayCast.map((cast) => ({
    assignmentId: cast.assignmentId, character: cast.character, talentName: cast.talentName,
    callTime: savedCastById.get(cast.assignmentId)?.callTime ?? saved?.unitCallTime ?? day.dayCallTime ?? '',
    availability: savedCastById.get(cast.assignmentId)?.availability ?? 'unknown',
    notes: savedCastById.get(cast.assignmentId)?.notes ?? '',
  }));
  const crewRows = db.prepare(`SELECT id AS memberId, name, role, department FROM project_members WHERE project_id = ? ORDER BY name COLLATE NOCASE`).all(day.projectId) as { memberId: string; name: string; role: string; department: string }[];
  const savedCrew = saved?.id ? db.prepare(`SELECT member_id AS memberId, call_time AS callTime, availability_status AS availability, notes
    FROM call_sheet_crew_calls WHERE call_sheet_id = ?`).all(saved.id) as { memberId: string; callTime: string; availability: AvailabilityStatus; notes: string }[] : [];
  const savedCrewById = new Map(savedCrew.map((call) => [call.memberId, call]));
  const crewCalls = crewRows.map((member) => ({
    ...member,
    callTime: savedCrewById.get(member.memberId)?.callTime ?? saved?.unitCallTime ?? day.dayCallTime ?? '',
    availability: savedCrewById.get(member.memberId)?.availability ?? 'unknown',
    notes: savedCrewById.get(member.memberId)?.notes ?? '',
  }));
  return {
    id: saved?.id ?? null, projectId: day.projectId, projectTitle: day.projectTitle, shootingDayId: day.shootingDayId,
    shootDate: day.shootDate, dayTitle: day.dayTitle, unitCallTime: saved?.unitCallTime ?? day.dayCallTime ?? '',
    mealTime: saved?.mealTime ?? '', meetingPoint: saved?.meetingPoint ?? '', transportNotes: saved?.transportNotes ?? '',
    safetyNotes: saved?.safetyNotes ?? '', generalNotes: saved?.generalNotes ?? '', castCalls, crewCalls, scenes, updatedAt: saved?.updatedAt ?? null,
  };
}

app.get('/api/shooting-days/:dayId/call-sheet', (req, res) => {
  const callSheet = readCallSheet(req.params.dayId);
  if (!callSheet) return error(res, 404, 'روز فیلم‌برداری پیدا نشد.');
  res.json(callSheet);
});

app.put('/api/shooting-days/:dayId/call-sheet', (req, res) => {
  const day = db.prepare('SELECT id, project_id AS projectId FROM shooting_days WHERE id = ?').get(req.params.dayId) as { id: string; projectId: string } | undefined;
  if (!day) return error(res, 404, 'روز فیلم‌برداری پیدا نشد.');
  const callTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const stringFields = ['meetingPoint', 'transportNotes', 'safetyNotes', 'generalNotes'] as const;
  const limits = { meetingPoint: 300, transportNotes: 4000, safetyNotes: 4000, generalNotes: 4000 };
  if (typeof req.body.unitCallTime !== 'string' || !callTimePattern.test(req.body.unitCallTime)) return error(res, 400, 'ساعت فراخوان معتبر نیست.');
  if (req.body.mealTime !== '' && (typeof req.body.mealTime !== 'string' || !callTimePattern.test(req.body.mealTime))) return error(res, 400, 'ساعت استراحت معتبر نیست.');
  for (const field of stringFields) if (typeof req.body[field] !== 'string' || req.body[field].length > limits[field]) return error(res, 400, 'اطلاعات برگه‌ی فراخوان معتبر نیست.');
  const availabilityStatuses = ['unknown', 'available', 'hold', 'unavailable'];
  if (!Array.isArray(req.body.castCalls) || req.body.castCalls.length > 100 || !Array.isArray(req.body.crewCalls) || req.body.crewCalls.length > 200) return error(res, 400, 'فهرست عوامل برگه‌ی فراخوان معتبر نیست.');
  const proposedCallSheetId = (db.prepare('SELECT id FROM call_sheets WHERE shooting_day_id = ?').get(day.id) as { id: string } | undefined)?.id ?? randomUUID();
  const currentCallSheet = readCallSheet(day.id);
  const castCandidates = currentCallSheet?.castCalls ?? [];
  const eligibleCast = new Set(castCandidates.map((cast) => cast.assignmentId));
  const crewCandidates = currentCallSheet?.crewCalls ?? [];
  const eligibleCrew = new Set(crewCandidates.map((crew) => crew.memberId));
  const castCalls: { assignmentId: string; callTime: string; availability: string; notes: string }[] = [];
  for (const call of req.body.castCalls as unknown[]) {
    if (!call || typeof call !== 'object') return error(res, 400, 'فهرست بازیگران برگه‌ی فراخوان معتبر نیست.');
    const row = call as Record<string, unknown>;
    if (typeof row.assignmentId !== 'string' || !eligibleCast.has(row.assignmentId) || typeof row.callTime !== 'string' || !callTimePattern.test(row.callTime) || typeof row.notes !== 'string' || row.notes.length > 1000 || typeof row.availability !== 'string' || !availabilityStatuses.includes(row.availability)) return error(res, 400, 'زمان، دسترس‌پذیری یا یادداشت بازیگر معتبر نیست.');
    if (castCalls.some((item) => item.assignmentId === row.assignmentId)) return error(res, 400, 'بازیگر در فهرست فراخوان تکرار شده است.');
    castCalls.push({ assignmentId: row.assignmentId, callTime: row.callTime, availability: row.availability, notes: row.notes.trim() });
  }
  const crewCalls: { memberId: string; callTime: string; availability: string; notes: string }[] = [];
  for (const call of req.body.crewCalls as unknown[]) {
    if (!call || typeof call !== 'object') return error(res, 400, 'فهرست عوامل برگه‌ی فراخوان معتبر نیست.');
    const row = call as Record<string, unknown>;
    if (typeof row.memberId !== 'string' || !eligibleCrew.has(row.memberId) || typeof row.callTime !== 'string' || !callTimePattern.test(row.callTime) || typeof row.notes !== 'string' || row.notes.length > 1000 || typeof row.availability !== 'string' || !availabilityStatuses.includes(row.availability)) return error(res, 400, 'زمان، دسترس‌پذیری یا یادداشت عامل معتبر نیست.');
    if (crewCalls.some((item) => item.memberId === row.memberId)) return error(res, 400, 'عامل در فهرست فراخوان تکرار شده است.');
    crewCalls.push({ memberId: row.memberId, callTime: row.callTime, availability: row.availability, notes: row.notes.trim() });
  }
  const now = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO call_sheets (id, project_id, shooting_day_id, unit_call_time, meal_time, meeting_point, transport_notes, safety_notes, general_notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shooting_day_id) DO UPDATE SET unit_call_time = excluded.unit_call_time, meal_time = excluded.meal_time,
        meeting_point = excluded.meeting_point, transport_notes = excluded.transport_notes, safety_notes = excluded.safety_notes,
        general_notes = excluded.general_notes, updated_at = excluded.updated_at`)
      .run(proposedCallSheetId, day.projectId, day.id, req.body.unitCallTime, req.body.mealTime, ...stringFields.map((field) => (req.body[field] as string).trim()), now, now);
    const persistedCallSheetId = (db.prepare('SELECT id FROM call_sheets WHERE shooting_day_id = ?').get(day.id) as { id: string }).id;
    db.prepare('DELETE FROM call_sheet_cast_calls WHERE call_sheet_id = ?').run(persistedCallSheetId);
    db.prepare('DELETE FROM call_sheet_crew_calls WHERE call_sheet_id = ?').run(persistedCallSheetId);
    const insertCast = db.prepare('INSERT INTO call_sheet_cast_calls (id, call_sheet_id, assignment_id, call_time, availability_status, notes) VALUES (?, ?, ?, ?, ?, ?)');
    castCalls.forEach((call) => insertCast.run(randomUUID(), persistedCallSheetId, call.assignmentId, call.callTime, call.availability, call.notes));
    const insertCrew = db.prepare('INSERT INTO call_sheet_crew_calls (id, call_sheet_id, member_id, call_time, availability_status, notes) VALUES (?, ?, ?, ?, ?, ?)');
    crewCalls.forEach((call) => insertCrew.run(randomUUID(), persistedCallSheetId, call.memberId, call.callTime, call.availability, call.notes));
    recordActivity(day.projectId, activeAuth(req)!, 'production.call_sheet_updated', 'call_sheet', persistedCallSheetId);
  });
  save();
  const callSheet = readCallSheet(day.id);
  if (!callSheet) return error(res, 500, 'ذخیره‌ی برگه‌ی فراخوان انجام نشد.');
  res.json(callSheet);
});

app.get('/api/projects/:projectId/ai-suggestions', (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  res.json(db.prepare(`SELECT ${aiSuggestionColumns} FROM ai_suggestions WHERE project_id = ? ORDER BY created_at DESC`).all(projectId).map(mapAiSuggestion));
});

app.post('/api/projects/:projectId/ai-assist', async (req, res) => {
  const { projectId } = req.params;
  if (!projectExists(projectId)) return error(res, 404, 'پروژه پیدا نشد.');
  if (!aiModes.includes(req.body.mode as AiAssistMode)) return error(res, 400, 'نوع درخواست معتبر نیست.');
  const mode = req.body.mode as AiAssistMode;
  const draftId = typeof req.body.draftId === 'string' ? req.body.draftId : null;
  let sourceText = typeof req.body.sourceText === 'string' ? req.body.sourceText : '';
  if (draftId) {
    const draft = db.prepare('SELECT body FROM screenplay_drafts WHERE id = ? AND project_id = ?').get(draftId, projectId) as { body: string } | undefined;
    if (!draft) return error(res, 404, 'پیش‌نویس این پروژه پیدا نشد.');
    if (typeof req.body.sourceText !== 'string') sourceText = draft.body;
  }
  const question = typeof req.body.question === 'string' ? req.body.question.trim().slice(0, 2000) : '';
  if (!sourceText.trim() && !question) return error(res, 400, 'متن فیلمنامه یا پرسش خود را وارد کنید.');
  if (sourceText.length > 50000) return error(res, 413, 'برای تحلیل، متن را به حداکثر ۵۰ هزار نویسه محدود کنید.');
  const provider = configuredAiProvider();
  if (!provider) return error(res, 503, 'دستیار هوش مصنوعی پیکربندی نشده است. متغیرهای AI_API_KEY، AI_MODEL و AI_BASE_URL را در محیط سرور تنظیم کنید.');
  try {
    const result = await provider.generate({ mode, projectTitle: String((db.prepare('SELECT title FROM projects WHERE id = ?').get(projectId) as { title: string }).title), sourceText, question });
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO ai_suggestions (id, project_id, draft_id, mode, source_text, result, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, draftId, mode, sourceText, result, 'suggested', now);
    res.status(201).json(db.prepare(`SELECT ${aiSuggestionColumns} FROM ai_suggestions WHERE id = ?`).get(id));
  } catch (cause) {
    const failure = cause as { kind?: string };
    if (failure.kind === 'rate-limit') return error(res, 429, 'درخواست‌های دستیار موقتاً محدود شده‌اند. کمی بعد دوباره تلاش کنید.');
    if (failure.kind === 'timeout' || failure.kind === 'network') return error(res, 502, 'ارتباط با سرویس هوش مصنوعی برقرار نشد. اتصال و تنظیمات سرور را بررسی کنید.');
    if (failure.kind === 'provider') return error(res, 502, 'سرویس هوش مصنوعی نتوانست پاسخ معتبری ارائه کند. تنظیمات مدل را بررسی کنید.');
    return error(res, 500, 'تحلیل انجام نشد.');
  }
});

app.patch('/api/ai-suggestions/:suggestionId', (req, res) => {
  const status = req.body.status;
  if (status !== 'accepted' && status !== 'dismissed') return error(res, 400, 'وضعیت بازبینی معتبر نیست.');
  const result = db.prepare("UPDATE ai_suggestions SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'suggested'").run(status, new Date().toISOString(), req.params.suggestionId);
  if (!result.changes) return error(res, 404, 'پیشنهاد پیدا نشد یا قبلاً بازبینی شده است.');
  res.json(db.prepare(`SELECT ${aiSuggestionColumns} FROM ai_suggestions WHERE id = ?`).get(req.params.suggestionId));
});

app.use('/api', (_req, res) => error(res, 404, 'مسیر API پیدا نشد.'));

const clientBuild = path.resolve(process.cwd(), 'dist');
if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*splat', (_req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

app.use((cause: unknown, _req: Request, res: Response, _next: (cause?: unknown) => void) => {
  if (res.headersSent) return;
  const status = (cause as { status?: number })?.status;
  const clientError = status === 400 || status === 413;
  res.status(clientError ? status as number : 500).json({ error: clientError ? 'درخواست نامعتبر است.' : 'خطای داخلی سرور.' });
});

app.listen(port, host, () => console.log(`Kadr API is running on http://${host}:${port}`));
