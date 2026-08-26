# A3-OS Recorder — Documentação Técnica Completa

> Documento de referência gerado para servir de base de conhecimento do projeto. Cobre a extensão do Chrome, o painel (dashboard) Next.js, o app desktop Electron e o backend Supabase, incluindo fluxos de dados, decisões de arquitetura e problemas já resolvidos.

---

## 1. Visão geral do sistema

O A3-OS Recorder é composto por quatro peças que conversam entre si através de um único backend Supabase:

```
┌─────────────────────┐        ┌──────────────────────┐
│  Extensão Chrome     │──REST─▶│                       │
│  (grava a aula,      │  auth  │       SUPABASE        │
│  envia áudio)        │◀──────▶│  - Postgres (dados)   │
└─────────────────────┘        │  - Auth (login)       │
                                 │  - Storage (áudios)   │
┌─────────────────────┐        │  - Realtime (eventos) │
│  Dashboard Next.js   │◀──────▶│                       │
│  (painel admin)      │        └──────────┬────────────┘
└─────────────────────┘                    │
          ▲                                 │
          │ empacota                        │ (worker de transcrição
┌─────────────────────┐                     │  externo ao repo, ver §7)
│  App desktop         │                     ▼
│  (Electron)           │           transcreve os áudios
└─────────────────────┘           e grava em `transcriptions`
```

- **Extensão Chrome** (`extension/`): instalada no navegador do aluno. Detecta a aula que está sendo assistida, grava o áudio da aba, faz upload para o Supabase Storage e cria os registros de curso/módulo/aula automaticamente.
- **Dashboard** (`dashboard/`): aplicação Next.js (Pages Router) usada pelo administrador para acompanhar uploads, progresso do curso, usuários online, status do worker de transcrição e configurações gerais.
- **App desktop** (`electron/`): empacota o mesmo dashboard Next.js como um `.exe` Windows instalável, com ícone na bandeja do sistema (como o Discord).
- **Supabase**: banco Postgres com Auth, Storage e Realtime. É o único backend — não há servidor próprio além do worker de transcrição (que roda fora deste repositório).

---

## 2. Extensão do Chrome (`extension/`)

### 2.1 Estrutura de arquivos

```
extension/
├── manifest.json          Manifest V3
├── background.js          Service worker (orquestra tudo)
├── config.js               Chaves do Supabase (gitignored)
├── config.example.js       Template do config.js
├── lib/
│   ├── session.js          Sessão do usuário (login/token)
│   └── supabase.js         Cliente REST minimalista (fetch puro)
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js        Captura e grava o áudio de verdade
├── popup/
│   ├── popup.html/css/js   UI principal (ícone da barra do Chrome)
└── login/
    ├── login.html/css/js   Tela de login
```

### 2.2 Manifest V3 e permissões

`extension/manifest.json` declara:

- `background.service_worker`: `background.js` — roda em segundo plano, sem UI, e pode ser **encerrado pelo Chrome a qualquer momento de ociosidade** (ponto crítico, ver §2.5).
- Permissões: `storage`, `tabs`, `activeTab`, `scripting`, `tabCapture`, `offscreen`, `nativeMessaging`, `alarms`.
- `host_permissions`: `<all_urls>` (para rodar em qualquer página de curso) + o domínio do Supabase.
- `action.default_popup`: `popup/popup.html` — a UI que abre ao clicar no ícone da extensão.
- Dois conjuntos de ícones (`icon-normal-*` e `icon-recording-*`) trocados dinamicamente para indicar visualmente se está gravando.

### 2.3 Autenticação (`lib/session.js` + `lib/supabase.js`)

A extensão **não usa o SDK oficial `@supabase-js`** — usa `fetch` puro contra a API REST do Supabase (`lib/supabase.js`, objeto `A3Supabase`), porque um service worker MV3 não pode carregar um bundler/pacote npm sem um passo de build. Isso mantém a extensão "sem build step".

- `A3Supabase.signIn(email, senha)` → `POST /auth/v1/token?grant_type=password`
- `A3Supabase.refreshSession(refreshToken)` → `POST /auth/v1/token?grant_type=refresh_token`
- `A3Supabase.signOut(token)` → `POST /auth/v1/logout`
- CRUD genérico: `restSelect`, `restInsert`, `restUpdate`, `rpc`, `uploadToStorage` — todos anexam o header `apikey` (chave anônima) e `Authorization: Bearer <token>`.

