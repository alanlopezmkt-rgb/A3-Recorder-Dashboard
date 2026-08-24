# A3-OS Supabase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing A3-OS Chrome extension and the existing local Whisper/CUDA transcriber through a new Supabase backend (Auth + Postgres + Storage), so recordings made in the extension become transcription jobs the local worker picks up automatically, with collaborative (not per-user) course progress.

**Architecture:** Supabase is the only channel between the two existing systems. The extension gains a login screen and, after recording finishes, uploads the audio to Supabase Storage and creates `audio_files`/`transcription_jobs` rows — all in addition to its existing Native Host local-save flow, which is untouched. A new standalone Python script (`supabase_worker.py`) polls `transcription_jobs`, reserves a job atomically, downloads the audio, shells out to the existing unmodified `transcrever.py`, and writes the result back to Supabase.

**Tech Stack:** Supabase (Postgres, Auth, Storage, RLS), `@supabase/supabase-js` (extension, browser bundle), Python `requests` + `python-dotenv` (worker), existing `faster-whisper`/CUDA stack (untouched).

**Spec:** [docs/superpowers/specs/2026-08-23-supabase-integration-design.md](../specs/2026-08-23-supabase-integration-design.md)

## Global Constraints

- Never put `service_role_key` in the extension. Only `SUPABASE_URL` + anon key ship in extension code.
- Never modify `transcrever.py` or any CUDA/Whisper logic.
- Never remove or alter the Native Host's local-save behavior (`native-host/a3os_folder_picker.py`, `salvarAudioNative` in `background.js`).
- `lessons` table enforces `UNIQUE(module_id, lesson_number)` — this is the sole de-duplication mechanism. Never compute progress from `audio_files` counts.
- All writes that assign ownership use `auth.uid()` server-side (RLS), never a client-supplied `user_id`.
- Course/module/lesson catalog data (`courses`, `modules`, `lessons` INSERT/UPDATE) is service-role-only in this phase — no extension UI creates new courses/modules.
- `.env` files with secrets must never be committed; each new one gets a corresponding `.gitignore` entry in the same task that creates it.

---

## File Structure

**Supabase project** (new, via Supabase MCP in this session):
- Migrations applied directly through the MCP `apply_migration` tool — no local migration files required for this plan, but the final SQL is captured in Task 1 for reference/reapplication.

**Extension** (`C:\Users\alanl\OneDrive\Documents\A3-OS-Recorder\extension\`):
- Create `extension/config.js` — `SUPABASE_URL` / `SUPABASE_ANON_KEY` constants (gitignored, template committed as `config.example.js`).
- Create `extension/lib/supabase.js` — thin fetch-based Supabase REST/Auth/Storage client (no bundler dependency, MV3-safe).
- Create `extension/lib/session.js` — session storage (`chrome.storage.local`), login/logout/refresh/getSession.
- Create `extension/login/login.html`, `extension/login/login.css`, `extension/login/login.js` — login screen.
- Modify `extension/manifest.json` — add `login/login.html` accessibility, add Supabase URL to `host_permissions`.
- Modify `extension/background.js` — session-aware routing to login, upload-after-record flow, job creation.
- Modify `extension/popup/popup.html`, `extension/popup/popup.js`, `extension/popup/popup.css` — course/module/lesson pickers, upload/transcription status, logout button, redirect-to-login when unauthenticated.

**Worker** (`C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\`):
- Create `99_SISTEMA/whisper/supabase_worker.py` — polling worker.
- Create `99_SISTEMA/whisper/.env.example` — template for `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / tuning vars.
- Modify `.gitignore` — ensure `.env` is excluded (create if absent).
- Create `99_SISTEMA/whisper/requirements-worker.txt` — `requests`, `python-dotenv`.

---

## Task 1: Supabase project, schema, RLS

**Files:**
- None (Supabase MCP operations only — schema captured here as the source of truth).

**Interfaces:**
- Produces: tables `profiles`, `courses`, `modules`, `lessons`, `audio_files`, `transcription_jobs`, `transcriptions`; storage bucket `audio`; RPC `reserve_transcription_job()`; RPC `course_progress(p_course_id uuid)`; RPC `missing_lessons(p_course_id uuid)`.

- [ ] **Step 1: Create the Supabase project**

Use the Supabase MCP tool `create_project` with name `a3-os`. Wait for it to become `ACTIVE_HEALTHY` (poll `get_project` if needed). Record the returned project ref and the project URL (`get_project_url`) and the anon/publishable key (`get_publishable_keys`) — these are needed in Task 3.

- [ ] **Step 2: Apply the core schema migration**

Use the Supabase MCP tool `apply_migration` with name `core_schema` and this SQL:

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  total_modules int,
  total_lessons int,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  created_at timestamptz not null default now()
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  module_number int not null,
  name text not null,
  total_lessons int,
  created_at timestamptz not null default now(),
  unique (course_id, module_number)
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  lesson_number int not null,
  title text,
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now(),
  unique (module_id, lesson_number)
);

create table audio_files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  storage_path text not null,
  filename text not null,
  mime_type text,
  file_size bigint,
  duration numeric,
  status text not null default 'uploaded' check (status in ('uploaded','pending','processing','completed','failed')),
  created_at timestamptz not null default now()
);

