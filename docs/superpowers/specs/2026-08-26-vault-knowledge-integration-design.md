# Design: Integração Transcritor → Vaults de Conhecimento → Dashboard

## Contexto

Hoje existem dois sistemas construídos separadamente que não se conectam:

1. **A3-OS-Recorder** (extensão + `supabase_worker.py` + `transcrever.py`): cada
   pessoa (Alan, Bigode, Dodô) grava áudio de aula pela extensão, loga com
   conta Supabase própria (`profiles`), o worker no PC do Alan transcreve com
   Whisper e hoje só copia o `.md` cru para uma pasta fixa por curso
   (`courses.output_folder`, configurada manualmente na dashboard). Não sabe
   de qual pessoa é, não tem frontmatter, não versiona em Git.

2. **knowledge-tools + 4 vaults Git** (`Alan-Knowledge`, `Bigode-Knowledge`,
   `Dodo-Knowledge`, `A3-Central`): sistema de conhecimento em
   Obsidian+Markdown+Git com padrão de frontmatter, sync seguro
   (`knowledge-sync`) e um consolidador (`knowledge-consolidator`) que hoje
   gera propostas 🟡 para qualquer conteúdo novo nos vaults pessoais,
   nunca resolvendo automaticamente.

Objetivo desta mudança: ligar os dois sistemas, para que a transcrição de
uma aula termine automaticamente na base de conhecimento certa — pessoal e,
quando for conteúdo de curso, também na central — **sem que Bigode e Dodô
precisem de terminal, conta GitHub, ou qualquer ação manual**. E expor
status/progresso disso na dashboard que já existe (Next.js + Supabase).

## Fora de escopo

- RAG, embeddings, agentes de voz (permanece arquitetura futura, já
  documentada em `A3-Central/05_Documentacao/Guia-do-Sistema.md`).
- Um mecanismo de "aprovar proposta pelo dashboard" — aprovação de propostas
  🟡 continua manual (você edita/aprova o arquivo diretamente), como já é
  hoje. Pode virar um botão no dashboard depois, não agora.
- Mudar `transcrever.py` (lógica de Whisper/CUDA) — permanece intocado.

## Arquitetura

```
Extensão (login Supabase por pessoa)
  → upload áudio → Supabase Storage + transcription_jobs (uploaded_by = pessoa)
  → supabase_worker.py (roda no PC do Alan)
      → baixa áudio, chama transcrever.py (inalterado)
      → NOVO: monta frontmatter e resolve vault da pessoa (uploaded_by → profiles.display_name)
      → NOVO: escreve .md no vault pessoal certo (01_Cursos/<curso>/<módulo>/)
      → NOVO: chama knowledge-consolidator-de-aula (dedup por curso/módulo/aula)
          → aula nova → copia pra A3-Central/06_Conhecimento-Consolidado (🟢 automático)
          → aula já existe, conteúdo equivalente → só soma "estudado_por" no arquivo consolidado
          → aula já existe, conteúdo diferente → gera proposta 🟡 (nunca sobrescreve)
      → NOVO: chama `knowledge-sync <vault>` e `knowledge-sync a3-central` (git add/commit/push,
        sem intervenção humana — o PC do Alan já está autenticado no GitHub)
      → NOVO: grava linha em knowledge_sync_status (Supabase) com resultado (🟢/🟡/🔴)

Dashboard (Next.js, já fala com Supabase)
  → aba Usuários: lê lessons/audio_files (progresso do curso) e
    knowledge_sync_status + sources dos arquivos consolidados (contribuição)
  → mostra barra de progresso por pessoa: progresso do curso + contribuição à base central
```

Anotações pessoais feitas direto no Obsidian (fora de `01_Cursos`, ex:
`02_Estudos`, `03_Anotacoes`) continuam fluindo pelo `knowledge-consolidator`
já existente, sem mudança — sempre viram proposta 🟡, nunca automáticas.

## Componentes e mudanças

### 1. `supabase_worker.py` (Transcritor Local)

Substituir `salvar_na_base_de_conhecimento(course_id, output_md, filename)`
por uma versão que:
- Busca `profiles.display_name` a partir de `audio_files.uploaded_by` do job.
- Mapeia display_name → vault (`alan` → `Alan-Knowledge`, etc. — mesma
  tabela de resolução que `knowledge-tools/lib/vaults.js` já usa, mas
  precisa existir também em Python já que o worker é Python puro).
- Busca nome do curso/módulo/número da aula (já disponível via
  `courses`/`modules`/`lessons` no job).
- Monta o Markdown final com frontmatter (reaproveitando o texto já
  transcrito, sem tocar em `transcrever.py`): `title`, `type: course`,
  `curso`, `modulo`, `aula`, `source` (pessoa), `status: raw`, `created`,
  `updated`, `tags`.
- Escreve em `<Vault>/01_Cursos/<curso>/<módulo>/<slug-da-aula>.md`.
- Chama o novo script de consolidação por aula (seção 2) via subprocess
  (Node, já que a lógica de frontmatter/manifesto vive em `knowledge-tools`).
- Chama `knowledge-sync <vault>` e, se algo mudou em `A3-Central`,
  `knowledge-sync a3-central` — via subprocess, mesmo binário que você já
  usa manualmente.