A sessão (`A3Session` em `lib/session.js`) é persistida em `chrome.storage.local` sob a chave `a3os_session`, contendo `access_token`, `refresh_token`, `expires_at` (calculado como `Date.now() + expires_in*1000`) e o usuário `{id, email}`.

- `getValidAccessToken()`: se o token expira em menos de 60s, renova automaticamente via `refreshSession`. Se a renovação falhar, limpa a sessão local (força novo login).
- Login "lembrar-me" (`login.js`): guarda e-mail/senha em texto no `chrome.storage.local` (chave `a3os_remember_me`) **apenas se o usuário marcar a caixa** — usado para repreencher o formulário, não para pular o login de fato.

### 2.4 Fluxo de gravação (o coração da extensão)

Divide-se entre dois contextos porque um service worker MV3 **não tem acesso a `getUserMedia`/`MediaRecorder`** — só um documento DOM tem. Por isso existe o **offscreen document**.

```
Popup                 Background (service worker)         Offscreen document
  │  clique "GRAVAR"          │                                    │
  ├──"start-recording"───────▶│                                    │
  │                           │ chrome.tabCapture.getMediaStreamId │
  │                           ├──"start-recording" + streamId─────▶│
  │                           │                                    │ getUserMedia(streamId)
  │                           │                                    │ MediaRecorder.start(1000)
  │                           │◀──────────── {success:true} ───────┤
  │◀── ícone muda p/ gravando │                                    │
  │                                                                 │  (grava a cada 1s)
  │  clique "PARAR"           │                                    │
  ├──"stop-recording"────────▶│                                    │
  │                           ├──"stop-recording"──────────────────▶│ mediaRecorder.stop()
  │                           │                                    │ onstop → finalizarGravacao()
  │                           │                                    │  monta Blob, converte p/ base64
  │                           │◀── "recording-finished" + chunks ──┤
  │                           │  resolve curso/módulo/aula          │
  │                           │  salva cópia local (Native Host)    │
  │                           │  faz upload pro Supabase Storage    │
  │                           │  cria audio_files + transcription_jobs
  │◀── "upload-status: done" ─┤                                    │
```

**Passo a passo detalhado (`background.js`):**

1. **`iniciarGravacao(title, outputFolder)`**
   - Cria o offscreen document se ainda não existir (`chrome.offscreen.createDocument`).
   - Verifica se o offscreen **já está gravando de verdade** (`consultarOffscreenGravando`) — importante porque o service worker pode ter sido reiniciado no meio de uma gravação longa e "esquecido" que estava gravando; nesse caso apenas resincroniza o estado, sem iniciar uma segunda captura.
   - Pega a aba ativa (`chrome.tabs.query`), obtém um `streamId` via `chrome.tabCapture.getMediaStreamId`.
   - Envia `{target:"offscreen", action:"start-recording", streamId, title}` para o offscreen.
   - Ao sucesso, salva `recording: true` em `chrome.storage.session` e troca o ícone da extensão para o de "gravando".

2. **Offscreen (`offscreen.js`) — `iniciarGravacao(streamId, title)`**
   - `getUserMedia` com `chromeMediaSource: "tab"` e o `streamId` recebido (é a API específica de captura de aba do Chrome, usada dentro de `mandatory`).
   - Cria um `AudioContext`, conecta a fonte capturada no `audioContext.destination` — **isso restaura o áudio nos alto-falantes**, já que capturar a aba silenciaria o som para o usuário se não fosse reconectado manualmente.
   - `MediaRecorder` com `audio/webm;codecs=opus` (fallback para `audio/webm` puro se opus não suportado), `audioBitsPerSecond: 128000`.
   - A cada 1000ms (`mediaRecorder.start(1000)`) um novo chunk de dados é entregue via `ondataavailable` e empilhado em `audioChunks`.

3. **Parar → `finalizarGravacao()` (offscreen)**
   - Monta um único `Blob` a partir de `audioChunks`.
   - Gera o nome do arquivo: título da aula sanitizado (remove caracteres inválidos de nome de arquivo) + `_<timestamp>` (evita colisão entre uploads do mesmo título) + `.webm`.
   - Converte o Blob inteiro para **base64 em chunks de 512KB** (`chunks: string[]`) — necessário porque o **Native Messaging Host só aceita JSON serializável**, não binário bruto.
   - Envia `{target:"background", action:"recording-finished", filename, chunks}`.
   - Libera a stream, desconecta o `AudioContext`, zera as variáveis.

