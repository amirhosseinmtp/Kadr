import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') { probe.close(); reject(new Error('Could not reserve an API test port.')); return; }
    probe.close((cause) => cause ? reject(cause) : resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}/api`;
const dbPath = path.join(tmpdir(), `kadr-workflow-${randomUUID()}.sqlite`);
const uploadDirectory = path.join(tmpdir(), `kadr-workflow-uploads-${randomUUID()}`);
for (const filename of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { await access(filename); throw new Error('The generated isolated database path already exists.'); }
  catch (cause) { if (cause?.code !== 'ENOENT') throw cause; }
}
try { await access(uploadDirectory); throw new Error('The generated isolated upload path already exists.'); }
catch (cause) { if (cause?.code !== 'ENOENT') throw cause; }
let child;
let serverError = '';

function startServer() {
  serverError = '';
  child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: 'test',
      KADR_HOST: '127.0.0.1',
      PORT: String(port),
      KADR_DB_PATH: dbPath,
      KADR_UPLOAD_DIR: uploadDirectory,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { serverError += chunk; });
  return child;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited during startup: ${serverError}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Wait for the loopback listener. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not become ready: ${serverError}`);
}

async function request(method, route, { body, session } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (session) { headers.cookie = session.cookie; headers['x-csrf-token'] = session.csrfToken; }
  const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie') };
}

async function uploadDocument(route, { bytes, filename, title, category, sceneId = '', session }) {
  const headers = {
    'content-type': 'text/plain',
    'x-original-name': encodeURIComponent(filename),
    'x-document-title': encodeURIComponent(title),
    'x-document-category': category,
    'x-document-scene': sceneId,
  };
  if (session) { headers.cookie = session.cookie; headers['x-csrf-token'] = session.csrfToken; }
  const response = await fetch(`${base}${route}`, { method: 'POST', headers, body: bytes });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'The isolated API must stop before its SQLite files are removed.');
}