create table transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  audio_file_id uuid not null references audio_files(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts int not null default 0,
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

create table transcriptions (
  id uuid primary key default gen_random_uuid(),
  audio_file_id uuid not null references audio_files(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_audio_files_lesson_id on audio_files(lesson_id);
create index idx_transcription_jobs_status on transcription_jobs(status);
create index idx_transcriptions_lesson_id on transcriptions(lesson_id);
```

- [ ] **Step 2b: Verify the migration**

Use `list_tables` (schema `public`) and confirm all 7 tables appear with the columns above.

- [ ] **Step 3: Create the storage bucket**

Use `execute_sql` (or the Storage API via `execute_sql` against `storage.buckets`) to create a private bucket:

```sql
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;
```

- [ ] **Step 4: Apply RLS policies migration**

Use `apply_migration` with name `rls_policies`:

```sql
alter table profiles enable row level security;
alter table courses enable row level security;
alter table modules enable row level security;
alter table lessons enable row level security;
alter table audio_files enable row level security;
alter table transcription_jobs enable row level security;
alter table transcriptions enable row level security;

-- profiles: user reads/updates only their own row
create policy profiles_select_own on profiles
  for select using (id = auth.uid());
create policy profiles_update_own on profiles
  for update using (id = auth.uid());
create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

-- courses/modules/lessons: read-only for any authenticated user, writes are service-role only (no policy = only service_role bypasses RLS)
create policy courses_select_authenticated on courses
  for select using (auth.role() = 'authenticated');
create policy modules_select_authenticated on modules
  for select using (auth.role() = 'authenticated');
create policy lessons_select_authenticated on lessons
  for select using (auth.role() = 'authenticated');

-- audio_files: any authenticated user can read (collaborative knowledge);
-- insert only as themselves; update restricted to service_role (no policy)
create policy audio_files_select_authenticated on audio_files
  for select using (auth.role() = 'authenticated');
create policy audio_files_insert_own on audio_files
  for insert with check (uploaded_by = auth.uid());

-- transcription_jobs: any authenticated user can read; insert allowed
-- when it references an audio_file they own; updates are service_role only
create policy transcription_jobs_select_authenticated on transcription_jobs
  for select using (auth.role() = 'authenticated');
create policy transcription_jobs_insert_own on transcription_jobs
  for insert with check (
    exists (
      select 1 from audio_files af
      where af.id = audio_file_id and af.uploaded_by = auth.uid()
    )
  );

-- transcriptions: read-only for authenticated users, writes are service_role only
create policy transcriptions_select_authenticated on transcriptions
  for select using (auth.role() = 'authenticated');
```

- [ ] **Step 5: Create the atomic job-reservation RPC**

Use `apply_migration` with name `reserve_job_rpc`:

```sql
create or replace function reserve_transcription_job(p_worker_id text)
returns table (
  job_id uuid,
  audio_file_id uuid,
  storage_path text,
  filename text,
  lesson_id uuid
)
language plpgsql
security definer
as $$
declare
  v_job_id uuid;
begin
  update transcription_jobs
  set status = 'processing',
      started_at = now(),
      worker_id = p_worker_id,
      attempts = attempts + 1
  where id = (
    select id from transcription_jobs
    where status = 'pending'
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning id into v_job_id;

  if v_job_id is null then
    return;
  end if;

  return query
  select tj.id, af.id, af.storage_path, af.filename, af.lesson_id
  from transcription_jobs tj
  join audio_files af on af.id = tj.audio_file_id
  where tj.id = v_job_id;
end;
$$;

create or replace function recover_stuck_jobs(p_timeout_minutes int default 30)
returns int
language sql
security definer
as $$
  with recovered as (
    update transcription_jobs
    set status = 'pending', worker_id = null, started_at = null
    where status = 'processing'
      and started_at < now() - (p_timeout_minutes || ' minutes')::interval
    returning id
  )
  select count(*)::int from recovered;
$$;
```

`security definer` is required because the worker authenticates with the service_role key already (bypasses RLS regardless), but defining these as `security definer` keeps the row-lock logic centralized and reusable if a lower-privileged worker role is introduced later.

- [ ] **Step 6: Create progress RPCs**

Use `apply_migration` with name `progress_rpc`:

```sql
create or replace function course_progress(p_course_id uuid)
returns table (lessons_total int, lessons_completed int, percent numeric, status text)
language sql
stable
as $$
  select
    coalesce(sum(m.total_lessons), 0)::int as lessons_total,
    (
      select count(distinct l.id)
      from lessons l
      join modules m2 on m2.id = l.module_id
      where m2.course_id = p_course_id and l.status = 'completed'
    )::int as lessons_completed,
    case when coalesce(sum(m.total_lessons), 0) = 0 then 0
      else round(
        (
          select count(distinct l.id)
          from lessons l
          join modules m2 on m2.id = l.module_id
          where m2.course_id = p_course_id and l.status = 'completed'
        )::numeric / sum(m.total_lessons) * 100, 2
      )
    end as percent,
    (select status from courses where id = p_course_id) as status
  from modules m
  where m.course_id = p_course_id;
$$;

create or replace function missing_lessons(p_course_id uuid)
returns table (module_number int, lesson_number int)
language sql
stable
as $$
  select m.module_number, gs.lesson_number
  from modules m
  cross join lateral generate_series(1, coalesce(m.total_lessons, 0)) as gs(lesson_number)
  where m.course_id = p_course_id
    and not exists (
      select 1 from lessons l
      where l.module_id = m.id
        and l.lesson_number = gs.lesson_number
        and l.status = 'completed'
    )
  order by m.module_number, gs.lesson_number;
$$;
```

- [ ] **Step 7: Run advisors and confirm no security warnings on the new tables**

Use `get_advisors` with type `security`. Confirm the only findings are pre-existing/unrelated (there should be none, since RLS is enabled on every new table). If any new table shows up without RLS, fix it before proceeding.

- [ ] **Step 8: Record project credentials for later tasks**

Note down (for use in Task 3 and Task 8, not committed anywhere yet): project URL, anon/publishable key, project ref. The service_role key is fetched fresh in Task 8 directly into the worker's `.env` — do not paste it into any file in this repo.

---

## Task 2: Create the three users

**Files:** none (Supabase Auth + SQL only).

**Interfaces:**
- Produces: 3 `auth.users` rows + matching `profiles` rows for Alan, Bigode, Dodo.

- [ ] **Step 1: Create the users via SQL (Auth admin API isn't exposed through the MCP, so create via `execute_sql` against `auth.users` is not supported — instead instruct manual creation)**

This step is a manual action outside Claude's tools: in the Supabase Dashboard → Authentication → Users → "Add user", create 3 users with emails/passwords of the user's choosing, labeled Alan, Bigode, Dodo. Record the resulting `auth.users.id` UUIDs.

- [ ] **Step 2: Insert matching profiles rows**

Use `execute_sql`:

```sql
insert into profiles (id, display_name) values
  ('<alan-uuid>', 'Alan'),
  ('<bigode-uuid>', 'Bigode'),
  ('<dodo-uuid>', 'Dodo');
```

- [ ] **Step 3: Verify**

`select * from profiles;` via `execute_sql` — confirm 3 rows with correct `display_name`.

---

## Task 3: Extension Supabase client + config

**Files:**
- Create: `extension/config.example.js`
- Create: `extension/config.js` (gitignored)
- Create: `extension/lib/supabase.js`
- Create: `.gitignore` (repo root, if absent) or modify if present
- Modify: `extension/manifest.json`

**Interfaces:**
- Produces: `window.A3OS_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY }` (loaded as a classic script before other extension scripts); `A3Supabase` object with methods `signIn(email, password)`, `signOut()`, `getSession()`, `refreshSession(refreshToken)`, `restSelect(table, query)`, `restInsert(table, row)`, `rpc(name, args)`, `uploadToStorage(bucket, path, blob, accessToken)` — all exported on `globalThis.A3Supabase` (no ES modules, MV3 background is a classic script per current `manifest.json`).

- [ ] **Step 1: Check current manifest to confirm script-loading style**

Read `extension/manifest.json` fully (already read during audit — background is `"background": { "service_worker": "background.js" }`, no `"type": "module"`). This confirms plain scripts, no ES module imports — `lib/supabase.js` must attach to `globalThis`, and files needing it must be listed together in HTML `<script>` tags or imported via `importScripts()` in the service worker.

- [ ] **Step 2: Create `extension/config.example.js`**

```javascript
// Copy this file to config.js and fill in your Supabase project values.
// config.js is gitignored — never commit real keys.
globalThis.A3OS_CONFIG = {
    SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
    SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
```

- [ ] **Step 3: Create `extension/config.js` with the real values from Task 1 Step 1**

Same shape as above, filled with the actual `SUPABASE_URL` and anon key recorded in Task 1.

- [ ] **Step 4: Add `.gitignore` entry**

Ensure repo root `.gitignore` exists and contains:

```
extension/config.js
```

(create the file with just this line if no `.gitignore` exists yet).

- [ ] **Step 5: Create `extension/lib/supabase.js`**

```javascript
// ================================================================
// A3-OS — CLIENTE SUPABASE MINIMALISTA (fetch puro, sem bundler)
// ================================================================

const A3Supabase = (() => {

    function baseHeaders(accessToken) {
        return {
            "apikey": A3OS_CONFIG.SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${accessToken || A3OS_CONFIG.SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json"
        };
    }

    async function signIn(email, password) {
        const response = await fetch(
            `${A3OS_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`,
            {
                method: "POST",
                headers: {
                    "apikey": A3OS_CONFIG.SUPABASE_ANON_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, password })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error_description || data.msg || "Falha no login.");
        }

        return data; // { access_token, refresh_token, expires_in, user, ... }
    }

    async function refreshSession(refreshToken) {
        const response = await fetch(
            `${A3OS_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
            {
                method: "POST",
                headers: {
                    "apikey": A3OS_CONFIG.SUPABASE_ANON_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ refresh_token: refreshToken })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error_description || data.msg || "Falha ao renovar sessão.");
        }

        return data;
    }

    async function signOut(accessToken) {
        await fetch(`${A3OS_CONFIG.SUPABASE_URL}/auth/v1/logout`, {
            method: "POST",
            headers: baseHeaders(accessToken)
        });
    }

    async function restSelect(table, query, accessToken) {
        const response = await fetch(
            `${A3OS_CONFIG.SUPABASE_URL}/rest/v1/${table}?${query}`,
            { headers: baseHeaders(accessToken) }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `Falha ao consultar ${table}.`);
        }

        return data;
    }

    async function restInsert(table, row, accessToken) {
        const response = await fetch(
            `${A3OS_CONFIG.SUPABASE_URL}/rest/v1/${table}`,
            {
                method: "POST",
                headers: {
                    ...baseHeaders(accessToken),
                    "Prefer": "return=representation"
                },
                body: JSON.stringify(row)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `Falha ao inserir em ${table}.`);
        }

        return Array.isArray(data) ? data[0] : data;
    }

    async function uploadToStorage(bucket, path, blob, accessToken) {
        const response = await fetch(
            `${A3OS_CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
            {
                method: "POST",
                headers: {
                    "apikey": A3OS_CONFIG.SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": blob.type || "application/octet-stream"
                },
                body: blob
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Falha no upload do áudio.");
        }

        return data;
    }

    return {
        signIn,
        refreshSession,
        signOut,
        restSelect,
        restInsert,
        uploadToStorage
    };

})();
```

- [ ] **Step 6: Add `host_permissions` to `extension/manifest.json`**

Modify the `manifest.json` (read it first — it currently has 40 lines) to add a `host_permissions` array entry for the Supabase project URL, e.g.:

```json
"host_permissions": [
    "https://YOUR-PROJECT-REF.supabase.co/*"
]
```

Insert it as a top-level key alongside existing `"permissions"`. Use the real project ref from Task 1.

- [ ] **Step 7: Manual verification**

Load the extension unpacked in `chrome://extensions`, confirm no manifest parse errors, confirm `config.js` and `lib/supabase.js` appear in the extension's file list (no automated test possible for a static config file — this is a load-and-inspect check, not a unit test).

- [ ] **Step 8: Commit**

```bash
git add extension/config.example.js extension/lib/supabase.js extension/manifest.json .gitignore
git commit -m "feat: add Supabase client and config scaffolding to extension"
```

(Do not `git add extension/config.js` — it must stay untracked per `.gitignore`.)

---

## Task 4: Session management (`extension/lib/session.js`)

**Files:**
- Create: `extension/lib/session.js`
- Modify: `extension/background.js` (add `importScripts` for `config.js`, `lib/supabase.js`, `lib/session.js`)

**Interfaces:**
- Consumes: `A3Supabase.signIn`, `A3Supabase.refreshSession`, `A3Supabase.signOut` from Task 3.
- Produces: `A3Session` object with `login(email, password)`, `logout()`, `getValidAccessToken()` (returns a fresh access token, refreshing if expired, or `null` if no session), `getCurrentUser()` (returns `{ id, email }` or `null`), all exported on `globalThis.A3Session`.

- [ ] **Step 1: Create `extension/lib/session.js`**

```javascript
// ================================================================
// A3-OS — SESSÃO (chrome.storage.local, sobrevive a reinícios)
// ================================================================

const A3Session = (() => {

    const STORAGE_KEY = "a3os_session";

    async function saveSession(data) {
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: Date.now() + (data.expires_in * 1000),
                user: {
                    id: data.user.id,
                    email: data.user.email
                }
            }
        });
    }

    async function loadRawSession() {
        const stored = await chrome.storage.local.get([STORAGE_KEY]);
        return stored[STORAGE_KEY] || null;
    }

    async function login(email, password) {
        const data = await A3Supabase.signIn(email, password);
        await saveSession(data);
        return { id: data.user.id, email: data.user.email };
    }

    async function logout() {
        const session = await loadRawSession();

        if (session) {
            try {
                await A3Supabase.signOut(session.access_token);
            } catch (error) {
                console.warn("A3-OS: erro ao encerrar sessão no servidor:", error);
            }
        }

        await chrome.storage.local.remove([STORAGE_KEY]);
    }

    async function getValidAccessToken() {
        const session = await loadRawSession();

        if (!session) {
            return null;
        }

        const EXPIRY_MARGIN_MS = 60 * 1000;

        if (Date.now() < session.expires_at - EXPIRY_MARGIN_MS) {
            return session.access_token;
        }

        try {
            const refreshed = await A3Supabase.refreshSession(session.refresh_token);
            await saveSession(refreshed);
            return refreshed.access_token;
        } catch (error) {
            console.warn("A3-OS: sessão expirada, é necessário login novamente:", error);
            await chrome.storage.local.remove([STORAGE_KEY]);
            return null;
        }
    }

    async function getCurrentUser() {
        const session = await loadRawSession();
        return session ? session.user : null;
    }

    return {
        login,
        logout,
        getValidAccessToken,
        getCurrentUser
    };

})();
```

- [ ] **Step 2: Wire it into `background.js`**

Modify `extension/background.js` — since it's a service worker (not loaded via `<script>` tags), add `importScripts` calls as the very first lines of the file:

```javascript
importScripts("config.js", "lib/supabase.js", "lib/session.js");

let recording = false;
```

(The existing `let recording = false;` line at [background.js:1](../../../extension/background.js) stays — the `importScripts` line is inserted above it.)

- [ ] **Step 3: Add message handlers for login/logout/session status**

Add to the `chrome.runtime.onMessage.addListener` block in `background.js` (alongside the existing `if` blocks for `get-recording-status`, `select-folder`, etc. — insert before the closing of the listener function):

```javascript
        // ========================================================
        // LOGIN
        // ========================================================

        if (message.action === "login") {

            A3Session.login(message.email, message.password)
                .then(user => {
                    sendResponse({ success: true, user });
                })
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });

            return true;
        }


        // ========================================================
        // LOGOUT
        // ========================================================

        if (message.action === "logout") {

            A3Session.logout()
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });

            return true;
        }


        // ========================================================
        // SESSAO ATUAL
        // ========================================================

        if (message.action === "get-current-user") {

            A3Session.getCurrentUser()
                .then(user => {
                    sendResponse({ user });
                });

            return true;
        }
```

- [ ] **Step 4: Manual verification**

Reload the extension in `chrome://extensions`, open the service worker console (Inspect views: service worker), confirm no `importScripts` errors. From that console run `A3Session.getCurrentUser().then(console.log)` — expect `null` (no session yet).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/session.js extension/background.js
git commit -m "feat: add Supabase session management to background service worker"
```

---

## Task 5: Login screen

**Files:**
- Create: `extension/login/login.html`
- Create: `extension/login/login.css`
- Create: `extension/login/login.js`
- Modify: `extension/popup/popup.js` (redirect to login when unauthenticated)
- Modify: `extension/popup/popup.html` (add logout button + user label)

**Interfaces:**
- Consumes: `chrome.runtime.sendMessage({action: "login", email, password})` and `{action: "logout"}` and `{action: "get-current-user"}` from Task 4.
- Produces: a working login flow reachable from the popup when no session exists.

- [ ] **Step 1: Create `extension/login/login.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>A3-OS — Login</title>
    <link rel="stylesheet" href="login.css">
</head>
<body>
    <div class="login-box">
        <h1>A3-OS</h1>
        <p class="subtitle">Entre para gravar e enviar aulas</p>

        <form id="loginForm">
            <label for="email">E-mail</label>
            <input type="email" id="email" required autocomplete="username">

            <label for="password">Senha</label>
            <input type="password" id="password" required autocomplete="current-password">

            <button type="submit" id="loginButton">Entrar</button>

            <p id="loginError" class="error" hidden></p>
        </form>
    </div>

    <script src="login.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `extension/login/login.css`**

```css
body {
    font-family: system-ui, sans-serif;
    width: 300px;
    margin: 0;
    padding: 24px;
    background: #1a1a1a;
    color: #eee;
}

.login-box h1 {
    margin: 0 0 4px 0;
    font-size: 20px;
}

.subtitle {
    margin: 0 0 20px 0;
    font-size: 12px;
    color: #999;
}

label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
    color: #ccc;
}

input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    margin-bottom: 14px;
    border-radius: 6px;
    border: 1px solid #444;
    background: #222;
    color: #eee;
}

button {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 6px;
    background: #4f7cff;
    color: white;
    font-weight: 600;
    cursor: pointer;
}

button:disabled {
    opacity: 0.6;
    cursor: default;
}

.error {
    color: #ff6b6b;
    font-size: 12px;
    margin-top: 10px;
}
```

- [ ] **Step 3: Create `extension/login/login.js`**

```javascript
document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const loginButton = document.getElementById("loginButton");
    const loginError = document.getElementById("loginError");

    form.addEventListener("submit", async (event) => {

        event.preventDefault();

        loginButton.disabled = true;
        loginError.hidden = true;

        try {

            const response = await chrome.runtime.sendMessage({
                action: "login",
                email: emailInput.value.trim(),
                password: passwordInput.value
            });

            if (!response || !response.success) {
                throw new Error(response?.error || "Falha no login.");
            }

            window.location.href = "../popup/popup.html";

        } catch (error) {

            loginError.textContent = error.message;
            loginError.hidden = false;

        } finally {

            loginButton.disabled = false;
        }
    });
});
```

- [ ] **Step 4: Redirect from popup when unauthenticated**

Modify `extension/popup/popup.js` — at the very top of the `DOMContentLoaded` handler ([popup.js:3](../../../extension/popup/popup.js)), before any other logic, add a session check:

```javascript
document.addEventListener("DOMContentLoaded", async () => {

    const userCheck = await chrome.runtime.sendMessage({ action: "get-current-user" });

    if (!userCheck || !userCheck.user) {
        window.location.href = "../login/login.html";
        return;
    }

    const titleElement = document.getElementById("title");
    // ... rest of existing function unchanged
```

- [ ] **Step 5: Add logout button to popup**

Modify `extension/popup/popup.html` — read the current file first, then add near the top of the body (below whatever header markup exists):

```html
<div class="user-bar">
    <span id="userEmail"></span>
    <button id="logoutButton" title="Sair">Sair</button>
</div>
```

- [ ] **Step 6: Wire logout button and user email display in `popup.js`**

Add inside the `DOMContentLoaded` handler in `popup.js`, right after the session check from Step 4:

```javascript
    const userEmailElement = document.getElementById("userEmail");
    if (userEmailElement) {
        userEmailElement.textContent = userCheck.user.email;
    }

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            await chrome.runtime.sendMessage({ action: "logout" });
            window.location.href = "../login/login.html";
        });
    }
```

- [ ] **Step 7: Manual verification**

Reload extension. Open popup with no session → expect redirect to `login.html`. Log in with one of the 3 Supabase Auth users created in Task 2 → expect redirect back to `popup.html` showing the user's email and a working "Sair" button that returns to `login.html`.

- [ ] **Step 8: Commit**

```bash
git add extension/login/ extension/popup/popup.js extension/popup/popup.html
git commit -m "feat: add login screen and session-gated popup"
```

---

## Task 6: Course/module/lesson pickers in popup

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.js`
- Modify: `extension/background.js` (add `get-courses`/`get-modules` message handlers)

**Interfaces:**
- Consumes: `A3Supabase.restSelect`, `A3Session.getValidAccessToken` from Tasks 3–4.
- Produces: `chrome.storage.local` keys `selectedCourseId`, `selectedModuleId`, `selectedLessonNumber` set before recording starts; `background.js` messages `get-courses` → `{courses: [...]}`, `get-modules` (with `courseId`) → `{modules: [...]}`.

- [ ] **Step 1: Add message handlers to `background.js`**

Add to the `chrome.runtime.onMessage.addListener` block:

```javascript
        // ========================================================
        // LISTAR CURSOS
        // ========================================================

        if (message.action === "get-courses") {

            (async () => {

                try {

                    const token = await A3Session.getValidAccessToken();

                    if (!token) {
                        sendResponse({ courses: [], error: "not-authenticated" });
                        return;
                    }

                    const courses = await A3Supabase.restSelect(
                        "courses",
                        "select=id,name&order=name.asc",
                        token
                    );

                    sendResponse({ courses });

                } catch (error) {

                    sendResponse({ courses: [], error: error.message });
                }

            })();

            return true;
        }


        // ========================================================
        // LISTAR MODULOS DE UM CURSO
        // ========================================================

        if (message.action === "get-modules") {

            (async () => {

                try {

                    const token = await A3Session.getValidAccessToken();

                    if (!token) {
                        sendResponse({ modules: [], error: "not-authenticated" });
                        return;
                    }

                    const modules = await A3Supabase.restSelect(
                        "modules",
                        `select=id,module_number,name&course_id=eq.${message.courseId}&order=module_number.asc`,
                        token
                    );

                    sendResponse({ modules });

                } catch (error) {

                    sendResponse({ modules: [], error: error.message });
                }

            })();

            return true;
        }
```

- [ ] **Step 2: Add picker markup to `popup.html`**

Read the current `popup.html` fully first. Add this block where the detected-title element currently sits (near `id="title"`):

```html
<div class="lesson-picker">
    <label for="courseSelect">Curso</label>
    <select id="courseSelect"></select>

    <label for="moduleSelect">Módulo</label>
    <select id="moduleSelect"></select>

    <label for="lessonNumberInput">Número da aula</label>
    <input type="number" id="lessonNumberInput" min="1" step="1">
</div>
```

- [ ] **Step 3: Load courses/modules and persist selection in `popup.js`**

Add a new function and call it from `DOMContentLoaded` (after the session check, before the recording-status block):

```javascript
    await carregarCursosEModulos();
```

Function body (add near the other top-level functions in `popup.js`):

```javascript
// ================================================================
// CURSO / MODULO / AULA
// ================================================================

async function carregarCursosEModulos() {

    const courseSelect = document.getElementById("courseSelect");
    const moduleSelect = document.getElementById("moduleSelect");
    const lessonNumberInput = document.getElementById("lessonNumberInput");

    if (!courseSelect || !moduleSelect || !lessonNumberInput) {
        return;
    }

    const coursesResponse = await chrome.runtime.sendMessage({ action: "get-courses" });

    courseSelect.innerHTML = "";

    (coursesResponse.courses || []).forEach(course => {
        const option = document.createElement("option");
        option.value = course.id;
        option.textContent = course.name;
        courseSelect.appendChild(option);
    });

    const saved = await chrome.storage.local.get([
        "selectedCourseId",
        "selectedModuleId",
        "selectedLessonNumber"
    ]);

    if (saved.selectedCourseId) {
        courseSelect.value = saved.selectedCourseId;
    }

    async function carregarModulos() {

        const modulesResponse = await chrome.runtime.sendMessage({
            action: "get-modules",
            courseId: courseSelect.value
        });

        moduleSelect.innerHTML = "";

        (modulesResponse.modules || []).forEach(mod => {
            const option = document.createElement("option");
            option.value = mod.id;
            option.textContent = `${mod.module_number} — ${mod.name}`;
            moduleSelect.appendChild(option);
        });

        if (saved.selectedModuleId) {
            moduleSelect.value = saved.selectedModuleId;
        }

        await chrome.storage.local.set({ selectedCourseId: courseSelect.value });
    }

    await carregarModulos();

    if (saved.selectedLessonNumber) {
        lessonNumberInput.value = saved.selectedLessonNumber;
    }

    courseSelect.addEventListener("change", carregarModulos);

    moduleSelect.addEventListener("change", async () => {
        await chrome.storage.local.set({ selectedModuleId: moduleSelect.value });
    });

    lessonNumberInput.addEventListener("change", async () => {
        await chrome.storage.local.set({ selectedLessonNumber: lessonNumberInput.value });
    });
}
```

- [ ] **Step 4: Manual verification**

Insert a test course/module via `execute_sql` (`insert into courses (name) values ('Curso Teste') returning id;` then a module referencing it), reload the extension, open the popup, confirm the dropdowns populate and remember the selection across popup close/reopen (`chrome.storage.local` persists it).

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js extension/background.js
git commit -m "feat: add course/module/lesson picker to popup"
```

---

## Task 7: Upload + job creation after recording finishes

**Files:**
- Modify: `extension/background.js` (the `recording-finished` handler)

**Interfaces:**
- Consumes: `A3Session.getValidAccessToken`, `A3Session.getCurrentUser`, `A3Supabase.uploadToStorage`, `A3Supabase.restInsert` from Tasks 3–4; `chrome.storage.local` keys `selectedCourseId`/`selectedModuleId`/`selectedLessonNumber` from Task 6.
- Produces: after a successful recording, a new `audio_files` row and a `transcription_jobs` row (status `pending`) in Supabase, in addition to the existing local save via Native Host. Popup receives a new message `upload-status` with `{stage: "uploading"|"done"|"error", error?}`.

- [ ] **Step 1: Read the current `recording-finished` handler**

Already read in full during audit — it is the block starting at [background.js:802](../../../extension/background.js) (`message.target === "background" && message.action === "recording-finished"`). It currently: loads state, calls `salvarAudioNative(...)`, sets `recording: false`, resets the icon, and sends `download-success`/`download-error`.

- [ ] **Step 2: Add the Supabase upload as an additional step in that same handler**

Modify the `try` block inside that handler in `background.js`. After the existing `salvarAudioNative(...)` call succeeds (so the local save keeps happening exactly as today) and before `chrome.action.setIcon` is reset, insert:

```javascript
                    try {

                        chrome.runtime.sendMessage({
                            action: "upload-status",
                            stage: "uploading"
                        });

                        const token = await A3Session.getValidAccessToken();
                        const user = await A3Session.getCurrentUser();

                        if (!token || !user) {
                            throw new Error("Sessão expirada. Faça login novamente.");
                        }

                        const selection = await chrome.storage.local.get([
                            "selectedCourseId",
                            "selectedModuleId",
                            "selectedLessonNumber"
                        ]);

                        if (
                            !selection.selectedCourseId ||
                            !selection.selectedModuleId ||
                            !selection.selectedLessonNumber
                        ) {
                            throw new Error("Selecione curso, módulo e número da aula antes de gravar.");
                        }

                        const lessonRow = await A3Supabase.restInsert(
                            "lessons",
                            {
                                module_id: selection.selectedModuleId,
                                lesson_number: parseInt(selection.selectedLessonNumber, 10),
                                title: currentRecording.title
                            },
                            token
                        ).catch(async () => {
                            const existing = await A3Supabase.restSelect(
                                "lessons",
                                `select=id&module_id=eq.${selection.selectedModuleId}&lesson_number=eq.${parseInt(selection.selectedLessonNumber, 10)}`,
                                token
                            );
                            return existing[0];
                        });

                        const audioBlob = new Blob(message.chunks, { type: "audio/webm" });
                        const storagePath = `${selection.selectedCourseId}/${selection.selectedModuleId}/${lessonRow.id}/${message.filename}`;

                        await A3Supabase.uploadToStorage("audio", storagePath, audioBlob, token);

                        const audioFileRow = await A3Supabase.restInsert(
                            "audio_files",
                            {
                                course_id: selection.selectedCourseId,
                                module_id: selection.selectedModuleId,
                                lesson_id: lessonRow.id,
                                uploaded_by: user.id,
                                storage_path: storagePath,
                                filename: message.filename,
                                mime_type: "audio/webm",
                                file_size: audioBlob.size,
                                status: "uploaded"
                            },
                            token
                        );

                        await A3Supabase.restInsert(
                            "transcription_jobs",
                            {
                                audio_file_id: audioFileRow.id,
                                status: "pending"
                            },
                            token
                        );

                        chrome.runtime.sendMessage({
                            action: "upload-status",
                            stage: "done"
                        });

                    } catch (uploadError) {

                        console.error("A3-OS: erro no upload para o Supabase:", uploadError);

                        chrome.runtime.sendMessage({
                            action: "upload-status",
                            stage: "error",
                            error: uploadError.message
                        });
                    }
```

Note: `lessons` INSERT is RLS-restricted to service_role per Task 1 Step 4 — the `.catch()` fallback to `restSelect` here assumes the insert will normally fail with a permission error and fall back to reading an already-service-role-created lesson row. **This is a known gap**: it works only if the lesson already exists in the catalog. Task 6 already requires selecting an existing module; for a genuinely new lesson number not yet in the catalog, this call will fail both the insert and the select, and the catch's `existing[0]` will be `undefined`, causing a clear downstream error (`Cannot read properties of undefined`) surfaced via `upload-status: error`. Flag this to the user during Task 7 verification — see Step 4.

- [ ] **Step 3: Show upload status in the popup**

Modify `extension/popup/popup.js` — inside the existing `chrome.runtime.onMessage.addListener` block (around the existing `download-success`/`download-error`/`recording-state` handlers), add:

```javascript
            if (message.action === "upload-status") {

                const statusTextElement = document.getElementById("statusText");

                if (statusTextElement) {

                    if (message.stage === "uploading") {
                        statusTextElement.textContent = "Enviando áudio para o Supabase...";
                    }

                    if (message.stage === "done") {
                        statusTextElement.textContent = "Áudio enviado. Aguardando transcrição.";
                    }

                    if (message.stage === "error") {
                        mostrarErro(message.error || "Erro ao enviar áudio.");
                    }
                }
            }
```

- [ ] **Step 4: Manual verification, including the known gap from Step 2**

Using the test course/module from Task 6: pick a lesson number that does **not** yet exist as a `lessons` row, record a short test clip, stop, and confirm you see the "Cannot read properties of undefined" style error surfaced as `mostrarErro`. Then, using `execute_sql`, manually insert that lesson row (`insert into lessons (module_id, lesson_number, title) values (...);`), retry recording the same lesson — confirm it now succeeds and `audio_files`/`transcription_jobs` rows appear (`select * from audio_files; select * from transcription_jobs;`). This confirms the documented gap and the happy path. Closing this gap (auto-provisioning new lesson numbers safely under RLS) is out of scope for this plan — note it as a follow-up if the user wants lesson auto-creation from the extension in a later phase.

- [ ] **Step 5: Commit**

```bash
git add extension/background.js extension/popup/popup.js
git commit -m "feat: upload audio to Supabase Storage and create transcription jobs after recording"
```

---

## Task 8: Worker script (`supabase_worker.py`)

**Files:**
- Create: `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\99_SISTEMA\whisper\supabase_worker.py`
- Create: `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\99_SISTEMA\whisper\.env.example`
- Create: `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\99_SISTEMA\whisper\requirements-worker.txt`
- Modify: `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\.gitignore` (create if absent)

**Interfaces:**
- Consumes: RPCs `reserve_transcription_job(p_worker_id)`, `recover_stuck_jobs(p_timeout_minutes)` from Task 1; existing `transcrever.py` unmodified CLI contract (`python transcrever.py <path>`, exit code 0/1, writes `<stem>.md` next to `TRANSCRICOES_DIR`).
- Produces: rows in `transcriptions`, status updates in `transcription_jobs` and `lessons`.

- [ ] **Step 1: Create `requirements-worker.txt`**

```
requests==2.32.3
python-dotenv==1.0.1
```

- [ ] **Step 2: Create `.env.example`**

```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
WORKER_ID=transcritor-principal
POLL_INTERVAL_SECONDS=10
STUCK_JOB_TIMEOUT_MINUTES=30
MAX_ATTEMPTS=3
```

- [ ] **Step 3: Ensure `.env` is gitignored**

Check for a `.gitignore` at `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\.gitignore`. If it doesn't exist, create it with:

```
.env
```

If it exists, append `.env` if not already present.

- [ ] **Step 4: Create `supabase_worker.py`**

```python
import os
import sys
import time
import shutil
import subprocess
from pathlib import Path

import requests
from dotenv import load_dotenv


# ============================================================
# A3-OS — WORKER DO TRANSCRITOR (ponte com o Supabase)
# ============================================================
#
# Nao modifica transcrever.py nem a logica de CUDA/Whisper.
# So consulta o Supabase, baixa o audio, chama transcrever.py
# como subprocesso, e devolve o resultado.
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_ID = os.environ.get("WORKER_ID", "transcritor-principal")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "10"))
STUCK_JOB_TIMEOUT_MINUTES = int(os.environ.get("STUCK_JOB_TIMEOUT_MINUTES", "30"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))

TRANSCREVER_PY = BASE_DIR / "transcrever.py"
PYTHON_EXE = Path(sys.executable)  # espera-se .whisper-env\Scripts\python.exe
TMP_AUDIO_DIR = BASE_DIR / "_tmp_audio"
TRANSCRICOES_DIR = BASE_DIR.parent.parent / "raw" / "transcricoes"

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json"
}


def rpc(name, args):
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}",
        headers=HEADERS,
        json=args,
        timeout=30
    )
    response.raise_for_status()
    return response.json()


def patch(table, row_id, fields):
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json=fields,
        timeout=30
    )
    response.raise_for_status()


def insert(table, row):
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "return=representation"},
        json=row,
        timeout=30
    )
    response.raise_for_status()
    return response.json()[0]


def download_audio(storage_path, dest_path):
    response = requests.get(
        f"{SUPABASE_URL}/storage/v1/object/audio/{storage_path}",
        headers=HEADERS,
        timeout=120
    )
    response.raise_for_status()
    dest_path.write_bytes(response.content)


def run_transcrever(audio_path):
    result = subprocess.run(
        [str(PYTHON_EXE), str(TRANSCREVER_PY), str(audio_path)],
        capture_output=True,
        text=True
    )
    return result.returncode, result.stdout, result.stderr


def process_job(job):
    job_id = job["job_id"]
    audio_file_id = job["audio_file_id"]
    storage_path = job["storage_path"]
    filename = job["filename"]
    lesson_id = job["lesson_id"]

    print(f"[JOB {job_id}] processando {filename}")

    TMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    local_audio_path = TMP_AUDIO_DIR / filename

    try:
        download_audio(storage_path, local_audio_path)

        exit_code, stdout, stderr = run_transcrever(local_audio_path)

        print(stdout)

        if exit_code != 0:
            raise RuntimeError(f"transcrever.py saiu com codigo {exit_code}: {stderr}")

        output_md = TRANSCRICOES_DIR / f"{local_audio_path.stem}.md"

        if not output_md.exists():
            raise RuntimeError(f"Saida esperada nao encontrada: {output_md}")

        transcript_text = output_md.read_text(encoding="utf-8")

        insert("transcriptions", {
            "audio_file_id": audio_file_id,
            "lesson_id": lesson_id,
            "text": transcript_text
        })

        patch("lessons", lesson_id, {"status": "completed"})
        patch("audio_files", audio_file_id, {"status": "completed"})
        patch("transcription_jobs", job_id, {
            "status": "completed",
            "completed_at": "now()"
        })

        print(f"[JOB {job_id}] concluido.")

    except Exception as error:

        print(f"[JOB {job_id}] ERRO: {error}")

        patch("audio_files", audio_file_id, {"status": "failed"})

        current_attempts = job.get("attempts", 1)

        new_status = "failed" if current_attempts >= MAX_ATTEMPTS else "pending"

        patch("transcription_jobs", job_id, {
            "status": new_status,
            "error_message": str(error)
        })

    finally:

        if local_audio_path.exists():
            local_audio_path.unlink()


def main_loop():

    print("=" * 60)
    print("A3-OS — WORKER DO TRANSCRITOR (Supabase)")
    print("=" * 60)
    print(f"Supabase: {SUPABASE_URL}")
    print(f"Worker ID: {WORKER_ID}")
    print(f"Intervalo de polling: {POLL_INTERVAL_SECONDS}s")
    print("=" * 60)

    while True:

        try:

            recovered = rpc("recover_stuck_jobs", {"p_timeout_minutes": STUCK_JOB_TIMEOUT_MINUTES})

            if recovered and recovered > 0:
                print(f"[RECUPERACAO] {recovered} job(s) travados voltaram para pending.")

            jobs = rpc("reserve_transcription_job", {"p_worker_id": WORKER_ID})

            if jobs:
                process_job(jobs[0])
            else:
                time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as error:

            print(f"[ERRO NO LOOP] {error}")
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main_loop()
```

Note: `attempts` isn't returned by `reserve_transcription_job` in the Task 1 schema — `process_job`'s `job.get("attempts", 1)` will always take the default. Fix this now: modify the Task 1 Step 5 RPC to also return `attempts`, or read it here via a follow-up SELECT. Simplest fix within this task:

- [ ] **Step 4b: Fix the missing `attempts` field**

Go back to Supabase (via `execute_sql` or `apply_migration` with name `reserve_job_rpc_v2`) and replace the function from Task 1 Step 5 with a version that also returns `attempts`:

```sql
create or replace function reserve_transcription_job(p_worker_id text)
returns table (
  job_id uuid,
  audio_file_id uuid,
  storage_path text,
  filename text,
  lesson_id uuid,
  attempts int
)
language plpgsql
security definer
as $$
declare
  v_job_id uuid;
begin
  update transcription_jobs
  set status = 'processing',
      started_at = now(),
      worker_id = p_worker_id,
      attempts = attempts + 1
  where id = (
    select id from transcription_jobs
    where status = 'pending'
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning id into v_job_id;

  if v_job_id is null then
    return;
  end if;

  return query
  select tj.id, af.id, af.storage_path, af.filename, af.lesson_id, tj.attempts
  from transcription_jobs tj
  join audio_files af on af.id = tj.audio_file_id
  where tj.id = v_job_id;
end;
$$;
```

- [ ] **Step 5: Manual end-to-end verification**

Copy `.env.example` to `.env` in `99_SISTEMA/whisper/`, fill in the real `SUPABASE_URL` and the service_role key (fetched from the Supabase Dashboard → Project Settings → API — never paste it into a committed file). Install worker deps into the existing venv: `.whisper-env\Scripts\pip.exe install -r 99_SISTEMA\whisper\requirements-worker.txt`. Run `.whisper-env\Scripts\python.exe 99_SISTEMA\whisper\supabase_worker.py`. From the extension (Task 7's verified happy path), record and upload a lesson. Confirm the worker log shows `[JOB ...] processando`, then `concluido`, and confirm via `execute_sql`: `select status from transcription_jobs order by created_at desc limit 1;` returns `completed`, and `select text from transcriptions order by created_at desc limit 1;` returns real transcript text.

- [ ] **Step 6: Verify stuck-job recovery**

Manually set a job to `processing` with an old `started_at` to simulate a crash: `update transcription_jobs set status='processing', started_at=now() - interval '1 hour' where id='<some-job-id>';`. Restart `supabase_worker.py`, confirm the log prints `[RECUPERACAO] 1 job(s)...` and the job gets reprocessed.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian"
git add 99_SISTEMA/whisper/supabase_worker.py 99_SISTEMA/whisper/.env.example 99_SISTEMA/whisper/requirements-worker.txt .gitignore
git commit -m "feat: add Supabase-backed transcription worker alongside existing folder-polling monitor"
```

(This assumes `Cursos-Obsidian` is its own git repo, separate from `A3-OS-Recorder`. If it is not yet a git repo, run `git init` there first and confirm with the user before committing, per the standard git safety protocol — do not silently initialize a new repo over an existing Obsidian vault without asking.)

---

## Task 9: Point Task Scheduler at the new worker (manual, documented)

**Files:**
- Create: `C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\99_SISTEMA\whisper\iniciar_worker_supabase.vbs`

**Interfaces:** none (OS-level configuration).

- [ ] **Step 1: Create a hidden launcher, mirroring the existing `iniciar_monitor.vbs` pattern**

```vbs
Set WshShell = CreateObject("WScript.Shell")

WshShell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""& 'C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\.whisper-env\Scripts\python.exe' 'C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian\99_SISTEMA\whisper\supabase_worker.py'""", 0, False
```

- [ ] **Step 2: Manual instructions for the user**

This step has no automatable test — hand off to the user: "Abra o Agendador de Tarefas do Windows, localize (ou crie) a tarefa que hoje aponta para `iniciar_monitor.vbs`, e mude o 'Program/script' para `iniciar_worker_supabase.vbs`, OU crie uma segunda tarefa separada apontando para o novo arquivo, deixando a antiga desativada (não excluída) até você validar que o novo worker está estável." Do not modify Task Scheduler automatically — it is outside any file this plan can safely change, and doing so without the user watching risks silently breaking their only working transcription pipeline.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian"
git add 99_SISTEMA/whisper/iniciar_worker_supabase.vbs
git commit -m "feat: add hidden launcher script for the Supabase worker"
```

---

## Self-Review Notes

**Spec coverage:** Sections 1–9 of the spec are covered — Task 1 (schema/RLS/RPCs), Task 2 (users), Tasks 3–5 (extension client/session/login), Task 6 (course/module/lesson picker), Task 7 (upload + job creation, Native Host untouched), Task 8 (worker, `transcrever.py` untouched, atomic reservation, stuck-job recovery, retry/attempts), Task 9 (Task Scheduler handoff, manual per user's own safety). Section 10 (GitHub/Obsidian, Carpati/IA) is explicitly out of scope per the spec and not included here.

**Known gap flagged explicitly (not hidden):** Task 7's lesson auto-provisioning under RLS is a real limitation — surfaced as a manual verification step and called out as a follow-up, not silently glossed over.

**Type/interface consistency:** `reserve_transcription_job` return columns (`job_id, audio_file_id, storage_path, filename, lesson_id, attempts`) match exactly what `supabase_worker.py`'s `process_job` destructures. `A3Session`/`A3Supabase` method names used in Tasks 4–7 match their definitions in Tasks 3–4. Storage bucket name `"audio"` is consistent between Task 1 Step 3, Task 7's `uploadToStorage("audio", ...)`, and Task 8's `download_audio` URL.
