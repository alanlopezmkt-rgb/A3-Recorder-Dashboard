const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// A tabela profiles só permite UPDATE do próprio usuário (RLS: id = auth.uid()),
// então o admin não consegue mudar o toggle de transcrição automática de outra
// pessoa direto pelo cliente do navegador (a escrita é silenciosamente
// ignorada pelo RLS, sem erro). Por isso essa rota roda no servidor com a
// service role key, que bypassa RLS — mesmo padrão de delete-vault-file.js.
const supabaseAdmin =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    if (!supabaseAdmin) {
        res.status(500).json({ error: "Conexão com o banco não configurada no servidor (SUPABASE_SERVICE_ROLE_KEY ausente)." });
        return;
    }

    const { profileId, autoTranscribe } = req.body || {};
    if (!profileId || typeof autoTranscribe !== "boolean") {
        res.status(400).json({ error: "Dados insuficientes: profileId e autoTranscribe (boolean) são obrigatórios." });
        return;
    }

    const { error } = await supabaseAdmin
        .from("profiles")
        .update({ auto_transcribe: autoTranscribe })
        .eq("id", profileId);

    if (error) {
        res.status(500).json({ error: `Erro ao atualizar o perfil: ${error.message}` });
        return;
    }

    res.status(200).json({ ok: true });
}
