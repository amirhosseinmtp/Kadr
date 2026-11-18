import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface RevisionContent {
  title: string;
  body: string;
}

export function screenplayRevisionChanged(current: RevisionContent, next: RevisionContent): boolean {
  return current.title !== next.title || current.body !== next.body;
}

export function appendScreenplayRevision(db: Database.Database, draftId: string, content: RevisionContent, createdBy: string | null, createdAt: string) {
  const row = db.prepare('SELECT COALESCE(MAX(revision_number), 0) + 1 AS revisionNumber FROM screenplay_revisions WHERE draft_id = ?').get(draftId) as { revisionNumber: number };
  const id = randomUUID();
  db.prepare(`INSERT INTO screenplay_revisions (id, draft_id, revision_number, title, body, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, draftId, row.revisionNumber, content.title, content.body, createdBy, createdAt);
  return { id, revisionNumber: row.revisionNumber };
}
