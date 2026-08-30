const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Lista de pastas separadas por ";" — dá pra apontar o assistente pra várias
// vaults ao mesmo tempo (ex: A3-Central + Zoio-Knowledge + as dos sócios).
// Mantém compatibilidade com a variável antiga (ASSISTANT_VAULT_DIR).
const VAULT_DIRS = (process.env.ASSISTANT_VAULT_DIRS || process.env.ASSISTANT_VAULT_DIR || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5";
const MAX_CONTEXT_CHARS = 12000;
const MAX_FILES_IN_CONTEXT = 6;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// Cliente com privilégio de escrita (bypassa RLS) — usado só no servidor,
// nunca exposto ao navegador. Sem isso, as ferramentas de ação (reprocessar
// transcrição, etc.) não funcionam, só a leitura da vault.
const supabaseAdmin =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

// Só entra no contexto o que já foi de fato consolidado por uma pessoa —
// pastas técnicas (_Templates, .obsidian, .git) nunca são lidas.
const IGNORED_DIRS = new Set([".git", ".obsidian", "_Templates", "node_modules"]);

function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { frontmatter: {}, body: raw };

    const frontmatter = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (kv) {
            frontmatter[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
        }
    }
    const body = raw.slice(match[0].length);
    return { frontmatter, body };
}

function listMarkdownFiles(dir) {
    let results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(listMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            results.push(fullPath);
        }
    }
    return results;
}

function buildIndex() {
    const entries = [];
    for (const vaultDir of VAULT_DIRS) {
        const vaultName = path.basename(vaultDir);
        for (const filePath of listMarkdownFiles(vaultDir)) {
            const raw = fs.readFileSync(filePath, "utf8");
            const { frontmatter, body } = parseFrontmatter(raw);
            entries.push({
                filePath,
                vault: vaultName,
                title: frontmatter.title || path.basename(filePath),
                curso: frontmatter.curso || "",
                modulo: frontmatter.modulo || "",
                body,
            });
        }
    }
    return entries;
}

function normalizeWords(text) {
    return String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // remove acentos (ex: "módulo" -> "modulo")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);
}

function scoreEntry(entry, questionWords) {
    const haystack = normalizeWords(`${entry.title} ${entry.curso} ${entry.modulo}`);
    const haystackSet = new Set(haystack);
    return questionWords.filter((w) => haystackSet.has(w)).length;
}

