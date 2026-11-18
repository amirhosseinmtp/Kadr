import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { appendScreenplayRevision, screenplayRevisionChanged } from './screenplay-revisions.js';

function revisionDatabase() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE screenplay_revisions (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL,
    UNIQUE(draft_id, revision_number)
  )`);
  return db;
}

test('only changed title or body creates a screenplay revision', () => {
  const baseline = { title: 'First draft', body: 'Scene one.' };
  assert.equal(screenplayRevisionChanged(baseline, baseline), false);
  assert.equal(screenplayRevisionChanged(baseline, { ...baseline, title: 'Second draft' }), true);
  assert.equal(screenplayRevisionChanged(baseline, { ...baseline, body: 'Scene two.' }), true);
});

test('revision numbers increase per draft and preserve restored source snapshots', () => {
  const db = revisionDatabase();
  try {
    const first = { title: 'Draft one', body: 'Original scene.' };
    const second = { title: 'Draft two', body: 'Rewritten scene.' };
    assert.equal(appendScreenplayRevision(db, 'draft-a', first, 'writer-a', '2030-01-01T00:00:00.000Z').revisionNumber, 1);
    assert.equal(appendScreenplayRevision(db, 'draft-a', second, 'writer-a', '2030-01-02T00:00:00.000Z').revisionNumber, 2);
    assert.equal(appendScreenplayRevision(db, 'draft-b', first, 'writer-b', '2030-01-02T00:00:00.000Z').revisionNumber, 1);
    assert.equal(appendScreenplayRevision(db, 'draft-a', first, 'writer-a', '2030-01-03T00:00:00.000Z').revisionNumber, 3);
    const history = db.prepare('SELECT revision_number AS revisionNumber, title, body FROM screenplay_revisions WHERE draft_id = ? ORDER BY revision_number DESC').all('draft-a');
    assert.deepEqual(history, [
      { revisionNumber: 3, title: 'Draft one', body: 'Original scene.' },
      { revisionNumber: 2, title: 'Draft two', body: 'Rewritten scene.' },
      { revisionNumber: 1, title: 'Draft one', body: 'Original scene.' },
    ]);
  } finally { db.close(); }
});
