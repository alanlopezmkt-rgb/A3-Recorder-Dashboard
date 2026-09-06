const fs = require("fs");
const path = require("path");

// Mesmos valores usados por delete-vault-file.js — mantidos aqui como cópia
// pequena e sem dependências, em vez de importar entre repositórios separados.
const KNOWLEDGE_TOOLS_BASE_DIR = process.env.KNOWLEDGE_TOOLS_BASE_DIR || "G:\\Meu Drive\\A3-Knowledge";

const VAULTS = [
    { pessoa: "Zoio", folder: "Zoio-Knowledge" },
    { pessoa: "Bigode", folder: "Bigode-Knowledge" },
    { pessoa: "Dodo", folder: "Dodo-Knowledge" },
];

// Parser mínimo de frontmatter — só precisa dos campos usados aqui, não do
// YAML completo (evita puxar uma dependência de parsing só pra isso).
function parseFrontmatterFields(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        const fieldMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (!fieldMatch) continue;
        const [, key, value] = fieldMatch;
        fields[key] = value.trim().replace(/^"(.*)"$/, "$1");
    }
    return fields;
}

function listMarkdownFilesRecursive(dir) {
    let results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(listMarkdownFilesRecursive(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            results.push(fullPath);
        }
    }
    return results;
}

export default function handler(req, res) {
    if (req.method !== "GET") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const pendentes = [];

    for (const vault of VAULTS) {
        const cursosDir = path.join(KNOWLEDGE_TOOLS_BASE_DIR, vault.folder, "01_Cursos");
        const arquivos = listMarkdownFilesRecursive(cursosDir);

        for (const filePath of arquivos) {
            let raw;
            try {
                raw = fs.readFileSync(filePath, "utf8");
            } catch {
                continue;
            }

            const fields = parseFrontmatterFields(raw);
            if (fields.status !== "raw") continue;

            pendentes.push({
                pessoa: vault.pessoa,
                vault: vault.folder,
                titulo: fields.title || path.basename(filePath, ".md"),
                curso: fields.curso || "",
                modulo: fields.modulo || "",
                aula: fields.aula || "",
                path: filePath,
                relativePath: path.relative(path.join(KNOWLEDGE_TOOLS_BASE_DIR, vault.folder), filePath),
            });
        }
    }

    res.status(200).json({ pendentes });
}
