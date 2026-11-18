import type { AiAssistMode, AiSuggestion, AuthSession, AuthUser, BudgetCurrency, CallSheet, CallSheetInput, CastingAssignment, CastingAssignmentStatus, CastingRole, NotificationInbox, ProjectDocument, ProjectDocumentCategory, ProjectNotification, ProductionLocation, ProductionResource, ProductionResourceKind, ProductionScene, ProductionTask, Project, ProjectActivity, ProjectBudget, ProjectBudgetItemInput, ProjectComment, ProjectCommentScope, ProjectMember, SceneShootStatus, ScreenplayDraft, ShootingDay, TalentProfile, WorkspaceInvitation, WorkspaceMember, WorkspaceOption, WorkspaceRole } from '../../../shared/types';

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) { csrfToken = token; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'خطایی رخ داد.' }));
    throw new Error(payload.error ?? 'خطایی رخ داد.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  authSession: () => request<AuthSession>('/auth/session'),
  login: (email: string, password: string) => request<{ user: AuthUser; csrfToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (input: { displayName: string; email: string; password: string; invitationToken?: string }) => request<{ user: AuthUser; csrfToken: string }>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  acceptInvitation: (invitationToken: string) => request<{ user: AuthUser; csrfToken: string }>('/auth/accept-invitation', { method: 'POST', body: JSON.stringify({ invitationToken }) }),
  workspaces: () => request<WorkspaceOption[]>('/workspaces'),
  createWorkspace: (name: string) => request<{ user: AuthUser; csrfToken: string }>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  selectWorkspace: (workspaceId: string) => request<{ user: AuthUser; csrfToken: string }>('/auth/select-workspace', { method: 'POST', body: JSON.stringify({ workspaceId }) }),
  logout: async () => { await request<void>('/auth/logout', { method: 'POST' }); setCsrfToken(null); },
  workspace: () => request<{ id: string; name: string; currentRole: WorkspaceRole; members: WorkspaceMember[] }>('/workspace'),
  invitations: () => request<WorkspaceInvitation[]>('/workspace/invitations'),
  createInvitation: (input: { email: string; role: Exclude<WorkspaceRole, 'owner'>; projectId?: string | null }) => request<WorkspaceInvitation & { invitationToken: string }>('/workspace/invitations', { method: 'POST', body: JSON.stringify(input) }),
  deleteInvitation: (id: string) => request<void>(`/workspace/invitations/${id}`, { method: 'DELETE' }),
  notifications: () => request<NotificationInbox>('/notifications'),
  markNotificationRead: (id: string) => request<ProjectNotification>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<{ updatedCount: number }>('/notifications/read-all', { method: 'PATCH' }),
  projectComments: (projectId: string) => request<ProjectComment[]>(`/projects/${projectId}/comments`),
  createProjectComment: (projectId: string, input: { scopeType: ProjectCommentScope; scopeId: string | null; body: string }) => request<ProjectComment>(`/projects/${projectId}/comments`, { method: 'POST', body: JSON.stringify(input) }),
  updateProjectComment: (id: string, body: string) => request<ProjectComment>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteProjectComment: (id: string) => request<void>(`/comments/${id}`, { method: 'DELETE' }),
  projectActivity: (projectId: string) => request<ProjectActivity[]>(`/projects/${projectId}/activity`),
  personalProjectNote: (projectId: string) => request<{ body: string; updatedAt: string | null }>(`/projects/${projectId}/personal-note`),
  savePersonalProjectNote: (projectId: string, body: string) => request<{ body: string; updatedAt: string | null }>(`/projects/${projectId}/personal-note`, { method: 'PUT', body: JSON.stringify({ body }) }),
  projects: () => request<Project[]>('/projects'),
  projectPermissions: (projectId: string) => request<{ role: WorkspaceRole; canComment: boolean; canManageTeam: boolean; canInvite: boolean }>(`/projects/${projectId}/permissions`),
  projectDocuments: (projectId: string) => request<ProjectDocument[]>(`/projects/${projectId}/documents`),
  uploadProjectDocument: async (projectId: string, file: File, title: string, category: ProjectDocumentCategory, sceneId: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Original-Name': encodeURIComponent(file.name),
      'X-Document-Title': encodeURIComponent(title),
      'X-Document-Category': category,
      'X-Document-Scene': sceneId ?? '',
    };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(`/api/projects/${projectId}/documents`, { method: 'POST', headers, body: file });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'خطایی رخ داد.' }));
      throw new Error(payload.error ?? 'خطایی رخ داد.');
    }
    return response.json() as Promise<ProjectDocument>;
  },
  deleteProjectDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  createProject: (input: Pick<Project, 'title' | 'format' | 'logline'> & Partial<Pick<Project, 'genre' | 'languageCode'>>) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  updateProject: (id: string, input: Partial<Pick<Project, 'title' | 'logline' | 'synopsis' | 'genre' | 'durationMinutes' | 'languageCode' | 'director' | 'writer' | 'producer' | 'targetDate' | 'status' | 'progress'>>) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  drafts: (projectId: string) => request<ScreenplayDraft[]>(`/projects/${projectId}/drafts`),
  createDraft: (projectId: string, title: string, body = '') => request<ScreenplayDraft>(`/projects/${projectId}/drafts`, { method: 'POST', body: JSON.stringify({ title, body }) }),
  updateDraft: (id: string, title: string, body: string) => request<ScreenplayDraft>(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ title, body }) }),
  roles: (projectId: string) => request<CastingRole[]>(`/projects/${projectId}/roles`),
  createRole: (projectId: string, character: string, description: string) => request<CastingRole>(`/projects/${projectId}/roles`, { method: 'POST', body: JSON.stringify({ character, description }) }),
  updateRole: (id: string, status: CastingRole['status'], candidate: string) => request<CastingRole>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify({ status, candidate }) }),
  deleteRole: (id: string) => request<void>(`/roles/${id}`, { method: 'DELETE' }),
  talents: (search = '') => request<TalentProfile[]>(`/talents${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  createTalent: (input: Omit<TalentProfile, 'id' | 'createdAt' | 'updatedAt' | 'private'> & { contactEmail: string; contactPhone: string; privateNotes: string }) => request<TalentProfile>('/talents', { method: 'POST', body: JSON.stringify(input) }),
  updateTalent: (id: string, input: Record<string, unknown>) => request<TalentProfile>(`/talents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  talentPrivate: (id: string) => request<{ contactEmail: string; contactPhone: string; privateNotes: string }>(`/talents/${id}/private`),
  deleteTalent: (id: string) => request<void>(`/talents/${id}`, { method: 'DELETE' }),
  assignments: (roleId: string) => request<CastingAssignment[]>(`/roles/${roleId}/assignments`),
  createAssignment: (roleId: string, talentId: string) => request<CastingAssignment>(`/roles/${roleId}/assignments`, { method: 'POST', body: JSON.stringify({ talentId }) }),
  updateAssignment: (id: string, input: { status?: CastingAssignmentStatus; notes?: string }) => request<CastingAssignment>(`/casting-assignments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteAssignment: (id: string) => request<void>(`/casting-assignments/${id}`, { method: 'DELETE' }),
  locations: () => request<ProductionLocation[]>('/locations'),
  createLocation: (input: Omit<ProductionLocation, 'id' | 'createdAt' | 'updatedAt'>) => request<ProductionLocation>('/locations', { method: 'POST', body: JSON.stringify(input) }),
  updateLocation: (id: string, input: Partial<Omit<ProductionLocation, 'id' | 'createdAt' | 'updatedAt'>>) => request<ProductionLocation>(`/locations/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteLocation: (id: string) => request<void>(`/locations/${id}`, { method: 'DELETE' }),
  resources: () => request<ProductionResource[]>('/resources'),
  createResource: (input: Pick<ProductionResource, 'name' | 'kind' | 'description' | 'quantity' | 'notes'>) => request<ProductionResource>('/resources', { method: 'POST', body: JSON.stringify(input) }),
  updateResource: (id: string, input: Partial<Pick<ProductionResource, 'name' | 'kind' | 'description' | 'quantity' | 'notes' | 'sceneIds'>>) => request<ProductionResource>(`/resources/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteResource: (id: string) => request<void>(`/resources/${id}`, { method: 'DELETE' }),
  members: (projectId: string) => request<ProjectMember[]>(`/projects/${projectId}/members`),
  createMember: (projectId: string, input: Pick<ProjectMember, 'name' | 'role' | 'department'>) => request<ProjectMember>(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify(input) }),
  deleteMember: (id: string) => request<void>(`/project-members/${id}`, { method: 'DELETE' }),
  tasks: (projectId: string) => request<ProductionTask[]>(`/projects/${projectId}/tasks`),
  createTask: (projectId: string, input: Pick<ProductionTask, 'title' | 'department' | 'dueDate' | 'priority'> & { phase?: ProductionTask['phase']; assigneeId?: string | null }) => request<ProductionTask>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (id: string, input: ProductionTask['status'] | { assigneeId?: string | null; phase?: ProductionTask['phase'] }) => request<ProductionTask>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(typeof input === 'string' ? { status: input } : input) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  projectBudget: (projectId: string) => request<ProjectBudget>(`/projects/${projectId}/budget`),
  updateBudgetCurrency: (projectId: string, currencyCode: BudgetCurrency) => request<ProjectBudget>(`/projects/${projectId}/budget/currency`, { method: 'PATCH', body: JSON.stringify({ currencyCode }) }),
  createBudgetItem: (projectId: string, input: ProjectBudgetItemInput) => request<ProjectBudget>(`/projects/${projectId}/budget/items`, { method: 'POST', body: JSON.stringify(input) }),
  updateBudgetItem: (id: string, input: ProjectBudgetItemInput) => request<ProjectBudget>(`/budget-items/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteBudgetItem: (id: string) => request<void>(`/budget-items/${id}`, { method: 'DELETE' }),
  scenes: (projectId: string) => request<ProductionScene[]>(`/projects/${projectId}/scenes`),
  createScene: (projectId: string, heading: string) => request<ProductionScene>(`/projects/${projectId}/scenes`, { method: 'POST', body: JSON.stringify({ heading }) }),
  updateScene: (id: string, input: Partial<ProductionScene>) => request<ProductionScene>(`/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteScene: (id: string) => request<void>(`/scenes/${id}`, { method: 'DELETE' }),
  importSceneHeadings: (projectId: string, draftId: string, sourceText?: string) => request<{ imported: number; total: number; scenes: ProductionScene[] }>(`/projects/${projectId}/scenes/import-headings`, { method: 'POST', body: JSON.stringify({ draftId, sourceText }) }),
  shootingDays: (projectId: string) => request<ShootingDay[]>(`/projects/${projectId}/shooting-days`),
  createShootingDay: (projectId: string, input: Pick<ShootingDay, 'shootDate' | 'title' | 'callTime' | 'notes'>) => request<ShootingDay>(`/projects/${projectId}/shooting-days`, { method: 'POST', body: JSON.stringify(input) }),
  updateShootingDay: (id: string, input: Partial<Pick<ShootingDay, 'shootDate' | 'title' | 'callTime' | 'notes'>>) => request<ShootingDay>(`/shooting-days/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteShootingDay: (id: string) => request<void>(`/shooting-days/${id}`, { method: 'DELETE' }),
  callSheet: (dayId: string) => request<CallSheet>(`/shooting-days/${dayId}/call-sheet`),
  saveCallSheet: (dayId: string, input: CallSheetInput) => request<CallSheet>(`/shooting-days/${dayId}/call-sheet`, { method: 'PUT', body: JSON.stringify(input) }),
  assignScene: (id: string, shootingDayId: string | null, shootingOrder?: number) => request<ProductionScene>(`/scenes/${id}`, { method: 'PATCH', body: JSON.stringify({ shootingDayId, shootingOrder }) }),
  setSceneShootStatus: (id: string, shootStatus: SceneShootStatus) => request<ProductionScene>(`/scenes/${id}`, { method: 'PATCH', body: JSON.stringify({ shootStatus }) }),
  aiSuggestions: (projectId: string) => request<AiSuggestion[]>(`/projects/${projectId}/ai-suggestions`),
  requestAiAssist: (projectId: string, input: { mode: AiAssistMode; draftId?: string; sourceText?: string; question?: string }) => request<AiSuggestion>(`/projects/${projectId}/ai-assist`, { method: 'POST', body: JSON.stringify(input) }),
  reviewAiSuggestion: (id: string, status: Extract<AiSuggestion['status'], 'accepted' | 'dismissed'>) => request<AiSuggestion>(`/ai-suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
