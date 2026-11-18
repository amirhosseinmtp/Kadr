# Kadr

Kadr is a local-first filmmaking workspace for project development and production coordination. This clean application lives separately from the preserved reference clone at `C:\Users\Zhavest.ir\Documents\Codex\Kadr`.

## Product and repository audit

The reference GitHub repository was empty when inspected: it contained no application files, README, commits, or branches, and the repository exposed no GitHub issues. The new application therefore starts from a separate codebase and does not alter the reference clone or its remote.

## Stack and architecture

- **Client:** React 19, TypeScript, Vite, and Lucide icons.
- **API:** Express 5 with typed request/response boundaries.
- **Persistence:** SQLite through `better-sqlite3`, with versioned SQL migrations and foreign-key enforcement.
- **Domain types:** shared TypeScript models in `shared/`.
- **AI boundary:** provider interface with an OpenAI-compatible HTTP adapter. The server reads credentials from its environment; the browser never receives provider keys.

The client separates reusable components, feature workspaces, localization, and API access. The server separates HTTP routing, domain parsing, AI integration, and database migrations. The data model connects projects to screenplay drafts, casting roles and talent, crew and phase-aware tasks, scene breakdowns, shared locations and resources, shooting days, call sheets, project-budget line items, recipient-scoped notifications, and reviewable AI suggestions. Scene screenplay order is stored separately from shooting order. Migrations are additive and versioned; upgrades retain earlier local records.

```text
client/src/components/   Shared navigation and project UI
client/src/features/     Screenplay, casting, production, scene, and call-sheet workspaces
client/src/lib/           Typed API client and Persian/English messages
server/src/domain/        Screenplay, scene, and production-planning helpers
server/src/services/      Provider-independent AI service boundary
server/src/               Express API and SQLite migrations/seed data
shared/                   Client/server domain types
```

## Run locally

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` requests to the Express API on `127.0.0.1:5174`. Both processes bind to loopback. SQLite is created at `server/data/kadr.sqlite` on first run; set `KADR_DB_PATH` to choose another file and `PORT` to change the API port. Private project attachments are stored in `server/data/uploads` by default; set `KADR_UPLOAD_DIR` to choose another local directory. Back up the database and upload directory together, keep both private, and do not expose the upload directory as static web content. Individual attachments are limited to 25 MB. Set `KADR_HOST` only when intentionally binding the API to another interface; remote use needs a TLS reverse proxy and production-mode secure cookies.

The first database run seeds three editable sample productions. Use a separate `KADR_DB_PATH` for a clean workspace.

## Accounts and collaboration

On an empty database, the first person creates the workspace owner account. If the database already has local sample projects or records, that first account claims unowned records without deleting them. Further accounts require a valid, unexpired email-bound invitation. A workspace owner, admin, or producer can create workspace invitations; producers can also invite a person to a project they manage. The invitation token is returned once, so share it privately with the intended person. New invitees create an account with that exact email. Existing account holders can sign in with the token in the optional invitation field. Accounts can create and switch among multiple workspaces from the sidebar. Password reset is not implemented yet.

Sessions are persisted server-side and use an HttpOnly, SameSite cookie with an associated CSRF token for writes. Passwords use Node scrypt; session and invitation tokens are stored as hashes. Project invitations grant only the selected project role. Workspace members can use workspace-scoped shared libraries; project-only accounts see library records linked to their accessible projects, and talent contact details remain restricted to authorized casting users. Keep the database file private and put any remote deployment behind HTTPS.

## AI configuration

AI is optional. Without configuration, the assistant returns a clear `503` setup message and does not generate demo content. To enable an OpenAI-compatible chat-completions provider, set these variables in the **server process environment** before starting Kadr:

- `AI_API_KEY` — provider credential, server-side only.
- `AI_MODEL` — model identifier supported by the provider.
- `AI_BASE_URL` — optional API root; defaults to `https://api.openai.com/v1`.

