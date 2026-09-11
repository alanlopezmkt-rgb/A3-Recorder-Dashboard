import { useEffect, useRef, useState } from "react";

function getSpeechRecognition() {
    if (typeof window === "undefined") return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

const ORB_PARTICLES = 220;
const ORB_RADIUS = 92;

function criarParticulas() {
    const pontos = [];
    for (let i = 0; i < ORB_PARTICLES; i++) {
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = Math.random() * Math.PI * 2;
        const r = ORB_RADIUS * (0.55 + Math.random() * 0.45);
        pontos.push({
            x: r * Math.sin(theta) * Math.cos(phi),
            y: r * Math.sin(theta) * Math.sin(phi),
            z: r * Math.cos(theta),
            twinkleSeed: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.6 + Math.random() * 1.4,
            baseSize: 0.6 + Math.random() * 1.6,
        });
    }
    return pontos;
}

const ESTADO_LABEL = {
    idle: "PRONTO",
    ouvindo: "OUVINDO",
    pensando: "PENSANDO",
    falando: "FALANDO",
};

export default function Assistente() {
    const [suportado, setSuportado] = useState(true);
    const [ouvindo, setOuvindo] = useState(false);
    const [falandoAudio, setFalandoAudio] = useState(false);
    const [pergunta, setPergunta] = useState("");
    const [resposta, setResposta] = useState("");
    const [fontes, setFontes] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState("");
    const [acaoPendente, setAcaoPendente] = useState(null);
    const recognitionRef = useRef(null);
    const acaoPendenteRef = useRef(null);
    const canvasRef = useRef(null);
    const particulasRef = useRef(criarParticulas());
    const estadoRef = useRef("idle");
    const rafRef = useRef(null);

    const estado = ouvindo ? "ouvindo" : carregando ? "pensando" : falandoAudio ? "falando" : "idle";
    estadoRef.current = estado;

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

    // Animação da esfera de partículas (canvas 2D, roda continuamente)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const size = 260;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.scale(dpr, dpr);

        const cx = size / 2;
        const cy = size / 2;
        let angulo = 0;
        let t = 0;

        function desenhar() {
            const estadoAtual = estadoRef.current;
            const intensidade =
                estadoAtual === "falando" ? 1 : estadoAtual === "ouvindo" ? 0.78 : estadoAtual === "pensando" ? 0.55 : 0.32;
            const velocidade =
                estadoAtual === "falando" ? 0.016 : estadoAtual === "ouvindo" ? 0.01 : estadoAtual === "pensando" ? 0.006 : 0.003;

            angulo += velocidade;
            t += 0.03;

            ctx.clearRect(0, 0, size, size);

            // brilho central
            const nucleoRaio = 30 + intensidade * 14 + Math.sin(t * 2) * 2 * intensidade;
            const nucleo = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleoRaio);
            nucleo.addColorStop(0, `rgba(228, 228, 231, ${0.55 * intensidade + 0.12})`);
            nucleo.addColorStop(0.5, `rgba(161, 161, 170, ${0.28 * intensidade + 0.05})`);
            nucleo.addColorStop(1, "rgba(161, 161, 170, 0)");
            ctx.fillStyle = nucleo;
            ctx.fillRect(0, 0, size, size);

            const pontos = particulasRef.current
                .map((p) => {
                    const cosA = Math.cos(angulo);
                    const sinA = Math.sin(angulo);
                    const x = p.x * cosA - p.z * sinA;
                    const z = p.x * sinA + p.z * cosA;
                    const y = p.y;
                    const escala = 220 / (220 - z);
                    const twinkle = 0.5 + 0.5 * Math.sin(t * p.twinkleSpeed + p.twinkleSeed);
                    return {
                        sx: cx + x * escala,
                        sy: cy + y * escala,
                        z,
                        escala,
                        size: p.baseSize * escala,
                        opacidade: (0.25 + twinkle * 0.75) * (0.35 + intensidade * 0.65),
                    };
                })
                .sort((a, b) => a.z - b.z);

            pontos.forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, Math.max(0.4, p.size), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(212, 212, 216, ${Math.min(1, p.opacidade)})`;
                ctx.fill();
            });

            rafRef.current = requestAnimationFrame(desenhar);
        }

        rafRef.current = requestAnimationFrame(desenhar);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
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
            setFalandoAudio(true);
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                setFalandoAudio(false);
            };
            audio.onerror = () => setFalandoAudio(false);
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

    const podeFalar = !ouvindo && !carregando;
    const rotuloBotao = acaoPendente ? "Confirmar (diga sim ou não)" : "Perguntar";

    return (
        <div className="card assistant-card">
            <div className="assistant-stage">
                <div className={`assistant-state-label assistant-state-${estado}`}>
                    {ESTADO_LABEL[estado]}
                </div>
                <div className="assistant-wave" aria-hidden="true">
                    {Array.from({ length: 28 }).map((_, i) => (
                        <span
                            key={i}
                            className={`assistant-wave-bar ${estado !== "idle" ? "assistant-wave-bar-active" : ""}`}
                            style={{ animationDelay: `${(i % 14) * 0.07}s` }}
                        />
                    ))}
                </div>

                <div className={`assistant-orb assistant-orb-${estado}`}>
                    <canvas ref={canvasRef} className="assistant-orb-canvas" />
                </div>

                {acaoPendente && (
                    <p className="subtitle assistant-pending-hint">
                        Aguardando sua confirmação em voz para executar a ação.
                    </p>
                )}

                <button
                    className={`assistant-mic-btn ${!podeFalar ? "assistant-mic-btn-disabled" : ""} ${
                        estado !== "idle" ? "assistant-mic-btn-active" : ""
                    }`}
                    onClick={iniciarEscuta}
                    disabled={!podeFalar}
                    title={rotuloBotao}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                </button>
                <div className="assistant-mic-caption">{rotuloBotao}</div>
            </div>

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
