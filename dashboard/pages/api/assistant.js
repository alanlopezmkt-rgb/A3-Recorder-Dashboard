const fs = require("fs");
const path = require("path");

const VAULT_DIR = process.env.ASSISTANT_VAULT_DIR || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5";
const MAX_CONTEXT_CHARS = 12000;
const MAX_FILES_IN_CONTEXT = 6;

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
    return listMarkdownFiles(VAULT_DIR).map((filePath) => {
        const raw = fs.readFileSync(filePath, "utf8");
        const { frontmatter, body } = parseFrontmatter(raw);
        return {
            filePath,
            title: frontmatter.title || path.basename(filePath),
            curso: frontmatter.curso || "",
            modulo: frontmatter.modulo || "",
            body,
        };
    });
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
        const chunk = `## ${file.title} (${file.curso} / ${file.modulo})\n${file.body.trim()}\n\n`;
        if (context.length + chunk.length > MAX_CONTEXT_CHARS) break;
        context += chunk;
    }
    return context;
}

async function askOpenRouter(question, context) {
    const systemPrompt = context
        ? `Você é um assistente que responde perguntas usando APENAS o conteúdo da base de conhecimento fornecida abaixo. Se a resposta não estiver no conteúdo, diga claramente que não encontrou isso na base — nunca invente informação.\n\n${context}`
        : "Você é um assistente de uma base de conhecimento pessoal, mas nenhum arquivo relevante foi encontrado para essa pergunta. Diga isso claramente ao usuário em vez de inventar uma resposta.";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            max_tokens: 800,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: question },
            ],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter respondeu ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const { question } = req.body || {};
    if (!question || typeof question !== "string" || !question.trim()) {
        res.status(400).json({ error: "Pergunta vazia" });
        return;
    }

    if (!OPENROUTER_API_KEY) {
        res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
        return;
    }

    if (!VAULT_DIR) {
        res.status(500).json({ error: "ASSISTANT_VAULT_DIR não configurado no servidor." });
        return;
    }

    try {
        const index = buildIndex();
        const relevantFiles = pickRelevantFiles(index, question);
        const context = buildContext(relevantFiles);

        const answer = await askOpenRouter(question, context);

        res.status(200).json({
            answer,
            sources: relevantFiles.map((f) => ({ title: f.title, curso: f.curso, modulo: f.modulo })),
        });
    } catch (error) {
        res.status(500).json({ error: error.message || "Erro desconhecido ao consultar o assistente." });
    }
}