4. **Background recebe `recording-finished`** (bloco mais longo do arquivo):
   - Se o usuário configurou uma pasta de saída local (`currentRecording.outputFolder`), tenta salvar uma **cópia local via Native Messaging Host** (`com.a3os.folderpicker.dev`) — falha nessa etapa **não interrompe o fluxo**, só loga o erro e segue para o Supabase.
   - `resolverCursoModulo(title, token)`: interpreta o título da aula no formato `"<número> - <curso> - <título da aula>"` via regex `^\s*(\d+)\s*-\s*(.+?)\s*-\s*(.+?)\s*$`. Se o título não seguir esse padrão, cai em um curso genérico "Aulas sem curso identificado" e numera a aula sequencialmente dentro do módulo. Cria automaticamente `courses`/`modules`/`lessons` no Supabase se ainda não existirem (upsert manual: seleciona, se não achar, insere).
   - Decodifica os chunks base64 de volta para bytes reais (`atob` + `Uint8Array`) — **importante**: os chunks base64 que vão para o Native Host **não podem ser alterados** (contrato fixo), mas para o Supabase Storage é preciso decodificar antes de montar o `Blob`, senão o arquivo enviado é texto base64 em vez de áudio binário real.
   - Sanitiza o nome do arquivo para a **chave do Storage** (remove acentos via `normalize("NFD")` + regex, troca tudo que não é `A-Za-z0-9._-` por `_`) — o Supabase Storage rejeita chaves com espaço/acento mesmo com URL-encoding. O nome original (com acentos) continua salvo em `audio_files.filename` para exibição.
   - Caminho no Storage: `${courseId}/${moduleId}/${lessonId}/${nomeStorageSeguro}`.
   - `uploadToStorage("audio", storagePath, blob, token)` → `POST /storage/v1/object/audio/<path>`.
   - Insere `audio_files` (status `"uploaded"`) e depois `transcription_jobs` (status `"pending"`) — é esse job pendente que o worker externo (§7) vai pegar para transcrever.
   - Envia mensagens `upload-status` (`uploading` → `done`/`error`) que o popup escuta para atualizar a UI em tempo real.

### 2.5 Por que existe `chrome.storage.session` além de `chrome.storage.local`

Comentário explícito no código (`background.js`): o service worker MV3 pode ser **encerrado pelo Chrome a qualquer momento de ociosidade**, mesmo no meio de uma gravação de vários minutos — o offscreen document continua gravando normalmente (ele é independente), mas variáveis locais do worker (`recording`, `currentRecording`) voltam ao estado inicial quando ele reinicia. Por isso todo esse estado é sempre espelhado em `chrome.storage.session` (que sobrevive a reinícios do worker, mas não a fechar o navegador) via `salvarEstado()`/`carregarEstado()`.

### 2.6 Popup (`popup/popup.js`)

Ao abrir o popup:

1. Confere se há usuário logado (`get-current-user`); se não, redireciona para `login.html`.
2. Mostra saudação (`Bom dia`/`Boa tarde`/`Boa noite`) com o nome do usuário.
3. **Detecta o título da aula e o módulo** injetando um script na aba ativa (`chrome.scripting.executeScript`): pega o texto do primeiro `<h1>` como título; para o módulo, procura o último elemento `.text-foreground` que aparece **antes** do `<h1>` no DOM (ignorando textos de navegação genéricos como "Voltar"/"Próxima").
4. Consulta o status real de gravação (`get-recording-status`) e atualiza a UI (botão "GRAVAR"/"PARAR GRAVAÇÃO", ícone, badge de status).
5. Carrega histórico de envios (`get-upload-history`, últimos 20), progresso geral do curso (`get-overall-progress`) e progresso do módulo detectado (`get-module-progress`) — cada um é uma barra de progresso na UI.
6. Badge de conexão com o banco (**"Conectado"/"Sem conexão"**) fica no `user-bar`, ao lado do nome e do botão de sair — é derivado do sucesso/erro da própria chamada `get-upload-history`.
7. Escuta mensagens em tempo real do background (`recording-state`, `upload-status`, `download-error`) para manter a UI sincronizada sem precisar reabrir o popup.
8. Alternância de tema claro/escuro persistida em `chrome.storage.local` (`theme`).

### 2.7 Configuração (`config.js`)

