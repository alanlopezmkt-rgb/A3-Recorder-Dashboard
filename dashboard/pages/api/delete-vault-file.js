const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Mesmos valores usados pelo Transcritor Local (Transcritor Local/.env) e
// pelo knowledge-tools — mantidos aqui como uma cópia pequena e sem
// dependências, em vez de importar entre repositórios separados.
const KNOWLEDGE_TOOLS_DIR = process.env.KNOWLEDGE_TOOLS_DIR || "C:\\Users\\alanl\\Documents\\Trabalho\\knowledge-tools";
const KNOWLEDGE_TOOLS_BASE_DIR = process.env.KNOWLEDGE_TOOLS_BASE_DIR || "G:\\Meu Drive\\A3-Knowledge";

const PERSON_TO_VAULT = {
    zoio: "Zoio-Knowledge",
    bigode: "Bigode-Knowledge",
    dodo: "Dodo-Knowledge",
};

// Mesmo algoritmo de knowledge-tools/lib/fsutil.js — precisa gerar
// exatamente o mesmo nome de arquivo usado na ingestão.
function slugify(text) {
    return (
        String(text)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "sem-titulo"
    );
}

// Mesma normalização de supabase_worker.py (buscar_perfil): remove sufixos
// entre parênteses (ex: "Alan (Admin)" -> "alan") antes de comparar.
function normalizePessoa(nomeBruto) {
    return String(nomeBruto || "")
        .replace(/\s*\(.*?\)\s*/g, " ")
        .trim()
        .toLowerCase();
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const { pessoa, curso, modulo, aula, titulo } = req.body || {};
    if (!pessoa || !curso || !modulo || aula === undefined || aula === null) {
        res.status(400).json({ error: "Dados insuficientes para localizar o arquivo na vault." });
        return;
    }

    const pessoaKey = normalizePessoa(pessoa);
    const vaultFolder = PERSON_TO_VAULT[pessoaKey];
    if (!vaultFolder) {
        res.status(400).json({ error: `Pessoa desconhecida: "${pessoa}". Não sei em qual vault procurar.` });
        return;
    }

    const vaultDir = path.join(KNOWLEDGE_TOOLS_BASE_DIR, vaultFolder);
    const cursoSlug = slugify(curso);
    const moduloSlug = slugify(modulo);
    const aulaSlug = slugify(titulo || `aula-${aula}`);
    const filePath = path.join(
        vaultDir,
        "01_Cursos",
        cursoSlug,
        moduloSlug,
        `aula-${String(aula).padStart(2, "0")}-${aulaSlug}.md`
    );

    if (!fs.existsSync(filePath)) {
        res.status(200).json({
            deleted: false,
            message: `Arquivo não encontrado na vault (pode já ter sido removido antes): ${filePath}`,
        });
        return;
    }

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        res.status(500).json({ error: `Erro ao apagar o arquivo: ${error.message}` });
        return;
    }

    const syncScript = path.join(KNOWLEDGE_TOOLS_DIR, "bin", "knowledge-sync.js");
    const commitMsg = `Exclusão via dashboard: ${curso} / ${titulo || `aula ${aula}`}`;

    try {
        await execFileAsync("node", [syncScript, vaultFolder, "--message", commitMsg], { timeout: 30000 });
        res.status(200).json({ deleted: true, synced: true, filePath });
    } catch (error) {
        // O arquivo já foi apagado localmente; só a sincronização git falhou
        // (ex: conflito, sem internet). Não é motivo para reportar como erro fatal.
        res.status(200).json({
            deleted: true,
            synced: false,
            warning: `Arquivo apagado, mas houve erro ao sincronizar com o git: ${error.stderr || error.message}`,
            filePath,
        });
    }
}