function pickRelevantFiles(index, question) {
    const questionWords = normalizeWords(question);
    if (questionWords.length === 0) return [];

    const scored = index
        .map((entry) => ({ entry, score: scoreEntry(entry, questionWords) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

    return scored.slice(0, MAX_FILES_IN_CONTEXT).map((s) => s.entry);
}

function buildContext(files) {
    let context = "";
    for (const file of files) {
        const remaining = MAX_CONTEXT_CHARS - context.length;
        if (remaining <= 200) break; // não sobra espaço útil, para por aqui

        const header = `## ${file.title} (${file.curso} / ${file.modulo} — fonte: ${file.vault})\n`;
        const bodyBudget = remaining - header.length - 20; // folga pro "\n\n[...trecho cortado]\n\n"
        const body = file.body.trim();
        const truncated = body.length > bodyBudget;
        const chunk = `${header}${body.slice(0, Math.max(bodyBudget, 0))}${truncated ? "\n[...trecho cortado por limite de tamanho...]" : ""}\n\n`;

        context += chunk;
        if (truncated) break; // já preenchemos o espaço disponível
    }
    return context;
}

const VOICE_STYLE_RULE =
    "Sua resposta vai ser lida em voz alta por um sistema de texto-para-fala, então escreva em texto corrido, sem markdown (nada de **negrito**, listas com - ou *, títulos com #), sem emojis e sem símbolos especiais. Só frases naturais, como se estivesse falando.";

const SOURCE_TYPE_RULE =
    "Alguns arquivos do contexto são DOCUMENTAÇÃO (descrevem como o sistema/pipeline FOI PROJETADO para funcionar — arquivos com nomes como 'Pipeline-...', 'Guia-do-Sistema', 'Sistema-Dashboard-...') e outros são CONTEÚDO REAL (aulas/transcrições de fato existentes). Para perguntas sobre COMO O SISTEMA FUNCIONA (o que é a dashboard, como funciona a extensão, como o transcritor processa um áudio, etc.), use normalmente o conteúdo da documentação — ela é a fonte certa pra esse tipo de pergunta, responda com todos os detalhes que ela trouxer. Só tenha cuidado especificamente quando a pergunta for sobre o que já existe/foi processado HOJE na base (quantas aulas, quais cursos já têm conteúdo, o que tem dentro de tal pasta agora): nesse caso específico, não apresente os exemplos citados na documentação (que descrevem o pipeline em abstrato) como se fossem um inventário real do que já foi gerado — deixe claro que a documentação explica o funcionamento, mas não é uma lista do conteúdo atualmente presente.";

const AGENT_TOOLS_RULE =
    "Você também tem ferramentas para agir sobre o sistema de transcrição (não só responder perguntas). Use 'listar_transcricoes_pendentes' sempre que o usuário perguntar o que está pendente, travado ou com erro. Quando o usuário pedir para reprocessar/tentar de novo/destravar uma transcrição específica E já tiver indicado qual (pelo nome da aula ou pelo job_id), CHAME a ferramenta 'reprocessar_transcricao' imediatamente com esses dados — não escreva você mesmo um pedido de confirmação em texto, o sistema já cuida de pedir a confirmação ao usuário depois que você chama a ferramenta. Só NÃO chame a ferramenta se ainda não estiver claro qual transcrição é (nesse caso pergunte qual, ou use 'listar_transcricoes_pendentes' primeiro para descobrir o job_id).";

const TOOLS = [
    {
        type: "function",
        function: {
            name: "listar_transcricoes_pendentes",
            description:
                "Lista os jobs de transcrição que estão pendentes, em processamento ou com falha no momento, com o nome da aula/curso/módulo de cada um.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "reprocessar_transcricao",
            description:
                "Marca um job de transcrição para ser reprocessado do zero pelo worker (Transcritor Local). Ação sensível: só é executada de fato depois que o usuário confirmar explicitamente.",
            parameters: {
                type: "object",
                properties: {
                    job_id: {
                        type: "string",
                        description: "ID do job de transcrição (transcription_jobs.id), obtido via listar_transcricoes_pendentes.",
                    },
                    descricao: {
                        type: "string",
                        description: "Descrição curta e legível da aula/áudio, para mostrar ao usuário no pedido de confirmação.",
                    },
                },
                required: ["job_id", "descricao"],
            },
        },
    },
];

async function listarTranscricoesPendentes() {
    if (!supabaseAdmin) {
        return { erro: "Conexão com o banco de dados não configurada no servidor (SUPABASE_SERVICE_ROLE_KEY ausente)." };
    }

    const { data, error } = await supabaseAdmin
        .from("transcription_jobs")
        .select(
            "id, status, error_message, progress_percent, audio_files(filename, status, lessons(title, modules(name, courses(name))))"
        )
        .in("status", ["pending", "processing", "failed"])
        .order("created_at", { ascending: true })
        .limit(20);

    if (error) {
        return { erro: `Erro ao consultar transcrição pendentes: ${error.message}` };
    }

    return {
        total: data.length,
        jobs: data.map((job) => ({
            job_id: job.id,
            status: job.status,
            erro: job.error_message,
            progresso: job.progress_percent,
            arquivo: job.audio_files?.filename || null,
            aula: job.audio_files?.lessons?.title || null,
            modulo: job.audio_files?.lessons?.modules?.name || null,
            curso: job.audio_files?.lessons?.modules?.courses?.name || null,
        })),
    };
}

async function reprocessarTranscricao(jobId) {
    if (!supabaseAdmin) {
        return { sucesso: false, erro: "Conexão com o banco de dados não configurada no servidor." };
    }

    const { data: job, error: fetchError } = await supabaseAdmin
        .from("transcription_jobs")
        .select("id, audio_file_id")
        .eq("id", jobId)
        .maybeSingle();

    if (fetchError || !job) {
        return { sucesso: false, erro: `Job ${jobId} não encontrado.` };
    }

    // Mesma convenção já usada pelo botão "Tentar novamente" do dashboard
    // (pages/index.js, função tentarNovamente): marca manual_requested para
    // o Transcritor Local pegar esse job com prioridade, sem mexer em
    // worker_id/cancel_requested/completed_at, que o worker já gerencia sozinho.
    const { error: jobError } = await supabaseAdmin
        .from("transcription_jobs")
        .update({
            status: "pending",
            manual_requested: true,
            error_message: null,
            progress_percent: 0,
            started_at: null,
        })
        .eq("id", jobId);

    if (jobError) {
        return { sucesso: false, erro: `Erro ao resetar o job: ${jobError.message}` };
    }

    return { sucesso: true };
}

async function executeReadOnlyTool(name) {
    if (name === "listar_transcricoes_pendentes") {
        return listarTranscricoesPendentes();
    }
    return { erro: `Ferramenta desconhecida: ${name}` };
}

async function callOpenRouter(messages, tools) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            max_tokens: 800,
            messages,
            ...(tools ? { tools, tool_choice: "auto" } : {}),
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter respondeu ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message || { content: "" };
}

function buildSystemPrompt(context) {
    const baseRule = context
        ? `Você é um assistente que responde perguntas usando APENAS o conteúdo da base de conhecimento fornecida abaixo. Se a resposta não estiver no conteúdo, diga claramente que não encontrou isso na base — nunca invente informação. ${SOURCE_TYPE_RULE}`
        : "Você é um assistente de uma base de conhecimento pessoal, mas nenhum arquivo relevante foi encontrado para essa pergunta. Diga isso claramente ao usuário em vez de inventar uma resposta.";

    return `${baseRule} ${AGENT_TOOLS_RULE} ${VOICE_STYLE_RULE}${context ? `\n\n${context}` : ""}`;
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const { question, confirmAction } = req.body || {};

    if (!OPENROUTER_API_KEY) {
        res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
        return;
    }

    // Segunda etapa do fluxo: o usuário já confirmou uma ação sensível
    // (ex: "sim, reprocessa") — executa de verdade, sem passar pelo modelo de novo.
    if (confirmAction && confirmAction.tool === "reprocessar_transcricao") {
        try {
            const resultado = await reprocessarTranscricao(confirmAction.args.job_id);
            const answer = resultado.sucesso
                ? `Pronto. A transcrição de "${confirmAction.args.descricao}" foi marcada para ser reprocessada. O Transcritor Local deve pegar ela na próxima verificação.`
                : `Não consegui reprocessar: ${resultado.erro}`;
            res.status(200).json({ answer, sources: [] });
        } catch (error) {
            res.status(500).json({ error: error.message || "Erro ao executar a ação confirmada." });
        }
        return;
    }

    if (!question || typeof question !== "string" || !question.trim()) {
        res.status(400).json({ error: "Pergunta vazia" });
        return;
    }

    if (VAULT_DIRS.length === 0) {
        res.status(500).json({ error: "ASSISTANT_VAULT_DIRS (ou ASSISTANT_VAULT_DIR) não configurado no servidor." });
        return;
    }

    try {
        const index = buildIndex();
        const relevantFiles = pickRelevantFiles(index, question);
        const context = buildContext(relevantFiles);
        const systemPrompt = buildSystemPrompt(context);

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
        ];

        const firstMessage = await callOpenRouter(messages, TOOLS);
        const toolCall = firstMessage.tool_calls?.[0];

        if (!toolCall) {
            res.status(200).json({
                answer: firstMessage.content || "",
                sources: relevantFiles.map((f) => ({ title: f.title, curso: f.curso, modulo: f.modulo, vault: f.vault })),
            });
            return;
        }

        const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

        // Ação sensível: NÃO executa ainda, só devolve um pedido de confirmação.
        if (toolCall.function.name === "reprocessar_transcricao") {
            res.status(200).json({
                answer: `Achei a transcrição de "${toolArgs.descricao}". Quer mesmo que eu reprocesse ela do zero? Diga sim para confirmar.`,
                sources: [],
                pendingAction: { tool: "reprocessar_transcricao", args: toolArgs },
            });
            return;
        }

        // Ferramentas somente-leitura: executa, devolve o resultado pro modelo, e pega a resposta final.
        const toolResult = await executeReadOnlyTool(toolCall.function.name);
        messages.push(firstMessage);
        messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
        });

        const finalMessage = await callOpenRouter(messages, TOOLS);
        res.status(200).json({ answer: finalMessage.content || "", sources: [] });
    } catch (error) {
        res.status(500).json({ error: error.message || "Erro desconhecido ao consultar o assistente." });
    }
}