`extension/config.js` (gitignored) define:
```js
globalThis.A3OS_CONFIG = {
    SUPABASE_URL: "https://kvvcbkamxalcklnyodeu.supabase.co",
    SUPABASE_ANON_KEY: "<chave anônima pública>"
};
```
A **anon key é segura para distribuir** — é uma chave pública protegida pelas regras de RLS (Row Level Security) do Supabase, não um segredo de servidor. Por isso o dashboard **empacota `config.js` dentro do zip de distribuição** (§4) para que amigos que recebam a extensão já se conectem ao mesmo backend sem precisar configurar nada.

### 2.8 Native Messaging Host (`com.a3os.folderpicker.dev`)

Usado para dois recursos opcionais que dependem de acesso ao sistema de arquivos local (impossível a partir de uma extensão pura):

- **Selecionar pasta de saída** (`select-folder`): abre um seletor de pasta nativo do SO.
- **Salvar cópia local do áudio** (`save-audio`): grava o `.webm` diretamente em disco, além do upload para o Supabase.

O host nativo (`com.a3os.folderpicker.dev`) **não faz parte deste repositório** — é um executável companion registrado no Windows Registry apontando para um manifest de Native Messaging. Se não estiver instalado, `chrome.runtime.connectNative` falha e o fluxo cai no catch, mas **isso nunca bloqueia o upload para o Supabase** (é tratado como best-effort).

---

## 3. Dashboard (`dashboard/`)

### 3.1 Stack

Next.js 16 (Pages Router, sem TypeScript), React 18, `@supabase/supabase-js` (SDK oficial, ao contrário da extensão), CSS puro em `styles/globals.css` (tema roxo/azul "Dashdark X", glassmorphism).

### 3.2 Autenticação e controle de acesso

- `pages/index.js` usa `supabase.auth.getSession()` + `supabase.auth.onAuthStateChange` para observar a sessão.
- Só usuários cujo e-mail bate com `NEXT_PUBLIC_ADMIN_EMAIL` (variável de ambiente) veem o `Dashboard`; qualquer outro e-mail logado cai numa tela de "Essa conta não tem acesso ao painel."
- `pages/transcricao/[id].js` repete a mesma checagem de e-mail admin — página standalone para ver o texto de uma transcrição específica (aberta a partir da tabela do dashboard).

