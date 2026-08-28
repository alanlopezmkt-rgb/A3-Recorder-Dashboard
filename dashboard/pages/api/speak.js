const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Método não permitido" });
        return;
    }

    const { text } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "Texto vazio" });
        return;
    }

    if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
        res.status(500).json({ error: "ELEVENLABS_API_KEY ou ELEVENLABS_VOICE_ID não configurados no servidor." });
        return;
    }

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "xi-api-key": ELEVENLABS_API_KEY,
                    Accept: "audio/mpeg",
                },
                body: JSON.stringify({
                    text,
                    model_id: ELEVENLABS_MODEL,
                    voice_settings: {
                        stability: 0.4,
                        similarity_boost: 0.75,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElevenLabs respondeu ${response.status}: ${errorText}`);
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        res.setHeader("Content-Type", "audio/mpeg");
        res.status(200).send(audioBuffer);
    } catch (error) {
        res.status(500).json({ error: error.message || "Erro desconhecido ao gerar áudio." });
    }
}
