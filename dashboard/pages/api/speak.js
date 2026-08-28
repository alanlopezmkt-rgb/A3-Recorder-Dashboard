const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

// "edge" (gratis, TTS neural da Microsoft) ou "elevenlabs" (voz mais expressiva,
// mas vozes da Voice Library exigem plano pago para uso via API).
const TTS_PROVIDER = (process.env.TTS_PROVIDER || "edge").toLowerCase();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE || "pt-BR-AntonioNeural";

async function speakWithElevenLabs(text) {
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
        throw new Error("ELEVENLABS_API_KEY ou ELEVENLABS_VOICE_ID não configurados no servidor.");
    }

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
                    stability: 0.3,
                    similarity_boost: 0.8,
                    style: 0.45,
                    use_speaker_boost: true,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs respondeu ${response.status}: ${errorText}`);
    }

    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: "audio/mpeg" };
}

async function speakWithEdgeTts(text) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(EDGE_TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);

    const chunks = [];
    for await (const chunk of audioStream) {
        chunks.push(chunk);
    }
    tts.close();

    return { buffer: Buffer.concat(chunks), contentType: "audio/mpeg" };
}

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

    try {
        const { buffer, contentType } =
            TTS_PROVIDER === "elevenlabs" ? await speakWithElevenLabs(text) : await speakWithEdgeTts(text);

        res.setHeader("Content-Type", contentType);
        res.status(200).send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message || "Erro desconhecido ao gerar áudio." });
    }
}