### 3.3 Variáveis de ambiente (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_ADMIN_EMAIL=...
```

### 3.4 Carregamento de dados (`carregar()`, dentro do componente `Dashboard`)

Uma única função busca **tudo** de uma vez, de forma "burra e direta" (sem cache/paginação sofisticada):

- `app_settings` (linha única, `id = true`): `auto_transcribe`, `delete_password_hash`.
- `worker_status`: status mais recente do worker de transcrição (`worker_id`, `gpu_name`, `worker_version`, `status`, `current_job_id`, `last_seen`).
- `profiles`: todos os usuários (para a lista "Usuários" e para detectar quem está online).
- `courses` (com `modules.lessons.status` aninhado) → calcula progresso geral do curso (aulas/módulos concluídos).
- `modules` (com `courses.name` e `lessons.status` aninhados) → progresso por módulo, usado na aba "Progresso".
- `audio_files` (com `profiles`, `lessons`, `modules`, `courses`, `transcription_jobs` aninhados) → a tabela principal de arquivos enviados.

**Realtime**: um único canal Supabase (`dashboard-realtime`) escuta `postgres_changes` (`event: "*"`) nas tabelas `audio_files`, `transcription_jobs`, `app_settings`, `worker_status`, `profiles`, `courses`, `modules`, `lessons` — qualquer mudança em qualquer uma delas simplesmente **reexecuta `carregar()` inteiro**. É uma estratégia deliberadamente simples (recarregar tudo) em vez de merges granulares de estado.

### 3.5 Navegação por abas (sidebar)

O estado `view` controla qual conteúdo aparece na área principal. Views existentes:

| `view`             | Ícone           | Conteúdo                                                              |
|--------------------|-----------------|-------------------------------------------------------------------------|
| `"files"` (padrão) | `IconGrid`      | Tabela de áudios enviados, filtros por status, busca, exclusão         |
| `"usuarios"`       | (stat clicável) | Lista de usuários e status online/offline                              |
| `"progresso"`      | `IconTrendingUp`| Progresso geral do curso + progresso por módulo (barras)               |
| `"notificacoes"`   | `IconBell`      | Toggles de preferência de notificação nativa do SO                     |
| `"extensao"`       | `IconDownload`  | Botão de download do `.zip` da extensão + instruções de instalação     |
| `"configuracoes"`  | `IconGear`      | Transcrição automática, tema claro/escuro, senha de exclusão           |

Cards de estatística (`sidebar-stat`) no topo — Arquivos, Usuários, Concluídas, Pendentes — também disparam mudanças de `view`/`statusFilter` ao serem clicados.

### 3.6 Notificações nativas (aba "Notificações")

Implementado com a **Browser `Notification` API** (funciona tanto numa aba normal do Chrome quanto dentro do wrapper Electron, que mapeia isso para notificações nativas do Windows automaticamente, sem código extra).

- Preferências (`notifPrefs`) persistidas em `localStorage` (`dashboard-notif-prefs`): `amigosOnline`, `audioPendente`, `transcricaoSucesso`, `transcricaoFalha` — cada uma com um toggle (`.switch`/`.switch-dot`) na aba.
- No primeiro carregamento, se `Notification.permission === "default"`, pede permissão ao navegador/SO.
- **Detecção de transições de estado** (não dispara notificação a cada poll, só quando algo muda de fato): usa `useRef` para guardar o snapshot anterior de:
  - IDs de usuários online (`prevOnlineIdsRef`) → comparado a cada novo array de `usuarios` recebido do Realtime.
  - IDs de áudios pendentes (`prevAudioIdsRef`) e status de cada job (`prevJobStatusRef`) → comparado a cada novo array de `rows`.
- Essa abordagem **reaproveita 100% da infraestrutura de dados já existente** (o pipeline Realtime → `carregar()` → `setUsuarios`/`setRows`) em vez de criar subscriptions novas — o custo é granularidade mais grossa (compara o estado inteiro a cada `carregar()`, não evento a evento), o que é aceitável porque `carregar()` já roda a cada mudança relevante.

### 3.7 Extensão para download (aba "Extensão")

- `dashboard/public/a3-os-extension.zip`: cópia compactada de toda a pasta `extension/` (incluindo `config.js` com a chave anônima real — ver §2.7 sobre por que isso é seguro).
- Gerado por `dashboard/scripts/zip-extension.ps1` (PowerShell `Compress-Archive`), chamado automaticamente pelo script `npm run build` via `npm run zip:extension` (roda **antes** do `next build`, então o zip está sempre atualizado a cada deploy/build).
- A aba serve o arquivo como link de download direto (`/a3-os-extension.zip`, servido estaticamente pelo Next.js a partir de `public/`) mais um passo a passo em português para o amigo instalar manualmente (`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação).

### 3.8 Configurações (aba "Configurações")

Antes era um dropdown (`sidebar-settings-wrap`) que abria ao clicar no ícone de engrenagem; foi convertido para uma aba de página inteira (mesmo padrão visual de "Notificações"), contendo:

- **Transcrição automática**: toggle que grava direto em `app_settings.auto_transcribe` (o worker externo provavelmente lê essa flag para decidir se processa jobs sem confirmação manual).
- **Tema**: claro/escuro, persistido em `localStorage` (`dashboard-theme`) e aplicado via atributo `data-theme` no `<html>`.
- **Senha de exclusão**: hash SHA-256 (`crypto.subtle.digest`) salvo em `app_settings.delete_password_hash`. É exigida para confirmar a exclusão de qualquer áudio (ver §3.9) — a senha em si nunca é salva, só o hash, e a comparação também é feita hasheando o texto digitado e comparando os hashes.

### 3.9 Exclusão de áudios (fluxo de confirmação por senha)

1. Clicar em excluir (`pedirExclusao(row)`) abre um modal pedindo a senha de exclusão.
2. `confirmarExclusao()`: se não houver `delete_password_hash` configurado, bloqueia com mensagem pedindo para configurar a senha primeiro. Se houver, hasheia a senha digitada e compara com o hash salvo.
3. Em caso de sucesso, apaga em cascata: `transcriptions` → `transcription_jobs` → arquivo no Storage (`supabase.storage.from("audio").remove(...)`) → `audio_files`. Depois recarrega os dados.

### 3.10 Página de transcrição (`pages/transcricao/[id].js`)

Rota dinâmica separada (não faz parte da sidebar) que mostra o **texto completo de uma transcrição** — aberta a partir de um link/botão na tabela principal do dashboard. Busca `audio_files` por `id` com o relacionamento `transcriptions(text, created_at)` aninhado. Mesma checagem de e-mail admin do `index.js`. Se não houver transcrição ainda, mostra "Transcrição ainda não disponível para este áudio."

