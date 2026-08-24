# A3-OS — Integração colaborativa via Supabase (Fase 1)

Data: 2026-08-23
Escopo: extensão Chrome (`A3-OS-Recorder`) + transcritor local (`C:\Users\alanl\Documents\Trabalho\Cursos-Obsidian`) integrados via Supabase.
Fora de escopo nesta fase: sincronização GitHub/Obsidian da base de conhecimento (Parte 18.1 do pedido original) e organização Carpati via IA — ficam para uma spec futura, depois que este pipeline estiver validado ponta a ponta.

## 1. Estado atual (auditoria)

**Extensão** (`extension/`): Manifest V3. `background.js` é o service worker; `offscreen/offscreen.js` roda o `MediaRecorder` sobre o stream de `chrome.tabCapture`; `popup/popup.js` é a UI. Ao parar a gravação, os chunks de áudio são enviados ao Native Host (`native-host/a3os_folder_picker.py`, processo Python separado via Native Messaging) que grava o arquivo numa pasta local escolhida pelo usuário via `tkinter.filedialog`. Não existe autenticação, nem rede, nem detecção estruturada de curso/módulo/aula — o popup só lê `<h1>` ou `document.title` da aba como um título único ([popup.js:46-68](../../../extension/popup/popup.js)).

**Transcritor** (`Cursos-Obsidian/`): `iniciar_monitor.ps1` faz polling (2s) em `raw/audio/`, invoca `.whisper-env\Scripts\python.exe 99_SISTEMA\whisper\transcrever.py <arquivo>` por arquivo novo. `transcrever.py` carrega `WhisperModel("large-v3", device="cuda", compute_type="float16")` via faster-whisper/ctranslate2 (DLLs CUDA vêm de pacotes `nvidia-*` dentro do venv, não de instalação global), transcreve em português e grava `raw/transcricoes/<nome>.md`. Idempotente por existência do `.md` de saída. Essa mesma pasta é o vault do Obsidian (curadoria documentada em `CLAUDE.md`: curso "ARQFLOW - Clube de Estudos", módulo atual V-Ray).

Nenhum dos dois sistemas se comunica com o outro hoje; a ponte é 100% manual (usuário move/organiza arquivos).

## 2. Decisões fechadas com o usuário

- Detecção de curso/módulo/aula: popup mostra o título detectado como sugestão, mas o usuário confirma via formulário (curso/módulo escolhidos de dropdowns alimentados pelo Supabase; número da aula digitado, pois o manifesto oficial de aulas por módulo ainda não existe).
- Projeto Supabase: criado do zero nesta implementação, via MCP Supabase desta sessão.
- Manifesto oficial do curso (contagem de módulos/aulas): ainda não existe. O schema suporta `total_modules`/`total_lessons` em `courses`, mas o cadastro inicial pode ficar com valores nulos/estimados — não bloqueia a integração.
- GitHub/Obsidian: fase futura, fora desta spec.
- Upload: a extensão sobe os mesmos chunks de áudio direto para o Supabase Storage, **em paralelo** ao salvamento local via Native Host — o Native Host não é removido nem alterado no seu papel de salvar cópia local; o upload não depende dele.
- Autenticação do worker: usa `service_role_key` num `.env` local na máquina do transcritor. Nunca commitada, nunca na extensão.

## 3. Arquitetura

```
EXTENSÃO (login Supabase Auth, anon key)
   → grava áudio (inalterado: offscreen + MediaRecorder)
   → salva cópia local (inalterado: Native Host)
   → upload paralelo para Supabase Storage (novo)
   → INSERT audio_files + transcription_jobs (novo, via PostgREST, RLS)

SUPABASE (hub central)
   Auth, Postgres, Storage, RLS

WORKER LOCAL (script Python novo, service_role_key)
   → poll transcription_jobs WHERE status='pending'
   → reserva atômica (UPDATE...RETURNING)
   → download do Storage
   → chama transcrever.py existente (Whisper/CUDA inalterado)
   → grava transcriptions, status=completed/failed
```

A extensão nunca fala com o worker. O worker nunca fala com a extensão. Comunicação só via Supabase.

## 4. Schema Postgres

