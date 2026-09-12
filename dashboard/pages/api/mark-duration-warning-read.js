const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Mesmos valores usados por delete-vault-file.js e pending-summaries.js —
// mantidos aqui como cópia pequena e sem dependências, em vez de importar
// entre repositórios separados.
const KNOWLEDGE_TOOLS_DIR = process.env.KNOWLEDGE_TOOLS_DIR || "C:\\Users\\alanl\\Documents\\Trabalho\\knowledge-tools";
const KNOWLEDGE_TOOLS_BASE_DIR = process.env.KNOWLEDGE_TOOLS_BASE_DIR || "G:\\Meu Drive\\A3-Knowledge";

const VAULT_FOLDERS = ["Zoio-Knowledge", "Bigode-Knowledge", "Dodo-Knowledge"];

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const { filePath } = req.body || {};
    if (!filePath) {
        res.status(400).json({ error: "filePath é obrigatório." });
        return;
    }

    // Path traversal: só aceita arquivo dentro de uma das vaults conhecidas.
    const resolved = path.resolve(filePath);
    const vaultFolder = VAULT_FOLDERS.find((folder) =>
        resolved.startsWith(path.resolve(path.join(KNOWLEDGE_TOOLS_BASE_DIR, folder)) + path.sep)
    );
    if (!vaultFolder) {
        res.status(400).json({ error: "Caminho fora das vaults conhecidas." });
        return;
    }

    if (!fs.existsSync(resolved)) {
        res.status(404).json({ error: "Arquivo não encontrado." });
        return;
    }

    let raw;
    try {
        raw = fs.readFileSync(resolved, "utf8");
    } catch (error) {
        res.status(500).json({ error: `Erro ao ler o arquivo: ${error.message}` });
        return;
    }

    // Marcar como lido = tirar do status "incompleta"/"longa" (o que faz o
    // aviso sumir do dashboard) sem mexer em duracao_real_segundos /
    // duracao_esperada_segundos / duracao_tipo, que ficam guardados como
    // registro histórico do que aconteceu.
    const atualizado = raw.replace(/^status:\s*"(incompleta|longa)"/m, 'status: "raw"');
    if (atualizado === raw) {
        res.status(200).json({ updated: false, message: "Arquivo já não estava marcado como incompleta/longa." });
        return;
    }

    try {
        fs.writeFileSync(resolved, atualizado, "utf8");
    } catch (error) {
        res.status(500).json({ error: `Erro ao gravar o arquivo: ${error.message}` });
        return;
    }

    const syncScript = path.join(KNOWLEDGE_TOOLS_DIR, "bin", "knowledge-sync.js");
    const commitMsg = `Aviso de duração marcado como lido via dashboard: ${path.basename(resolved)}`;

    try {
        await execFileAsync("node", [syncScript, vaultFolder, "--message", commitMsg], { timeout: 30000 });
        res.status(200).json({ updated: true, synced: true });
    } catch (error) {
        res.status(200).json({
            updated: true,
            synced: false,
            warning: `Marcado como lido, mas houve erro ao sincronizar com o git: ${error.stderr || error.message}`,
        });
    }
}
