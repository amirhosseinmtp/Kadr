import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDirectory = path.resolve(process.cwd(), 'server/data');
mkdirSync(dataDirectory, { recursive: true });

export const db = new Database(process.env.KADR_DB_PATH ?? path.join(dataDirectory, 'kadr.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'development',
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        logline TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS screenplay_drafts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS casting_roles (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        character TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
        candidate TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS production_tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, department TEXT NOT NULL DEFAULT 'General', due_date TEXT,
        status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_drafts_project ON screenplay_drafts(project_id);
      CREATE INDEX IF NOT EXISTS idx_roles_project ON casting_roles(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON production_tasks(project_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS shooting_days (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        shoot_date TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', call_time TEXT,
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(project_id, shoot_date)
      );
      CREATE TABLE IF NOT EXISTS production_scenes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        screenplay_order INTEGER NOT NULL CHECK(screenplay_order > 0),
        heading TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'unspecified',
        location TEXT NOT NULL DEFAULT '', time_of_day TEXT NOT NULL DEFAULT 'unspecified',
        characters_json TEXT NOT NULL DEFAULT '[]', props_json TEXT NOT NULL DEFAULT '[]',
        costumes_json TEXT NOT NULL DEFAULT '[]', set_dressing_json TEXT NOT NULL DEFAULT '[]',
        estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK(estimated_minutes >= 0),
        production_notes TEXT NOT NULL DEFAULT '', continuity_notes TEXT NOT NULL DEFAULT '',
        shoot_status TEXT NOT NULL DEFAULT 'unplanned',
        shooting_day_id TEXT REFERENCES shooting_days(id) ON DELETE SET NULL,
        shooting_order INTEGER CHECK(shooting_order IS NULL OR shooting_order > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, screenplay_order)
      );
      CREATE TABLE IF NOT EXISTS ai_suggestions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        draft_id TEXT REFERENCES screenplay_drafts(id) ON DELETE SET NULL,
        mode TEXT NOT NULL, source_text TEXT NOT NULL, result TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'suggested', created_at TEXT NOT NULL, reviewed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_scenes_project_order ON production_scenes(project_id, screenplay_order);
      CREATE INDEX IF NOT EXISTS idx_scenes_shooting_order ON production_scenes(shooting_day_id, shooting_order);
      CREATE INDEX IF NOT EXISTS idx_shooting_days_project_date ON shooting_days(project_id, shoot_date);
      CREATE INDEX IF NOT EXISTS idx_ai_suggestions_project ON ai_suggestions(project_id, created_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE projects ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN genre TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN duration_minutes INTEGER CHECK(duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 100000);
      ALTER TABLE projects ADD COLUMN language_code TEXT NOT NULL DEFAULT 'fa';
      ALTER TABLE projects ADD COLUMN director TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN writer TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN producer TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN target_date TEXT;

      CREATE TABLE talent_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, profession TEXT NOT NULL DEFAULT 'actor',
        biography TEXT NOT NULL DEFAULT '', skills_json TEXT NOT NULL DEFAULT '[]',
        languages_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]',
        showreel_url TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '', private_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_talent_name ON talent_profiles(name COLLATE NOCASE);
      CREATE TABLE casting_assignments (
        id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES casting_roles(id) ON DELETE CASCADE,
        talent_id TEXT NOT NULL REFERENCES talent_profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'considering' CHECK(status IN ('considering','audition','shortlist','cast','declined')),
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(role_id, talent_id)
      );
      CREATE INDEX idx_casting_assignments_role ON casting_assignments(role_id);

      CREATE TABLE production_locations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_locations_name ON production_locations(name COLLATE NOCASE);
      ALTER TABLE production_scenes ADD COLUMN location_id TEXT REFERENCES production_locations(id) ON DELETE SET NULL;

      CREATE TABLE production_resources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('prop','costume','set-dressing','equipment','vehicle','other')),
        description TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE scene_resources (
        scene_id TEXT NOT NULL REFERENCES production_scenes(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES production_resources(id) ON DELETE CASCADE,
        PRIMARY KEY(scene_id, resource_id)
      );
      CREATE INDEX idx_scene_resources_resource ON scene_resources(resource_id);

      CREATE TABLE project_members (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, UNIQUE(project_id, name, role)
      );
      CREATE INDEX idx_project_members_project ON project_members(project_id);
      ALTER TABLE production_tasks ADD COLUMN assignee_id TEXT REFERENCES project_members(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner','admin','producer','director','writer','casting_director','production','viewer')),
        created_at TEXT NOT NULL, PRIMARY KEY(workspace_id, user_id)
      );
      CREATE TABLE project_access (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('director','writer','casting_director','producer','production','viewer')),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(project_id, user_id)
      );
      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_expiry ON auth_sessions(expires_at);
      CREATE TABLE auth_login_attempts (
        email TEXT NOT NULL COLLATE NOCASE, remote_hash TEXT NOT NULL,
        failed_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
        PRIMARY KEY(email, remote_hash)
      );
      CREATE TABLE workspace_invitations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        email TEXT NOT NULL COLLATE NOCASE,
        role TEXT NOT NULL CHECK(role IN ('admin','producer','director','writer','casting_director','production','viewer')),
        token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
        accepted_at TEXT, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_invitations_workspace ON workspace_invitations(workspace_id, created_at DESC);
      ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;
      ALTER TABLE talent_profiles ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
      ALTER TABLE production_locations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
      ALTER TABLE production_resources ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
      CREATE INDEX idx_projects_workspace ON projects(workspace_id, updated_at DESC);
      CREATE INDEX idx_talents_workspace ON talent_profiles(workspace_id, name COLLATE NOCASE);
      CREATE INDEX idx_locations_workspace ON production_locations(workspace_id, name COLLATE NOCASE);
      CREATE INDEX idx_resources_workspace ON production_resources(workspace_id, name COLLATE NOCASE);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('project','screenplay','scene')),
        scope_id TEXT,
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 8000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((scope_type = 'project' AND scope_id IS NULL) OR (scope_type <> 'project' AND scope_id IS NOT NULL))
      );
      CREATE INDEX idx_comments_project_created ON project_comments(project_id, created_at DESC);
      CREATE INDEX idx_comments_scope ON project_comments(scope_type, scope_id, created_at DESC);

      CREATE TABLE project_activity (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        actor_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_activity_project_created ON project_activity(project_id, created_at DESC);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE project_personal_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 8000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, user_id)
      );
      CREATE INDEX idx_personal_notes_user_project ON project_personal_notes(user_id, project_id);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE call_sheets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        shooting_day_id TEXT NOT NULL UNIQUE REFERENCES shooting_days(id) ON DELETE CASCADE,
        unit_call_time TEXT NOT NULL DEFAULT '',
        meal_time TEXT NOT NULL DEFAULT '',
        meeting_point TEXT NOT NULL DEFAULT '',
        transport_notes TEXT NOT NULL DEFAULT '',
        safety_notes TEXT NOT NULL DEFAULT '',
        general_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE call_sheet_cast_calls (
        id TEXT PRIMARY KEY,
        call_sheet_id TEXT NOT NULL REFERENCES call_sheets(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES casting_assignments(id) ON DELETE CASCADE,
        call_time TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        UNIQUE(call_sheet_id, assignment_id)
      );
      CREATE INDEX idx_call_sheet_cast_sheet ON call_sheet_cast_calls(call_sheet_id);
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE call_sheet_cast_calls ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK(availability_status IN ('unknown','available','hold','unavailable'));
      CREATE TABLE call_sheet_crew_calls (
        id TEXT PRIMARY KEY,
        call_sheet_id TEXT NOT NULL REFERENCES call_sheets(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
        call_time TEXT NOT NULL DEFAULT '',
        availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK(availability_status IN ('unknown','available','hold','unavailable')),
        notes TEXT NOT NULL DEFAULT '',
        UNIQUE(call_sheet_id, member_id)
      );
      CREATE INDEX idx_call_sheet_crew_sheet ON call_sheet_crew_calls(call_sheet_id);
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE projects ADD COLUMN budget_currency TEXT NOT NULL DEFAULT 'IRR'
        CHECK(budget_currency IN ('IRR','USD','EUR'));
      CREATE TABLE project_budget_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
        department TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL CHECK(category IN ('development','cast','crew','location','equipment','art','travel','meals','insurance','post-production','contingency','other')),
        vendor_name TEXT NOT NULL DEFAULT '',
        estimated_amount INTEGER NOT NULL DEFAULT 0 CHECK(estimated_amount BETWEEN 0 AND 1000000000000),
        committed_amount INTEGER NOT NULL DEFAULT 0 CHECK(committed_amount BETWEEN 0 AND 1000000000000),
        actual_amount INTEGER NOT NULL DEFAULT 0 CHECK(actual_amount BETWEEN 0 AND 1000000000000),
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','committed','paid')),
        due_date TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_budget_project_status ON project_budget_items(project_id, status, due_date);
      CREATE INDEX idx_project_budget_category ON project_budget_items(project_id, category);
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE production_tasks ADD COLUMN phase TEXT NOT NULL DEFAULT 'production'
        CHECK(phase IN ('development','pre-production','production','post-production','archive'));
      CREATE INDEX idx_tasks_project_phase_status ON production_tasks(project_id, phase, status);
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE user_notifications (
        id TEXT PRIMARY KEY,
        recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES project_activity(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        read_at TEXT,
        UNIQUE(recipient_user_id, activity_id)
      );
      CREATE INDEX idx_notifications_recipient_unread ON user_notifications(recipient_user_id, read_at, created_at DESC);
      CREATE INDEX idx_notifications_project ON user_notifications(project_id, created_at DESC);
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE project_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scene_id TEXT REFERENCES production_scenes(id) ON DELETE SET NULL,
        uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
        original_name TEXT NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
        category TEXT NOT NULL CHECK(category IN ('script','reference','contract','image','video','audio','other')),
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
        storage_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_documents_project_created ON project_documents(project_id, created_at DESC);
      CREATE INDEX idx_project_documents_scene ON project_documents(scene_id);
    `,
  },
];

for (const migration of migrations) {
  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
  if (!applied) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
    })();
  }
}

const count = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
if (count.count === 0) {
  const now = new Date().toISOString();
  const insertProject = db.prepare(`INSERT INTO projects (id, title, format, status, progress, logline, created_at, updated_at)
    VALUES (@id, @title, @format, @status, @progress, @logline, @createdAt, @updatedAt)`);
  const insertTask = db.prepare(`INSERT INTO production_tasks (id, project_id, title, department, due_date, status, priority, created_at)
    VALUES (@id, @projectId, @title, @department, @dueDate, @status, @priority, @createdAt)`);
  db.transaction(() => {
    const projects = [
      { id: randomUUID(), title: 'آخرین قاب', format: 'feature', status: 'development', progress: 38, logline: 'عکاس جوانی در جست‌وجوی آخرین تصویر پدرش، به رازهای یک خانواده برمی‌خورد.' },
      { id: randomUUID(), title: 'خانه‌ی آبی', format: 'short', status: 'pre-production', progress: 72, logline: 'یک خانه‌ی قدیمی، نقطه‌ی تلاقی سه نسل از زنان یک خانواده است.' },
      { id: randomUUID(), title: 'شهرِ بی‌صدا', format: 'documentary', status: 'production', progress: 54, logline: 'پرتره‌ای از زندگی روزمره در شهری که هر روز آرام‌تر می‌شود.' },
    ];
    projects.forEach((project) => {
      insertProject.run({ ...project, createdAt: now, updatedAt: now });
      if (project.title === 'خانه‌ی آبی') {
        insertTask.run({ id: randomUUID(), projectId: project.id, title: 'هماهنگی بازدید لوکیشن', department: 'تولید', dueDate: null, status: 'doing', priority: 'high', createdAt: now });
        insertTask.run({ id: randomUUID(), projectId: project.id, title: 'نهایی‌کردن گروه فیلم‌برداری', department: 'تولید', dueDate: null, status: 'todo', priority: 'medium', createdAt: now });
      }
    });
  })();
}