---

## 4. App desktop (Electron) (`electron/`)

### 4.1 Objetivo

Empacotar o **mesmo dashboard Next.js** (sem reescrever nada da UI) como um `.exe` instalável no Windows, com atalho na área de trabalho/menu iniciar e um ícone na bandeja do sistema perto do relógio, como o Discord (minimizar para a bandeja em vez de fechar, clique único mostra/esconde, clique direito abre menu com "Abrir"/"Sair").

### 4.2 Como o Next.js roda dentro do Electron

O Next.js normalmente precisa de `next dev`/`next start`, que não fazem sentido dentro de um `.exe` distribuído. A solução usa o modo **`output: "standalone"`** do Next.js (configurado em `dashboard/next.config.js`):

- `next build` com `output: "standalone"` gera uma pasta autocontida (`dashboard/.next/standalone/`) com um `server.js` que roda com **Node puro**, sem precisar do Next.js CLI instalado.
- **Pegadinha documentada** (já foi bug em produção, ver §6): o modo standalone **não copia automaticamente** `.next/static/` nem `public/` para dentro da pasta standalone — só o runtime do servidor. Sem esses arquivos, a página carrega mas todo CSS/JS/imagens dão 404 e a tela fica em branco/preta.
- Correção: `electron/copy-static.js`, chamado depois do `next build` (via `npm run build:dashboard` em `electron/package.json`), copia manualmente:
  - `dashboard/.next/static` → `dashboard/.next/standalone/.next/static`
  - `dashboard/public` → `dashboard/.next/standalone/public`

### 4.3 `electron/main.js` — processo principal

Fluxo no `app.whenReady()`:

1. Verifica **lock de instância única** (`app.requestSingleInstanceLock()`) — se já existe uma instância rodando, a nova simplesmente foca a janela existente e sai (`second-instance` event). **Isso é crítico** (ver bug documentado em §6.1): sem esse lock, cada clique extra no `.exe` durante o carregamento inicial (alguns segundos) criava uma árvore de processos Electron+Chromium+Node inteiramente nova, consumindo toda a RAM da máquina.
2. `startServer()`: verifica primeiro se já existe algo respondendo em `http://127.0.0.1:4173` (`isServerAlreadyRunning`); se não, faz `spawn(process.execPath, [serverPath], {env: {PORT:4173, HOSTNAME:"127.0.0.1", NODE_ENV:"production", ELECTRON_RUN_AS_NODE:"1"}})` — ou seja, usa o **próprio binário do Electron como runtime Node** para rodar o `server.js` do Next standalone (evita depender de um Node.js instalado separadamente no PC do usuário). `ELECTRON_RUN_AS_NODE=1` garante que essa instância spawnada rode como um processo Node puro, sem tentar inicializar o framework Electron/Chromium de novo.
3. `waitForServer()`: faz polling HTTP em `http://127.0.0.1:4173` a cada 500ms (até 60 tentativas / 30s) até o servidor responder.
4. `createWindow()`: cria a `BrowserWindow` (1280x800, mínimo 960x640) e carrega a URL local.
5. `createTray()`: cria o ícone na bandeja com menu de contexto (Abrir/Sair).
6. Fechar a janela (`X`) **não encerra o app** — apenas esconde (`mainWindow.hide()`), com `isQuitting` controlando se é um fechamento de verdade (só true quando o usuário clica em "Sair" no menu da bandeja ou no `before-quit`).

### 4.4 Resolução de caminhos: dev vs. empacotado

`app.isPackaged` diferencia os dois cenários porque a estrutura de pastas muda:

| Recurso        | Modo dev (`npm start`)                                              | Modo empacotado (instalado)                                  |
|-----------------|----------------------------------------------------------------------|----------------------------------------------------------------|
| `server.js`     | `electron/../dashboard/.next/standalone/server.js`                   | `<resources>/app/server.js` (via `extraResources`)             |
| `build/icon.png`| `electron/build/icon.png`                                            | `<resources>/build/icon.png` (via `extraResources`)            |

O ícone precisou de tratamento especial: originalmente o código apontava sempre para `path.join(__dirname, "build", "icon.png")`, que funciona em dev (arquivos soltos em disco) mas **não existe dentro do `app.asar`** empacotado, já que só `main.js`/`preload.js` estavam listados em `"files"`. Corrigido adicionando `build/` como `extraResources` no `package.json` e uma função `getIconPath()` que escolhe o caminho certo conforme `app.isPackaged`.

