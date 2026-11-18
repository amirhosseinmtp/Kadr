export type ProjectStatus = 'development' | 'pre-production' | 'production' | 'post-production' | 'completed';
export type ProjectFormat = 'feature' | 'short' | 'series' | 'documentary' | 'commercial';
export const budgetCurrencies = ['IRR', 'USD', 'EUR'] as const;
export type BudgetCurrency = (typeof budgetCurrencies)[number];
export const budgetCategories = ['development', 'cast', 'crew', 'location', 'equipment', 'art', 'travel', 'meals', 'insurance', 'post-production', 'contingency', 'other'] as const;
export type BudgetCategory = (typeof budgetCategories)[number];
export type BudgetItemStatus = 'planned' | 'committed' | 'paid';

export interface Project {
  id: string;
  title: string;
  format: ProjectFormat;
  status: ProjectStatus;
  progress: number;
  logline: string;
  synopsis: string;
  genre: string;
  durationMinutes: number | null;
  languageCode: string;
  budgetCurrency: BudgetCurrency;
  director: string;
  writer: string;
  producer: string;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBudgetItem {
  id: string;
  projectId: string;
  title: string;
  department: string;
  category: BudgetCategory;
  vendorName: string;
  estimatedAmount: number;
  committedAmount: number;
  actualAmount: number;
  status: BudgetItemStatus;
  dueDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBudgetSummary {
  estimated: number;
  committed: number;
  actual: number;
  variance: number;
}

export interface ProjectBudget {
  projectId: string;
  currencyCode: BudgetCurrency;
  currencyLocked: boolean;
  items: ProjectBudgetItem[];
  summary: ProjectBudgetSummary;
}

export const projectDocumentCategories = ['script', 'reference', 'contract', 'image', 'video', 'audio', 'other'] as const;
export type ProjectDocumentCategory = (typeof projectDocumentCategories)[number];
export interface ProjectDocument {
  id: string;
  projectId: string;
  sceneId: string | null;
  sceneHeading: string | null;
  title: string;
  originalName: string;
  category: ProjectDocumentCategory;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: string;
  downloadUrl: string;
}

export type ProjectBudgetItemInput = Pick<ProjectBudgetItem, 'title' | 'department' | 'category' | 'vendorName' | 'estimatedAmount' | 'committedAmount' | 'actualAmount' | 'status' | 'dueDate' | 'notes'>;

export interface ScreenplayDraft {
  id: string;
  projectId: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface ScreenplayRevisionSummary {
  id: string;
  draftId: string;
  revisionNumber: number;
  title: string;
  bodyLength: number;
  bodyPreview: string;
  createdByName: string;
  createdAt: string;
}

export interface ScreenplayRevision extends ScreenplayRevisionSummary {
  body: string;
}

export type CastingStatus = 'open' | 'shortlist' | 'cast';

export interface CastingRole {
  id: string;
  projectId: string;
  character: string;
  description: string;
  status: CastingStatus;
  candidate: string;
  createdAt: string;
}

export interface TalentProfile {
  id: string;
  name: string;
  profession: string;
  biography: string;
  skills: string[];
  languages: string[];
  tags: string[];
  showreelUrl: string;
  createdAt: string;
  updatedAt: string;
  private?: { contactEmail: string; contactPhone: string; notes: string };
}

export type CastingAssignmentStatus = 'considering' | 'audition' | 'shortlist' | 'cast' | 'declined';
export interface CastingAssignment {
  id: string;
  roleId: string;
  talentId: string;
  status: CastingAssignmentStatus;
  notes: string;
  createdAt: string;
}

export interface ProductionLocation {
  id: string;
  name: string;
  category: string;
  address: string;
  notes: string;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  updatedAt: string;
}

export type ProductionResourceKind = 'prop' | 'costume' | 'set-dressing' | 'equipment' | 'vehicle' | 'other';
export interface ProductionResource {
  id: string;
  name: string;
  kind: ProductionResourceKind;
  description: string;
  quantity: number;
  notes: string;
  sceneIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  name: string;
  role: string;
  department: string;
  createdAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export const projectWorkflowPhases = ['development', 'pre-production', 'production', 'post-production', 'archive'] as const;
export type ProjectWorkflowPhase = (typeof projectWorkflowPhases)[number];

export interface ProductionTask {
  id: string;
  projectId: string;
  title: string;
  department: string;
  phase: ProjectWorkflowPhase;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
}

export type SceneEnvironment = 'interior' | 'exterior' | 'mixed' | 'unspecified';
export type SceneTimeOfDay = 'day' | 'night' | 'dawn' | 'dusk' | 'unspecified';
export type SceneShootStatus = 'unplanned' | 'scheduled' | 'shot';

export interface ProductionScene {
  id: string;
  projectId: string;
  screenplayOrder: number;
  heading: string;
  environment: SceneEnvironment;
  location: string;
  locationId: string | null;
  timeOfDay: SceneTimeOfDay;
  characters: string[];
  props: string[];
  costumes: string[];
  setDressing: string[];
  estimatedMinutes: number;
  productionNotes: string;
  continuityNotes: string;
  shootStatus: SceneShootStatus;
  shootingDayId: string | null;
  shootingOrder: number | null;
  shootingDate: string | null;
  shootingDayTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShootingDay {
  id: string;
  projectId: string;
  shootDate: string;
  title: string;
  callTime: string | null;
  notes: string;
  sceneCount: number;
  totalEstimatedMinutes: number;
  createdAt: string;
}

export interface CallSheetScene {
  id: string;
  screenplayOrder: number;
  shootingOrder: number;
  heading: string;
  environment: SceneEnvironment;
  location: string;
  timeOfDay: SceneTimeOfDay;
  characters: string[];
  estimatedMinutes: number;
  productionNotes: string;
  continuityNotes: string;
  resources: string[];
}

export type AvailabilityStatus = 'unknown' | 'available' | 'hold' | 'unavailable';

export interface CallSheetCastCall {
  assignmentId: string;
  character: string;
  talentName: string;
  callTime: string;
  availability: AvailabilityStatus;
  notes: string;
}

export interface CallSheetCrewCall {
  memberId: string;
  name: string;
  role: string;
  department: string;
  callTime: string;
  availability: AvailabilityStatus;
  notes: string;
}

export type CallSheetInput = Pick<CallSheet, 'unitCallTime' | 'mealTime' | 'meetingPoint' | 'transportNotes' | 'safetyNotes' | 'generalNotes'> & {
  castCalls: Pick<CallSheetCastCall, 'assignmentId' | 'callTime' | 'availability' | 'notes'>[];
  crewCalls: Pick<CallSheetCrewCall, 'memberId' | 'callTime' | 'availability' | 'notes'>[];
};

export interface CallSheet {
  id: string | null;
  projectId: string;
  projectTitle: string;
  shootingDayId: string;
  shootDate: string;
  dayTitle: string;
  unitCallTime: string;
  mealTime: string;
  meetingPoint: string;
  transportNotes: string;
  safetyNotes: string;
  generalNotes: string;
  castCalls: CallSheetCastCall[];
  crewCalls: CallSheetCrewCall[];
  scenes: CallSheetScene[];
  updatedAt: string | null;
}

export type AiAssistMode = 'screenplay-analysis' | 'character-analysis' | 'scene-breakdown' | 'production-plan';
export type AiSuggestionStatus = 'suggested' | 'accepted' | 'dismissed';

export interface AiSuggestion {
  id: string;
  projectId: string;
  draftId: string | null;
  mode: AiAssistMode;
  sourceText: string;
  result: string;
  status: AiSuggestionStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AiAssistRequest {
  mode: AiAssistMode;
  draftId?: string;
  sourceText?: string;
  question?: string;
}

export interface ApiError {
  error: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'producer' | 'director' | 'writer' | 'casting_director' | 'production' | 'viewer';
export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  workspaceMember: boolean;
}
export interface AuthSession {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AuthUser;
  csrfToken?: string;
}
export interface WorkspaceMember {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}
export interface WorkspaceOption {
  id: string;
  name: string;
  role: WorkspaceRole;
}
export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  projectId: string | null;
  expiresAt: string;
  createdAt: string;
}
export type ProjectCommentScope = 'project' | 'screenplay' | 'scene';
export interface ProjectComment {
  id: string;
  projectId: string;
  authorId: string | null;
  authorName: string;
  scopeType: ProjectCommentScope;
  scopeId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}
export interface ProjectActivity {
  id: string;
  projectId: string;
  actorName: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}
export interface ProjectNotification {
  id: string;
  projectId: string;
  projectTitle: string;
  actorName: string;
  eventType: string;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationInbox {
  notifications: ProjectNotification[];
  unreadCount: number;
}
