import { useEffect, useRef, useState } from "react";

function getSpeechRecognition() {
    if (typeof window === "undefined") return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function Assistente() {
    const [suportado, setSuportado] = useState(true);
    const [ouvindo, setOuvindo] = useState(false);
    const [pergunta, setPergunta] = useState("");
    const [resposta, setResposta] = useState("");
    const [fontes, setFontes] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState("");
    const [acaoPendente, setAcaoPendente] = useState(null);
    const recognitionRef = useRef(null);
    const acaoPendenteRef = useRef(null);

    useEffect(() => {
        acaoPendenteRef.current = acaoPendente;
    }, [acaoPendente]);

    useEffect(() => {
        const SpeechRecognition = getSpeechRecognition();
        if (!SpeechRecognition || !window.speechSynthesis) {
            setSuportado(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "pt-BR";
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event) => {
            const texto = event.results[0][0].transcript;
            setPergunta(texto);
            if (acaoPendenteRef.current) {
                responderConfirmacao(texto);
            } else {
                perguntar(texto);
            }
        };

        recognition.onerror = (event) => {
            setOuvindo(false);
            if (event.error === "not-allowed") {
                setErro("Permissão de microfone negada. Habilite o microfone para esse app.");
            } else {
                setErro(`Erro ao ouvir: ${event.error}`);
            }
        };

        recognition.onend = () => setOuvindo(false);

        recognitionRef.current = recognition;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function iniciarEscuta() {
        if (!recognitionRef.current) return;
        setErro("");
        setResposta("");
        setFontes([]);
        setOuvindo(true);
        recognitionRef.current.start();
    }

    async function perguntar(texto) {
        setCarregando(true);
        setErro("");
        try {
            const response = await fetch("/api/assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: texto }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Erro ao consultar o assistente.");
            }

            setResposta(data.answer);
            setFontes(data.sources || []);
            setAcaoPendente(data.pendingAction || null);
            falar(data.answer);
        } catch (error) {
            setErro(error.message);
        } finally {
            setCarregando(false);
        }
    }

    function ehConfirmacaoPositiva(texto) {
        const t = texto.toLowerCase();
        return /\b(sim|confirmo|confirma|pode|isso mesmo|correto|manda|manda ver|vai)\b/.test(t);
    }

    async function responderConfirmacao(texto) {
        const acao = acaoPendenteRef.current;
        setAcaoPendente(null);

        if (!ehConfirmacaoPositiva(texto)) {
            const resposta = "Ok, cancelei essa ação.";
            setResposta(resposta);
            falar(resposta);
            return;
        }

        setCarregando(true);
        setErro("");
        try {
            const response = await fetch("/api/assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmAction: acao }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Erro ao executar a ação.");
            }

            setResposta(data.answer);
            setFontes(data.sources || []);
            falar(data.answer);
        } catch (error) {
            setErro(error.message);
        } finally {
            setCarregando(false);
        }
    }

    async function falar(texto) {
        if (!texto) return;
        try {
            const response = await fetch("/api/speak", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: texto }),
            });

            if (!response.ok) {
                throw new Error("Falha ao gerar áudio da resposta.");
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.onended = () => URL.revokeObjectURL(audioUrl);
            audio.play();
        } catch (error) {
            // Se a voz falhar, a resposta em texto já está na tela — não bloqueia o uso.
            setErro((prev) => prev || `Voz indisponível: ${error.message}`);
        }
    }

    if (!suportado) {
        return (
            <div className="card">
                <div className="section-title">Assistente de voz</div>
                <p>
                    Seu navegador/app não suporta reconhecimento e síntese de voz
                    (Web Speech API). Abra o painel no Chrome ou no A3-OS Dashboard
                    desktop para usar o assistente.
                </p>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="section-title">Assistente de voz — Zoio-Knowledge</div>
            <p className="subtitle" style={{ marginTop: 0 }}>
                Pergunte sobre o conteúdo já transcrito na sua base pessoal. O
                assistente responde só com base no que já está na sua vault.
            </p>

            <button
                className={`icon-btn assistant-mic-btn ${ouvindo ? "assistant-mic-active" : ""}`}
                onClick={iniciarEscuta}
                disabled={ouvindo || carregando}
                title="Falar pergunta"
            >
                {ouvindo
                    ? "🎙️ Ouvindo..."
                    : carregando
                    ? "Pensando..."
                    : acaoPendente
                    ? "🎤 Confirmar (diga sim ou não)"
                    : "🎤 Perguntar"}
            </button>

            {acaoPendente && (
                <p className="subtitle" style={{ marginTop: 8 }}>
                    Aguardando sua confirmação em voz para executar a ação.
                </p>
            )}

            {pergunta && (
                <div style={{ marginTop: 16 }}>
                    <strong>Você perguntou:</strong>
                    <p>{pergunta}</p>
                </div>
            )}

            {erro && (
                <div className="error-text" style={{ marginTop: 12 }}>
                    {erro}
                </div>
            )}

            {resposta && (
                <div style={{ marginTop: 16 }}>
                    <strong>Resposta:</strong>
                    <p style={{ whiteSpace: "pre-wrap" }}>{resposta}</p>
                </div>
            )}

            {fontes.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <strong>Fontes consultadas:</strong>
                    <ul>
                        {fontes.map((fonte, i) => (
                            <li key={i}>
                                {fonte.title} — {fonte.curso} / {fonte.modulo} ({fonte.vault})
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