```sql
profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  created_at timestamptz not null default now()
)

courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  total_modules int,
  total_lessons int,
  status text not null default 'in_progress', -- in_progress | completed
  created_at timestamptz not null default now()
)

modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  module_number int not null,
  name text not null,
  total_lessons int,
  created_at timestamptz not null default now(),
  unique (course_id, module_number)
)

lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id),
  lesson_number int not null,
  title text,
  status text not null default 'pending', -- pending | completed
  created_at timestamptz not null default now(),
  unique (module_id, lesson_number)   -- ★ garante aula oficial única
)

audio_files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  module_id uuid not null references modules(id),
  lesson_id uuid not null references lessons(id),
  uploaded_by uuid not null references profiles(id),
  storage_path text not null,
  filename text not null,
  mime_type text,
  file_size bigint,
  duration numeric,
  status text not null default 'uploaded', -- uploaded|pending|processing|completed|failed
  created_at timestamptz not null default now()
)

transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  audio_file_id uuid not null references audio_files(id),
  status text not null default 'pending', -- pending|processing|completed|failed
  attempts int not null default 0,
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
)

transcriptions (
  id uuid primary key default gen_random_uuid(),
  audio_file_id uuid not null references audio_files(id),
  lesson_id uuid not null references lessons(id),
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

Múltiplos `audio_files` podem apontar para o mesmo `lesson_id` (dois usuários gravam a mesma aula) — isso é permitido e esperado. O que impede dupla contagem é o progresso ser calculado sobre `lessons` distintas com transcrição completa, nunca sobre `audio_files`.

Índices: `audio_files(lesson_id)`, `transcription_jobs(status)` (consulta de polling), `transcriptions(lesson_id)`.

## 5. Progresso e aulas faltantes

`lessons.status` passa a `completed` (trigger ou update explícito do worker) quando existe pelo menos um `transcriptions` para aquele `lesson_id`. View/RPC:

```sql
-- course_progress(course_id) -> lessons_total, lessons_completed, percent, status
-- missing_lessons(course_id) -> lista de (module_number, lesson_number) sem lesson completed
```

`lessons_total` vem de `modules.total_lessons` somado (o manifesto), não da contagem de `audio_files` enviados — conforme exigido. Como o manifesto ainda não existe totalmente, módulos/aulas sem `total_lessons` definido não entram no denominador até serem cadastrados.

## 6. RLS (linhas gerais)

- `profiles`: usuário lê/edita só a própria linha (`id = auth.uid()`).
- `courses`, `modules`, `lessons`: SELECT livre para qualquer usuário autenticado. INSERT/UPDATE só via service_role (cadastro de curso é operação administrativa, não fluxo de usuário final nesta fase).
- `audio_files`, `transcription_jobs`, `transcriptions`: SELECT livre para autenticado (conhecimento coletivo). INSERT em `audio_files`/`transcription_jobs` permitido para o usuário autenticado dono do registro (`uploaded_by = auth.uid()`). UPDATE de status/campos de processamento restrito a service_role (o worker).
- Nenhuma policy usa um `user_id` vindo do corpo da requisição — sempre `auth.uid()`.

## 7. Extensão — mudanças

- Novo `extension/lib/supabase-client.js` (bundle do `@supabase/supabase-js`, ou fetch direto ao REST/Auth endpoints se preferir não empacotar — a decidir no plano de implementação, mantendo Manifest V3 CSP em mente).
- Novo `extension/login/` (html/js) — tela de login separada, aberta se não houver sessão válida.
- `background.js`: adiciona handlers para sessão (login/logout/refresh), upload para Storage e criação de `audio_files`/`transcription_jobs` após `recording-finished` — **em adição** ao fluxo existente do Native Host, sem removê-lo.
- `popup.js`: adiciona os 3 campos curso/módulo/aula (dropdowns curso→módulo carregados do Supabase, aula como número livre) e exibe status de upload/transcrição.
- Variáveis `SUPABASE_URL`/`SUPABASE_ANON_KEY` num arquivo de config não commitado (`extension/config.js`, `.gitignore`).

## 8. Worker do transcritor — mudanças

Novo script `supabase_worker.py` em `99_SISTEMA/whisper/` (ao lado de `transcrever.py`, que **não é modificado**):

1. Carrega `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` de `.env` local (não versionado).
2. A cada ciclo: recupera jobs presos em `processing` há mais de N minutos (ex.: 30) de volta para `pending`.
3. Reserva um job pendente via UPDATE atômico condicional (`WHERE status='pending'` com `RETURNING`) — seguro mesmo com múltiplos workers futuros.
4. Baixa o áudio do Storage para uma pasta temporária.
5. Chama `transcrever.py <caminho>` como subprocess (igual ao que `iniciar_monitor.ps1` já faz) — zero mudança na lógica Whisper/CUDA.
6. Lê o `.md` gerado, extrai o texto, grava em `transcriptions`, marca `lessons.status='completed'` se aplicável, marca job `completed`.
7. Falha em qualquer etapa → job `failed`, `error_message` preenchido, `attempts += 1`; retry manual ou automático até um limite (ex.: 3 tentativas) antes de ficar definitivamente `failed`.
8. Sleep configurável entre ciclos (ex.: 10s).

`iniciar_monitor.ps1`/`.vbs` continuam existindo para quem quiser rodar o fluxo local antigo isoladamente (não removidos), mas o Task Scheduler passa a apontar para o novo `supabase_worker.py` como fluxo principal.

## 9. Testes (mínimo antes de considerar a fase 1 pronta)

1. Login com 3 usuários reais criados no Supabase Auth.
2. Gravação end-to-end: popup → upload → audio_files → transcription_job pending.
3. Worker recolhe o job, processa, marca completed.
4. Duas gravações para a mesma `lesson_id` não duplicam o progresso.
5. Job travado em `processing` é recuperado após o timeout.
6. Falha do Whisper marca `failed` com mensagem de erro.
7. RLS: usuário autenticado não consegue fazer UPDATE em `transcription_jobs` (só service_role consegue).

## 10. Fora de escopo (fica para spec futura)

- Sincronização GitHub/Obsidian da base de conhecimento.
- Organização automática via IA seguindo a metodologia Carpati.
- Interface de "aulas faltantes" na extensão (a RPC existe no schema, mas a UI é opcional nesta fase).