For example, in PowerShell, set `$env:AI_API_KEY`, `$env:AI_MODEL`, and optionally `$env:AI_BASE_URL` before `npm run dev`. Never put provider credentials in client code or commit them. Script text is sent to the configured provider only when a user explicitly submits an AI request. Results are stored as separate suggestions; accepting one does not edit screenplay content.

## Current working foundation

- Persian RTL by default, English interface localization, responsive layout, and a locally persisted light/dark appearance preference.
- Dashboard project statistics come from SQLite-backed records; dated open tasks and future shooting days are listed with overdue highlighting and direct navigation.
- Persistent project metadata, screenplay draft, casting-role, production-task, and project crew CRUD.
- Structured screenplay blocks for scene headings, action, character cues, parentheticals, dialogue, and transitions; saves to a Fountain-compatible text representation.
- Per-draft, numbered screenplay snapshots on each changed save; inspect read-only earlier text and restore it as a new revision without deleting later work. Existing drafts are backfilled into the first history entry.
- Searchable talent profiles, role-linked casting assignments, candidate stages, and separately revealed contact/private-note fields.
- Scene breakdown for reusable location links, time of day, characters, props, costumes, set dressing, production notes, continuity, and estimated duration.
- Reusable locations and production resources that can be linked to scenes across projects; project crew roster and task ownership.
- Import/reconcile scene headings from a draft without discarding existing breakdown metadata.
- Shooting-day creation and scene assignment with call times, aggregate scene counts/duration, and independent screenplay/shooting order.
- Persistent, printable call sheets generated from a shooting day’s ordered scenes, breakdowns, linked resources, confirmed cast, and project crew; cast and crew get individual call times, availability (`unknown`, `available`, `hold`, `unavailable`), and coordination notes, alongside meal time, meeting point, transport, safety, and production notes.
- Project budget ledger with a chosen project currency, categorized estimates, commitments and actual costs, payee, due date, notes, searchable status filters, accurate totals/variance, role-based edits, and activity history; currency cannot be changed while line items remain.
- Persistent project tasks are now classified across development, pre-production, production, post-production, and archive. A post-production starter checklist can add editable tasks for picture editing, sound, music, color, VFX, review, and delivery, with the same assignment, deadline, priority, and status workflow as set tasks.
- Optional project-aware AI analysis with persisted suggestions and explicit accept/dismiss review.
- Persistent project discussion linked to a project, screenplay draft, or production scene; personal notes are isolated per user and never enter the shared activity feed.
- Persistent in-app project notifications are generated from shared activity for other current project members, scoped to the recipient and active workspace, with unread counts, individual/read-all actions, and direct navigation to the affected filmmaking module.
- Private project attachments with validated file signatures, stored metadata, optional scene links, project-role access checks, authenticated downloads, and coordinated cleanup when a file or project is deleted. PDF, Fountain-compatible text, common image formats, short video references, and audio references are supported up to 25 MB per file.
- Project activity history with actor snapshots for project, screenplay, casting, production, and discussion events; commenting and team management are enforced by project roles.
- SQLite migrations preserve foreign-key integrity; deleting a shooting day returns its assigned scenes to the unplanned state.

This is a local-first foundation with server-enforced accounts, workspace membership, project roles, invitation acceptance for new and existing accounts, workspace switching, and authorization around private casting details. Crew members are still a project roster used for assignment rather than live user-linked team records. Larger footage libraries need external object storage; password recovery, archived asset delivery, and live user-linked crew records remain future work. AI integrations remain optional and require server-side credentials.

## Verify and build

```sh
npm test
npm run test:workflow
npm run typecheck
npm run build
npm start
```

`npm test` runs scene-heading parsing, screenplay revision persistence rules, call-sheet cast matching, budget total validation, and authentication primitive tests. `npm run test:workflow` boots the TypeScript API against isolated temporary SQLite and upload paths and verifies screenplay revision history, workflow phases, notifications, attachment persistence across an API restart, scene links, project-role restrictions, authenticated downloads, and file cleanup. `npm run build` type-checks the client, builds the Vite bundle, and compiles the server. No lint script is configured yet.