### 4.5 Logging em arquivo (diagnóstico)

Como um app Windows GUI empacotado **não tem console anexado** (`console.log` normalmente não vai a lugar nenhum fora do modo dev com DevTools), `main.js` grava tudo também em arquivo via uma função `log()` própria:

- Caminho: `%APPDATA%\a3-os-dashboard-desktop\main.log` (via `app.getPath("userData")`).
- Cobre: início do app, caminho e existência do `server.js`, saída padrão/erro do processo do servidor Next, sucesso/erro ao aguardar o servidor responder, eventos da janela (`did-fail-load`, `did-finish-load`, `render-process-gone`).
- Em caso de falha ao subir o servidor, mostra um `dialog.showErrorBox` nativo apontando para esse arquivo de log — essencial porque sem isso o usuário só veria uma janela preta sem nenhuma pista do que deu errado.

### 4.6 Scripts (`electron/package.json`)

```
npm start        → electron .                          (roda em modo dev, abre DevTools automaticamente)
npm run build:dashboard  → builda o Next.js standalone + copia estáticos
npm run dist      → build:dashboard + electron-builder (gera o instalador .exe)
```

`electron-builder` config (NSIS target): instalador com opção de escolher pasta de instalação, atalhos de área de trabalho e menu iniciar, ícone mínimo de 256×256 (limite do próprio electron-builder no Windows).

`CSC_IDENTITY_AUTO_DISCOVERY=false` é setado no script `dist` para pular a busca por certificado de assinatura de código (o app não é assinado digitalmente — normal para uso pessoal/distribuição informal, mas o Windows SmartScreen pode alertar na primeira execução).

---

## 5. Modelo de dados (Supabase Postgres)

> O schema SQL **não está neste repositório** (gerenciado direto no painel do Supabase ou em outro repo). A lista abaixo foi reconstruída a partir de todas as queries feitas pela extensão e pelo dashboard — reflete os campos realmente usados no código, não necessariamente o schema completo.

| Tabela                | Campos usados no código                                                                                          | Observações |
|------------------------|--------------------------------------------------------------------------------------------------------------------|-------------|
| `profiles`             | `id`, `display_name`, `last_seen`                                                                                  | Um registro por usuário autenticado; `last_seen` atualizado a cada 30s pela extensão (heartbeat) |
| `courses`               | `id`, `name`, `total_modules`, `total_lessons`                                                                     | Criado automaticamente pela extensão se não existir (por nome) |
| `modules`               | `id`, `course_id`, `module_number`, `name`, `total_lessons`                                                        | Criado automaticamente pela extensão (a extensão só cria módulo `1` — os demais 33 módulos reais do curso Vray 6 foram semeados manualmente/via seed) |
| `lessons`               | `id`, `module_id`, `lesson_number`, `title`, `status`                                                              | `status`: presumivelmente `pending`/`completed` — usado para calcular progresso |
| `audio_files`           | `id`, `course_id`, `module_id`, `lesson_id`, `uploaded_by`, `storage_path`, `filename`, `mime_type`, `file_size`, `status`, `created_at` | `status`: `uploaded` → (worker externo atualiza) |
| `transcription_jobs`    | `id`, `audio_file_id`, `status`, `attempts`, `manual_requested`, `error_message`, `progress_percent`               | `status`: `pending`/`processing`/`completed`/`failed`; `manual_requested` setado pelo botão "Transcrever agora" do dashboard |
| `transcriptions`        | `audio_file_id`, `text`, `created_at`                                                                              | Criado pelo worker externo após transcrever |
| `app_settings`          | `id` (linha única, `id = true`), `auto_transcribe`, `delete_password_hash`                                         | Configurações globais (não por usuário) |
| `worker_status`         | `worker_id`, `gpu_name`, `worker_version`, `status`, `current_job_id`, `last_seen`                                 | Heartbeat do worker de transcrição (processo externo) |

**Bucket de Storage**: `audio` — caminho `<course_id>/<module_id>/<lesson_id>/<filename_sanitizado>.webm`.

**RLS (Row Level Security)**: não documentado neste repo, mas presumido ativo (é o motivo pelo qual a anon key pode ser distribuída publicamente com segurança — ver §2.7).

---

## 6. Bugs já resolvidos (histórico útil para não repetir)

### 6.1 Estouro de RAM ao instalar o app desktop