- Grava o resultado em `knowledge_sync_status` (tabela nova, seção 3).
- Erros em qualquer etapa nova (frontmatter/git/consolidação) **não** podem
  derrubar o fluxo já existente (job ainda deve marcar `completed`, pois a
  transcrição em si funcionou) — ficam registrados como 🔴 em
  `knowledge_sync_status` para você ver na dashboard e resolver manualmente.

### 2. `knowledge-tools`: novo comando `knowledge-consolidate-aula`

Script novo (não mexe no `knowledge-consolidator` existente, que continua
cuidando das notas pessoais por hash de conteúdo). Recebe
`--vault --curso --modulo --aula --arquivo`:
- Calcula um identificador estável: `slug(curso)/slug(modulo)/aula-<numero>`.
- Procura em `A3-Central/06_Conhecimento-Consolidado/Cursos/<id>.md`.
  - Não existe → copia o arquivo, seta `status: consolidated`,
    `sources: [{person, vault, original_file}]`, `estudado_por: [pessoa]`.
  - Existe → compara hash do conteúdo novo vs armazenado.
    - Igual ou "quase igual" (diff pequeno, ex: só timestamps) → não
      sobrescreve; só adiciona a pessoa em `estudado_por:` se ainda não
      estiver lá.
    - Diferente de verdade → cria proposta em `_Propostas/` (mesmo formato
      já usado hoje), sem tocar no consolidado existente.
- Retorna (stdout/exit code) se resultado foi 🟢 automático, 🟡 proposta,
  ou erro — o worker usa isso pra preencher `knowledge_sync_status`.

"Quase igual" = normalizado (sem espaços/timestamps) tem >90% de
similaridade por comparação simples de linhas — suficiente para este caso
de uso (não é detecção semântica sofisticada; isso fica para a camada de
IA futura já documentada).

### 3. Supabase: tabela `knowledge_sync_status`

```sql
create table knowledge_sync_status (
  id uuid primary key default gen_random_uuid(),
  audio_file_id uuid references audio_files(id),
  person_id uuid references profiles(id),
  vault text not null,
  status text not null check (status in ('synced', 'needs_review', 'error')),
  detail text,
  created_at timestamptz not null default now()
);
```
RLS: leitura para `authenticated` (dashboard), escrita só via
`service_role` (o worker), mesmo padrão já usado em `transcription_jobs`.

### 4. Remoção do campo `output_folder`

A aba Configurações da dashboard tem hoje um campo por curso para setar
manualmente a pasta de destino (`courses.output_folder`), usado pelo
`salvar_na_base_de_conhecimento` atual. Com o destino agora resolvido
automaticamente (vault da pessoa + `A3-Central`), esse campo deixa de ter
função. Remover:
- A coluna `output_folder` da tabela `courses` (migration).
- O campo/input correspondente na UI de Configurações da dashboard.
- Qualquer leitura de `output_folder` no worker (a nova
  `salvar_na_base_de_conhecimento` não consulta mais essa coluna).

### 5. Dashboard — aba Usuários

Para cada pessoa (`profiles`):
- **Barra 1 — Progresso do curso**: `count(lessons completed via audio_files.uploaded_by = pessoa) / courses.total_lessons`.
- **Barra 2 — Contribuição à base central**: `count(knowledge_sync_status where person_id = pessoa and status = 'synced')`, normalizado pelo total de aulas consolidadas no curso (pra dar noção relativa entre os três).

Sem endpoint novo — o dashboard já lê Supabase direto (mesmo padrão das
outras abas).

## Tratamento de erros

- Falha ao resolver vault da pessoa (`display_name` não bate com nenhum
  vault conhecido): registra `error` em `knowledge_sync_status` com
  detalhe, não trava o job de transcrição (que já está `completed`).
- Falha no `knowledge-sync` (conflito de git, ex.: você mexeu no vault ao
  mesmo tempo): mesmo comportamento já existente do `knowledge-sync` —
  aborta rebase automaticamente, não perde nada, e o worker registra
  `error` com os arquivos em conflito no `detail`. Nada é sobrescrito ou
  perdido; a aula fica salva localmente no vault (arquivo já escrito em
  disco) esperando você resolver e rodar o sync de novo.
- Falha na consolidação por aula: mesma lógica do `knowledge-consolidator`
  hoje — nunca sobrescreve, nunca apaga; pior caso é ficar pendente como
  proposta 🟡 ou erro 🔴.

## Testes

- Testes unitários (`node:test`, seguindo o padrão de `knowledge-tools`)
  para `knowledge-consolidate-aula`: aula nova, aula duplicada idêntica,
  aula duplicada com conteúdo divergente, curso/módulo com caracteres
  especiais no slug.
- Teste manual ponta a ponta (não automatizável sem os 3 logins reais):
  gravar uma aula de teste por 2 "pessoas" diferentes (contas de teste já
  existem: alanteste/bigodeteste/dodoteste), confirmar que a segunda vira
  "estudado_por" e não duplica, e que o `knowledge_sync_status` aparece
  correto na dashboard.

## Autorevisão da spec

- Sem "TBD"/placeholders pendentes.
- Consistente com as decisões já tomadas na conversa: aulas de curso viram
  🟢 automático, notas pessoais continuam 🟡 manual, nunca sobrescreve/apaga
  original, sem terminal/GitHub para Bigode/Dodô.
- Escopo focado: não inclui RAG, agentes de voz, nem botão de aprovação no
  dashboard (fora de escopo, declarado acima).