try {
  startServer();
  await waitUntilReady();
  const registration = await request('POST', '/auth/register', { body: { displayName: 'Workflow Test Owner', email: 'workflow-owner@example.test', password: 'workflow-password-123' } });
  assert.equal(registration.status, 200);
  const session = { cookie: registration.cookie.split(';')[0], csrfToken: registration.data.csrfToken };
  const project = await request('POST', '/projects', { session, body: { title: 'Post Workflow Smoke', format: 'short' } });
  assert.equal(project.status, 201);
  const projectId = project.data.id;
  const scene = await request('POST', `/projects/${projectId}/scenes`, { session, body: { heading: 'INT. PERSIAN STUDIO - DAY' } });
  assert.equal(scene.status, 201);
  const otherProject = await request('POST', '/projects', { session, body: { title: 'Other Production', format: 'short' } });
  assert.equal(otherProject.status, 201);
  const otherScene = await request('POST', `/projects/${otherProject.data.id}/scenes`, { session, body: { heading: 'EXT. STREET - NIGHT' } });
  assert.equal(otherScene.status, 201);

  const scriptBytes = Buffer.from('INT. PERSIAN STUDIO - DAY\n\nنیما به دفترش نگاه می‌کند.', 'utf8');
  const uploadedDocument = await uploadDocument(`/projects/${projectId}/documents`, {
    bytes: scriptBytes, filename: 'فیلمنامه-مرجع.fountain', title: 'نسخه‌ی مرجع فارسی', category: 'script', sceneId: scene.data.id, session,
  });
  assert.equal(uploadedDocument.status, 201);
  assert.equal(uploadedDocument.data.sceneHeading, scene.data.heading);
  assert.equal(uploadedDocument.data.originalName, 'فیلمنامه-مرجع.fountain');
  assert.equal(uploadedDocument.data.sizeBytes, scriptBytes.length);
  const documentId = uploadedDocument.data.id;
  const uploadedPath = path.join(uploadDirectory, `${documentId}.txt`);
  assert.deepEqual(await readFile(uploadedPath), scriptBytes);
  const invalidSignature = await uploadDocument(`/projects/${projectId}/documents`, {
    bytes: Buffer.from('not a PNG'), filename: 'invalid.png', title: 'Invalid image', category: 'image', session,
  });
  assert.equal(invalidSignature.status, 400);
  const crossProjectScene = await uploadDocument(`/projects/${projectId}/documents`, {
    bytes: scriptBytes, filename: 'script.txt', title: 'Wrong project scene', category: 'script', sceneId: otherScene.data.id, session,
  });
  assert.equal(crossProjectScene.status, 400);

  const stage = await request('POST', `/projects/${projectId}/tasks`, { session, body: { title: 'Sound mix', department: 'Sound', phase: 'post-production', priority: 'high', dueDate: '2030-05-11' } });
  assert.equal(stage.status, 201);
  assert.equal(stage.data.phase, 'post-production');
  const invalidPhase = await request('POST', `/projects/${projectId}/tasks`, { session, body: { title: 'Bad phase', phase: 'festival' } });
  assert.equal(invalidPhase.status, 400);
  const taskId = stage.data.id;
  const moved = await request('PATCH', `/tasks/${taskId}`, { session, body: { phase: 'archive' } });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.phase, 'archive');
  const activity = await request('GET', `/projects/${projectId}/activity`, { session });
  assert.equal(activity.status, 200);
  assert(activity.data.some((item) => item.eventType === 'production.task_phase_updated'));

  const invitation = await request('POST', '/workspace/invitations', { session, body: { email: 'workflow-viewer@example.test', role: 'viewer', projectId } });
  assert.equal(invitation.status, 201);
  const viewerReply = await request('POST', '/auth/register', { body: { displayName: 'Workflow Viewer', email: 'workflow-viewer@example.test', password: 'viewer-password-123', invitationToken: invitation.data.invitationToken } });
  assert.equal(viewerReply.status, 200);
  const viewer = { cookie: viewerReply.cookie.split(';')[0], csrfToken: viewerReply.data.csrfToken };
  const viewerDocuments = await request('GET', `/projects/${projectId}/documents`, { session: viewer });
  assert.equal(viewerDocuments.status, 200);
  assert.equal(viewerDocuments.data[0].id, documentId);
  const viewerDownload = await fetch(`${base}/documents/${documentId}/file`, { headers: { cookie: viewer.cookie } });
  assert.equal(viewerDownload.status, 200);
  assert.deepEqual(Buffer.from(await viewerDownload.arrayBuffer()), scriptBytes);
  assert.equal((await uploadDocument(`/projects/${projectId}/documents`, {
    bytes: scriptBytes, filename: 'unauthorized.txt', title: 'Unauthorized', category: 'script', session: viewer,
  })).status, 403);
  assert.equal((await request('DELETE', `/documents/${documentId}`, { session: viewer })).status, 403);
  assert.equal((await request('GET', `/projects/${projectId}/tasks`, { session: viewer })).status, 200);
  assert.equal((await request('PATCH', `/tasks/${taskId}`, { session: viewer, body: { phase: 'production' } })).status, 403);
  assert.equal((await request('POST', `/projects/${projectId}/tasks`, { session: viewer, body: { title: 'Unauthorized task', phase: 'archive' } })).status, 403);

  assert.equal((await request('PATCH', `/tasks/${taskId}`, { session, body: { status: 'doing' } })).status, 200);
  const viewerInbox = await request('GET', '/notifications', { session: viewer });
  assert.equal(viewerInbox.status, 200);
  assert.equal(viewerInbox.data.unreadCount, 1);
  assert.equal(viewerInbox.data.notifications[0].actorName, 'Workflow Test Owner');
  assert.equal(viewerInbox.data.notifications[0].projectTitle, 'Post Workflow Smoke');
  assert.equal((await request('GET', '/notifications', { session })).data.unreadCount, 0);
  assert.equal((await request('PATCH', `/notifications/${viewerInbox.data.notifications[0].id}/read`, { session })).status, 404);
  assert.equal((await request('PATCH', `/notifications/${viewerInbox.data.notifications[0].id}/read`, { session: viewer })).status, 200);
  assert.equal((await request('GET', '/notifications', { session: viewer })).data.unreadCount, 0);
  assert.equal((await request('POST', `/projects/${projectId}/tasks`, { session, body: { title: 'Delivery master', department: 'Delivery', phase: 'archive' } })).status, 201);
  assert.equal((await request('GET', '/notifications', { session: viewer })).data.unreadCount, 1);
  assert.deepEqual((await request('PATCH', '/notifications/read-all', { session: viewer })).data, { updatedCount: 1 });

  await stopServer();
  startServer();
  await waitUntilReady();
  const restored = await request('GET', `/projects/${projectId}/tasks`, { session });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.find((task) => task.id === taskId).phase, 'archive');
  const restoredDocuments = await request('GET', `/projects/${projectId}/documents`, { session });
  assert.equal(restoredDocuments.status, 200);
  assert.equal(restoredDocuments.data[0].id, documentId);
  const restoredDownload = await fetch(`http://127.0.0.1:${port}${restoredDocuments.data[0].downloadUrl}`, { headers: { cookie: session.cookie } });
  assert.equal(restoredDownload.status, 200);
  assert.deepEqual(Buffer.from(await restoredDownload.arrayBuffer()), scriptBytes);
  const restoredInbox = await request('GET', '/notifications', { session: viewer });
  assert.equal(restoredInbox.status, 200);
  assert.equal(restoredInbox.data.unreadCount, 0);
  assert(restoredInbox.data.notifications.every((notification) => notification.readAt));
  const secondBytes = Buffer.from('A location reference.', 'utf8');
  const secondDocument = await uploadDocument(`/projects/${otherProject.data.id}/documents`, {
    bytes: secondBytes, filename: 'location.txt', title: 'Location notes', category: 'reference', sceneId: otherScene.data.id, session,
  });
  assert.equal(secondDocument.status, 201);
  const secondPath = path.join(uploadDirectory, `${secondDocument.data.id}.txt`);
  assert.equal((await readdir(uploadDirectory)).length, 2);
  assert.equal((await request('DELETE', `/documents/${documentId}`, { session })).status, 204);
  await assert.rejects(access(uploadedPath), { code: 'ENOENT' });
  assert.equal((await request('GET', `/projects/${projectId}/documents`, { session })).data.length, 0);
  assert.equal((await request('DELETE', `/projects/${otherProject.data.id}`, { session })).status, 204);
  await assert.rejects(access(secondPath), { code: 'ENOENT' });
  assert.equal((await readdir(uploadDirectory)).length, 0);
  console.log('PASS: workflow data and private project attachments persist across an API restart; scene links, role restrictions, downloads, and coordinated file cleanup work.');
} catch (cause) {
  console.error(cause);
  if (serverError) console.error(serverError);
  process.exitCode = 1;
} finally {
  await stopServer();
  for (const filename of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(filename, { force: true });
  await rm(uploadDirectory, { recursive: true, force: true });
}