**Sintoma**: usuário instalou o `.exe`, ao abrir o app o sistema travou consumindo toda a RAM, precisou forçar reinicialização.

**Causa raiz**: `electron/main.js` não tinha nenhum lock de instância única. O servidor Next.js standalone leva alguns segundos para subir; cada clique extra do usuário no ícone (achando que não tinha funcionado) abria uma **instância inteiramente nova** do Electron (processo principal + GPU + renderer + rede + áudio + crashpad — cada instância gera de 5 a 8 processos do Windows).

**Correção**: `app.requestSingleInstanceLock()` + handler `second-instance` (foca a janela existente) + checagem `isServerAlreadyRunning()` antes de spawnar um novo processo do servidor. Ver §4.3.

### 6.2 Tela preta/branca (404 em todos os assets estáticos)

**Sintoma**: app abre, janela fica preta, DevTools mostra 404 para todos os arquivos `.js`/`.css` do Next.js.

**Causa raiz**: `next build` com `output: "standalone"` não copia `.next/static/` nem `public/` para dentro da pasta standalone (comportamento documentado do próprio Next.js, não é bug do projeto).

**Correção**: `electron/copy-static.js`, executado depois de todo `next build`. Ver §4.2.

### 6.3 Layout com espaço vazio à direita em tela cheia

**Sintoma**: numa janela maximizada em monitor largo (1920px+), sobrava um espaço vazio grande à direita do conteúdo.

**Causa raiz**: `.main-content { max-width: 1180px }` em `dashboard/styles/globals.css` — decisão de design pré-existente (não era bug do Electron; o mesmo aconteceria numa aba de navegador maximizada).

**Correção** (escolha explícita do usuário entre duas opções apresentadas): removido o `max-width`, mantendo `flex: 1; min-width: 0; padding: 28px 32px 60px;` — o conteúdo agora estica para preencher toda a largura da janela.

### 6.4 Ícone da bandeja/janela ausente no build empacotado

**Sintoma**: (encontrado durante investigação, corrigido preventivamente) o caminho do ícone (`__dirname/build/icon.png`) não existe dentro do `app.asar` empacotado, pois só `main.js`/`preload.js` eram incluídos nos `files` do electron-builder.

**Correção**: `build/` adicionado como `extraResources` + função `getIconPath()` que resolve o caminho certo conforme `app.isPackaged`. Ver §4.4.

---

## 7. O que **não** está neste repositório (mas faz parte do sistema)

- **Worker de transcrição**: processo externo (provavelmente rodando numa máquina com GPU — os campos `gpu_name`/`worker_version` em `worker_status` sugerem isso) que consome `transcription_jobs` com `status = "pending"`, baixa o áudio do Storage, transcreve (provavelmente com Whisper ou similar) e grava o resultado em `transcriptions`, atualizando `audio_files.status`/`transcription_jobs.status` para `completed` ou `failed`.
- **Schema SQL completo / migrations**: as tabelas foram inferidas das queries do código (§5); não há arquivos `.sql` neste repositório.
- **Native Messaging Host** (`com.a3os.folderpicker.dev`): executável companion do Windows que permite selecionar pasta e salvar cópia local do áudio. Não está neste repositório.
- **Políticas de RLS do Supabase**: configuradas diretamente no painel do Supabase, não versionadas aqui.

---

## 8. Convenções e decisões de projeto (para manter consistência)

- **Comentários em português, código em português** (nomes de função, variáveis) na extensão e no dashboard — seguir o padrão existente.
- Extensão usa **fetch puro**, nunca o SDK `@supabase/supabase-js`, para evitar step de build no service worker.
- Dashboard usa o **SDK oficial** `@supabase/supabase-js` normalmente (roda em Next.js, tem bundler).
- Todo dado sensível de configuração (chaves, e-mail admin) fica em variáveis de ambiente (`dashboard/.env.local`, gitignored) ou em `extension/config.js` (gitignored) — nunca hardcoded fora desses arquivos.
- A anon key do Supabase é segura para embutir/distribuir publicamente (protegida por RLS) — isso é uma decisão consciente, não um descuido.
- Padrão de toggle reutilizado em várias telas: `.settings-row` + `.switch`/`.switch-dot` + atributo `data-on`.
- Views do dashboard são todas controladas por um único state `view` na sidebar — ao adicionar uma nova aba, seguir o padrão: botão na sidebar → branch no título/subtítulo do `page-header` → bloco `{view === "..." && (<div className="card">...)}`.
