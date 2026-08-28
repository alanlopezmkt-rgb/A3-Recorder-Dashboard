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
    const recognitionRef = useRef(null);

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
            perguntar(texto);
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
            falar(data.answer);
        } catch (error) {
            setErro(error.message);
        } finally {
            setCarregando(false);
        }
    }

    function falar(texto) {
        if (!window.speechSynthesis || !texto) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = "pt-BR";
        window.speechSynthesis.speak(utterance);
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
            <div className="section-title">Assistente de voz — Alan-Knowledge</div>
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
                {ouvindo ? "🎙️ Ouvindo..." : carregando ? "Pensando..." : "🎤 Perguntar"}
            </button>

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
                                {fonte.title} — {fonte.curso} / {fonte.modulo}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
