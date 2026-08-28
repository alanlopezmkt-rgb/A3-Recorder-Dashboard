import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, ADMIN_EMAIL, REMEMBER_ME_KEY } from "../lib/supabaseClient";
import Assistente from "../components/Assistente";

export default function Home() {
    const [session, setSession] = useState(undefined);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session || null);
        });

        const { data: listener } = supabase.auth.onAuthStateChange(
            (_event, newSession) => {
                setSession(newSession);
            }
        );

        return () => listener.subscription.unsubscribe();
    }, []);

    if (session === undefined) {
        return null;
    }

    if (!session || session.user.email !== ADMIN_EMAIL) {
        return <Login isWrongUser={!!session} />;
    }

    return <Dashboard />;
}

function Login({ isWrongUser }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [lembrar, setLembrar] = useState(true);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function entrar(event) {
        event.preventDefault();
        setError("");
        setLoading(true);

        if (isWrongUser) {
            await supabase.auth.signOut();
        }

        // Precisa ser gravado antes do signIn: o cliente do Supabase le essa
        // preferencia no momento em que grava a sessao (ver authStorage em
        // lib/supabaseClient.js) para decidir entre localStorage e sessionStorage.
        window.localStorage.setItem(REMEMBER_ME_KEY, lembrar ? "true" : "false");

        const { error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        setLoading(false);

        if (authError) {
            setError(authError.message);
        }
    }

    return (
        <div className="login-wrap">
            <form className="card login-card" onSubmit={entrar}>
                <img className="login-badge" src="/icon-a3.png" alt="A3-OS" />
                <h1>A3-OS Painel</h1>
                <div className="subtitle">
                    {isWrongUser
                        ? "Essa conta não tem acesso ao painel. Entre com a conta de administrador."
                        : "Acesso restrito ao administrador"}
                </div>

                {error && <div className="error-text">{error}</div>}

                <input
                    type="email"
                    placeholder="E-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />

                <input
                    type="password"
                    placeholder="Senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />

                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        color: "var(--text-dim)",
                        margin: "4px 0 8px",
                        cursor: "pointer"
                    }}
                >
                    <input
                        type="checkbox"
                        checked={lembrar}
                        onChange={(e) => setLembrar(e.target.checked)}
                        style={{ margin: 0 }}
                    />
                    Lembrar-me
                </label>

                <button className="btn-primary" type="submit" disabled={loading}>
                    {loading ? "Entrando..." : "Entrar"}
                </button>
            </form>
        </div>
    );
}

const STATUS_LABEL = {
    pending: "Pendente",
    processing: "Processando",
    completed: "Concluída",
    failed: "Falhou",
    uploaded: "Enviado"
};

const WORKER_OFFLINE_AFTER_SECONDS = 40;
const USER_OFFLINE_AFTER_SECONDS = 90;

function IconGrid() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
        </svg>
    );
}

function IconGear() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
        </svg>
    );
}

function IconMic() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    );
}

function IconLogout() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
        </svg>
    );
}

function IconChevron({ collapsed }) {
    return (
        <svg
            className="sidebar-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        >
            <path d="M15 6l-6 6 6 6" />
        </svg>
    );
}

function IconSearch() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
        </svg>
    );
}

function IconRefresh() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 4v6h-6" />
        </svg>
    );
}

function IconEye() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function IconAudio() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
        </svg>
    );
}

function IconFolder() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <path d="M3.5 6.2c0-.9.7-1.6 1.6-1.6h4.3c.5 0 1 .2 1.3.6l1 1.1h6.8c.9 0 1.6.7 1.6 1.6v9.3c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6V6.2z" />
        </svg>
    );
}

function IconUsers() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}

function IconCheckCircle() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4L12 14.01l-3-3" />
        </svg>
    );
}

function IconClock() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 7v5l3.2 2" />
        </svg>
    );
}

function IconGraduation() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M22 10L12 5 2 10l10 5 10-5z" />
            <path d="M6 12.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" />
        </svg>
    );
}

function IconDatabase() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
            <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
    );
}

function IconServer() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <rect x="2" y="3" width="20" height="7" rx="1.6" />
            <rect x="2" y="14" width="20" height="7" rx="1.6" />
            <path d="M6 6.5h.01M6 17.5h.01" />
        </svg>
    );
}

function IconPuzzle() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M4 7h3.5a1.5 1.5 0 1 1 0 3H4v3.5a1.5 1.5 0 1 0 3 0V13h3.5a1.5 1.5 0 1 1 0 3H7v3.5a1.5 1.5 0 1 0 3 0V19h3.5a1.5 1.5 0 1 1 0-3H13v-3.5a1.5 1.5 0 1 0-3 0V13H6.5" />
        </svg>
    );
}

function IconTrendingUp() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 7l-8.5 8.5-5-5L2 17" />
            <path d="M16 7h6v6" />
        </svg>
    );
}

function IconBell() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    );
}

function IconDownload() {
    return (
        <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M4 19h16" />
        </svg>
    );
}

function IconPlay() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="14" height="14">
            <path d="M6 4.5v15l13-7.5-13-7.5z" />
        </svg>
    );
}

function IconPause() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="14" height="14">
            <path d="M6 4.5h4v15H6v-15zM14 4.5h4v15h-4v-15z" />
        </svg>
    );
}

function IconInfo() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 11v5.5" />
            <path d="M12 7.6h.01" />
        </svg>
    );
}

function IconTrash() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
            <path d="M3 6h18" />
            <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
            <path d="M19 6l-.9 13.2A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.8L5 6" />
            <path d="M10 11v6M14 11v6" />
        </svg>
    );
}

function Dashboard() {
    const [rows, setRows] = useState([]);
    const [autoTranscribe, setAutoTranscribe] = useState(true);
    const [loading, setLoading] = useState(true);
    const [busyIds, setBusyIds] = useState({});
    const [worker, setWorker] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [theme, setTheme] = useState("dark");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [statusFilter, setStatusFilter] = useState("all");
    const [view, setView] = useState("files");
    const [usuarios, setUsuarios] = useState([]);
    const [progressoPorPessoa, setProgressoPorPessoa] = useState({});
    const [progresso, setProgresso] = useState({
        totalLessons: 0,
        completedLessons: 0,
        totalModules: 0,
        completedModules: 0
    });
    const [modulosProgresso, setModulosProgresso] = useState([]);
    const [searchText, setSearchText] = useState("");
    const [deletePasswordHash, setDeletePasswordHash] = useState(null);
    const [newPasswordInput, setNewPasswordInput] = useState("");
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordSavedMsg, setPasswordSavedMsg] = useState("");
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deletePasswordInput, setDeletePasswordInput] = useState("");
    const [deleteError, setDeleteError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [detailsTarget, setDetailsTarget] = useState(null);
    const [playingAudio, setPlayingAudio] = useState(null);
    const [installCode, setInstallCode] = useState(null);
    const [gerandoCodigo, setGerandoCodigo] = useState(false);
    const [codigoCopiado, setCodigoCopiado] = useState(false);
    const [downloadMsg, setDownloadMsg] = useState(null);
    const [notifPrefs, setNotifPrefs] = useState({
        amigosOnline: true,
        audioPendente: true,
        transcricaoSucesso: true,
        transcricaoFalha: true
    });

    const prevOnlineIdsRef = useRef(null);
    const prevAudioIdsRef = useRef(null);
    const prevJobStatusRef = useRef(null);
    const notifPrefsRef = useRef(notifPrefs);
    notifPrefsRef.current = notifPrefs;

    async function carregar() {
        const { data: settings } = await supabase
            .from("app_settings")
            .select("auto_transcribe, delete_password_hash")
            .eq("id", true)
            .single();

        if (settings) {
            setAutoTranscribe(settings.auto_transcribe);
            setDeletePasswordHash(settings.delete_password_hash || null);
        }

        const { data: workerStatus } = await supabase
            .from("worker_status")
            .select("worker_id, gpu_name, worker_version, status, current_job_id, last_seen")
            .order("last_seen", { ascending: false })
            .limit(1)
            .maybeSingle();

        setWorker(workerStatus || null);

        const { data: profiles } = await supabase
            .from("profiles")
            .select("id, display_name, last_seen")
            .order("display_name", { ascending: true });

        const { data: userData } = await supabase.auth.getUser();
        const adminId = userData?.user?.id;

        setUsuarios((profiles || []).filter((usuario) => usuario.id !== adminId));

        const { data: aulasPorPessoa } = await supabase
            .from("audio_files")
            .select("uploaded_by, status")
            .not("uploaded_by", "is", null);

        const { count: totalAulas } = await supabase
            .from("lessons")
            .select("id", { count: "exact", head: true });

        const { data: contribuicoes } = await supabase
            .from("knowledge_sync_status")
            .select("person_id, status")
            .eq("status", "synced");

        const totalAulasCount = totalAulas ?? 0;
        const totalContribuicoes = (contribuicoes || []).length;

        const progressoPorPessoa = {};
        (profiles || []).forEach((p) => {
            const aulasConcluidas = (aulasPorPessoa || []).filter(
                (a) => a.uploaded_by === p.id && a.status === "completed"
            ).length;
            const contribuicoesPessoa = (contribuicoes || []).filter((c) => c.person_id === p.id).length;

            progressoPorPessoa[p.id] = {
                aulasConcluidas,
                percentCurso: totalAulasCount > 0 ? Math.min(100, (aulasConcluidas / totalAulasCount) * 100) : 0,
                contribuicoesPessoa,
                percentContribuicao: totalContribuicoes > 0 ? Math.min(100, (contribuicoesPessoa / totalContribuicoes) * 100) : 0,
            };
        });

        setProgressoPorPessoa(progressoPorPessoa);

        const { data: cursos } = await supabase
            .from("courses")
            .select("total_modules, total_lessons, modules ( total_lessons, lessons ( status ) )");

        let totalLessons = 0;
        let completedLessons = 0;
        let totalModules = 0;
        let completedModules = 0;

        (cursos || []).forEach((curso) => {
            totalLessons += curso.total_lessons || 0;
            totalModules += curso.total_modules || 0;

            (curso.modules || []).forEach((modulo) => {
                const aulas = modulo.lessons || [];
                const concluidas = aulas.filter((l) => l.status === "completed").length;
                completedLessons += concluidas;

                if (modulo.total_lessons && concluidas >= modulo.total_lessons) {
                    completedModules += 1;
                }
            });
        });

        setProgresso({ totalLessons, completedLessons, totalModules, completedModules });

        const { data: modulosData } = await supabase
            .from("modules")
            .select("id, module_number, name, total_lessons, courses ( name ), lessons ( status )")
            .order("module_number", { ascending: true });

        setModulosProgresso(modulosData || []);

        const { data: audios, error } = await supabase
            .from("audio_files")
            .select(
                `
                id,
                filename,
                status,
                created_at,
                uploaded_by,
                storage_path,
                file_size,
                duration,
                profiles ( display_name ),
                lessons ( title, lesson_number ),
                modules ( name, module_number ),
                course_id,
                courses ( name ),
                transcription_jobs ( id, status, attempts, manual_requested, cancel_requested, error_message, progress_percent, started_at, completed_at )
                `
            )
            .order("created_at", { ascending: false });

        if (!error && audios) {
            setRows(audios);
        }

        setLoading(false);
    }

    useEffect(() => {
        carregar();

        const channel = supabase
            .channel("dashboard-realtime")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "audio_files" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "transcription_jobs" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "app_settings" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "worker_status" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "profiles" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "courses" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "modules" },
                carregar
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "lessons" },
                carregar
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        let emAndamento = false;
        const timer = setInterval(async () => {
            if (emAndamento) return;
            emAndamento = true;
            try {
                await carregar();
            } finally {
                emAndamento = false;
            }
        }, 500);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const agora = Date.now();
        const onlineIds = new Set(
            usuarios
                .filter((u) => u.last_seen && (agora - new Date(u.last_seen).getTime()) / 1000 < USER_OFFLINE_AFTER_SECONDS)
                .map((u) => u.id)
        );

        if (prevOnlineIdsRef.current && notifPrefsRef.current.amigosOnline) {
            usuarios.forEach((u) => {
                if (onlineIds.has(u.id) && !prevOnlineIdsRef.current.has(u.id)) {
                    notificar("Amigo online", `${u.display_name || "Um usuário"} está online agora.`);
                }
            });
        }

        prevOnlineIdsRef.current = onlineIds;
    }, [usuarios]);

    useEffect(() => {
        const pendingIds = new Set(rows.filter((r) => r.status !== "completed").map((r) => r.id));
        const jobStatusById = {};
        rows.forEach((r) => {
            jobStatusById[r.id] = r.status;
        });

        if (prevAudioIdsRef.current && notifPrefsRef.current.audioPendente) {
            rows.forEach((r) => {
                if (pendingIds.has(r.id) && !prevAudioIdsRef.current.has(r.id)) {
                    notificar("Novo áudio pendente", `${nomeExibicao(r.filename) || "Um áudio"} está aguardando transcrição.`);
                }
            });
        }

        if (prevJobStatusRef.current) {
            rows.forEach((r) => {
                const anterior = prevJobStatusRef.current[r.id];
                if (!anterior || anterior === r.status) {
                    return;
                }
                if (r.status === "completed" && notifPrefsRef.current.transcricaoSucesso) {
                    notificar("Transcrição concluída", `${nomeExibicao(r.filename) || "Um áudio"} foi transcrito com sucesso.`);
                } else if (r.status === "failed" && notifPrefsRef.current.transcricaoFalha) {
                    notificar("Falha na transcrição", `${nomeExibicao(r.filename) || "Um áudio"} falhou ao transcrever.`);
                }
            });
        }

        prevAudioIdsRef.current = pendingIds;
        prevJobStatusRef.current = jobStatusById;
    }, [rows]);

    useEffect(() => {
        const salvo = localStorage.getItem("dashboard-theme");
        const inicial = salvo === "light" ? "light" : "dark";
        setTheme(inicial);
        document.documentElement.setAttribute("data-theme", inicial);
    }, []);

    function alternarTema(novo) {
        setTheme(novo);
        document.documentElement.setAttribute("data-theme", novo);
        localStorage.setItem("dashboard-theme", novo);
    }

    useEffect(() => {
        const salvo = localStorage.getItem("dashboard-notif-prefs");
        if (salvo) {
            try {
                setNotifPrefs((prev) => ({ ...prev, ...JSON.parse(salvo) }));
            } catch {
                // ignora preferências salvas em formato inválido
            }
        }

        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    function alternarNotifPref(chave) {
        setNotifPrefs((prev) => {
            const novo = { ...prev, [chave]: !prev[chave] };
            localStorage.setItem("dashboard-notif-prefs", JSON.stringify(novo));
            return novo;
        });
    }

    function notificar(titulo, corpo) {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") {
            return;
        }
        new Notification(titulo, { body: corpo, icon: "/icon-a3.png" });
    }

    function nomeExibicao(filename) {
        if (!filename) return "";
        return filename.replace(/_(\d{10,})(\.[a-zA-Z0-9]+)$/, "$2").replace(/_/g, " ");
    }

    function formatarBytes(bytes) {
        if (bytes === null || bytes === undefined) return "—";
        if (bytes === 0) return "0 B";
        const unidades = ["B", "KB", "MB", "GB"];
        const i = Math.min(unidades.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`;
    }

    function formatarDuracao(segundos) {
        if (segundos === null || segundos === undefined) return "—";
        const total = Math.round(segundos);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function tempoGpu(job) {
        if (!job || !job.started_at || !job.completed_at) return "—";
        const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
        if (!Number.isFinite(ms) || ms < 0) return "—";
        const segundos = Math.round(ms / 1000);
        if (segundos < 60) return `${segundos}s`;
        const m = Math.floor(segundos / 60);
        const s = segundos % 60;
        return `${m}m ${s}s`;
    }

    function formatarSegundos(segundos) {
        const s = Math.max(0, Math.round(segundos));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return `${m}m ${rs}s`;
    }

    // Taxa média de processamento da GPU (segundos de GPU por segundo de
    // áudio), calculada a partir dos jobs já concluídos. Usada para estimar
    // quanto falta para os jobs pendentes/em andamento.
    const taxaGpuMedia = useMemo(() => {
        const amostras = [];

        rows.forEach((row) => {
            const job = row.transcription_jobs?.[0];
            if (
                job &&
                job.status === "completed" &&
                job.started_at &&
                job.completed_at &&
                row.duration > 0
            ) {
                const gpuSegundos =
                    (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;

                if (gpuSegundos > 0) {
                    amostras.push(gpuSegundos / row.duration);
                }
            }
        });

        if (amostras.length === 0) return null;
        return amostras.reduce((a, b) => a + b, 0) / amostras.length;
    }, [rows]);

    function tempoDecorrido(job) {
        if (!job || !job.started_at) return null;
        const decorrido = (now - new Date(job.started_at).getTime()) / 1000;
        if (!Number.isFinite(decorrido) || decorrido < 0) return null;
        return formatarSegundos(decorrido);
    }

    function estimativaTranscricao(row, job) {
        if (!taxaGpuMedia || !row.duration) return null;

        const totalEstimadoSeg = taxaGpuMedia * row.duration;

        if (job.status === "processing" && job.started_at) {
            const decorrido = (now - new Date(job.started_at).getTime()) / 1000;
            const restante = Math.max(0, totalEstimadoSeg - decorrido);
            return `~${formatarSegundos(restante)} restantes`;
        }

        if (job.status === "pending") {
            return `~${formatarSegundos(totalEstimadoSeg)} previsto`;
        }

        return null;
    }

    // O worker de transcrição nem sempre preenche audio_files.duration.
    // Quando falta, medimos a duração real no navegador (sem tocar o áudio)
    // e gravamos no banco pra próxima vez já vir preenchido.
    async function garantirDuracao(row) {
        if (row.duration || !row.storage_path) return;

        const { data, error } = await supabase.storage
            .from("audio")
            .createSignedUrl(row.storage_path, 3600);

        if (error || !data) return;

        const probe = new Audio();
        probe.preload = "metadata";
        probe.src = data.signedUrl;
        probe.addEventListener("loadedmetadata", () => {
            const segundos = probe.duration;
            if (Number.isFinite(segundos) && segundos > 0) {
                supabase.from("audio_files").update({ duration: segundos }).eq("id", row.id);
            }
        });
    }

    async function tocarAudio(row) {
        if (playingAudio && playingAudio.id === row.id) {
            setPlayingAudio(null);
            return;
        }
        setPlayingAudio({ id: row.id, url: null, loading: true });
        const { data, error } = await supabase.storage
            .from("audio")
            .createSignedUrl(row.storage_path, 3600);

        if (error || !data) {
            setPlayingAudio(null);
            return;
        }
        setPlayingAudio({ id: row.id, url: data.signedUrl, loading: false });
        garantirDuracao(row);
    }

    function gerarCodigoAleatorio() {
        const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let codigo = "";
        for (let i = 0; i < 8; i++) {
            codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
        }
        return codigo;
    }

    async function gerarCodigoInstalacao() {
        setGerandoCodigo(true);
        setInstallCode(null);

        const codigo = gerarCodigoAleatorio();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        const { data: userData } = await supabase.auth.getUser();

        const { error } = await supabase.from("install_codes").insert({
            code: codigo,
            created_by: userData?.user?.id,
            expires_at: expiresAt
        });

        setGerandoCodigo(false);

        if (error) {
            alert("Erro ao gerar código: " + error.message);
            return;
        }

        setInstallCode({ code: codigo, expiresAt });
    }

    useEffect(() => {
        const salvo = localStorage.getItem("dashboard-sidebar-collapsed");
        setSidebarCollapsed(salvo === "true");
    }, []);

    function alternarSidebar() {
        setSidebarCollapsed((v) => {
            const novo = !v;
            localStorage.setItem("dashboard-sidebar-collapsed", String(novo));
            return novo;
        });
    }

    async function alternarAuto() {
        const novoValor = !autoTranscribe;
        setAutoTranscribe(novoValor);

        await supabase
            .from("app_settings")
            .update({ auto_transcribe: novoValor })
            .eq("id", true);
    }

    async function transcreverAgora(jobId) {
        setBusyIds((prev) => ({ ...prev, [jobId]: true }));

        await supabase
            .from("transcription_jobs")
            .update({ manual_requested: true })
            .eq("id", jobId);

        setBusyIds((prev) => ({ ...prev, [jobId]: false }));
    }

    function copiarTexto(texto) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(texto).catch(() => {
                copiarTextoFallback(texto);
            });
        } else {
            copiarTextoFallback(texto);
        }
    }

    function copiarTextoFallback(texto) {
        const textarea = document.createElement("textarea");
        textarea.value = texto;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand("copy");
        } catch {
            // sem suporte a nenhum método de cópia; usuário copia manualmente
        }
        document.body.removeChild(textarea);
    }

    async function tentarNovamente(jobId) {
        setBusyIds((prev) => ({ ...prev, [jobId]: true }));

        await supabase
            .from("transcription_jobs")
            .update({
                status: "pending",
                manual_requested: true,
                error_message: null,
                progress_percent: 0,
                started_at: null,
            })
            .eq("id", jobId);

        setBusyIds((prev) => ({ ...prev, [jobId]: false }));
    }

    async function pararTranscricao(jobId) {
        setBusyIds((prev) => ({ ...prev, [jobId]: true }));

        await supabase
            .from("transcription_jobs")
            .update({ cancel_requested: true })
            .eq("id", jobId);

        setBusyIds((prev) => ({ ...prev, [jobId]: false }));
    }

    async function sair() {
        await supabase.auth.signOut();
    }

    async function sha256Hex(texto) {
        const bytes = new TextEncoder().encode(texto);
        const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    async function salvarSenhaExclusao() {
        if (!newPasswordInput || newPasswordInput.length < 4) {
            setPasswordSavedMsg("A senha precisa ter ao menos 4 caracteres.");
            return;
        }

        setSavingPassword(true);
        setPasswordSavedMsg("");

        const hash = await sha256Hex(newPasswordInput);

        const { error } = await supabase
            .from("app_settings")
            .update({ delete_password_hash: hash })
            .eq("id", true);

        setSavingPassword(false);

        if (error) {
            setPasswordSavedMsg("Erro ao salvar senha.");
        } else {
            setDeletePasswordHash(hash);
            setNewPasswordInput("");
            setPasswordSavedMsg("Senha de exclusão salva.");
        }
    }

    function avisarDownloadConcluido(nomeArquivo) {
        setDownloadMsg(`Download de "${nomeArquivo}" concluído com sucesso!`);
        setTimeout(() => setDownloadMsg(null), 4000);
    }

    function pedirExclusao(row) {
        setDeleteTarget(row);
        setDeletePasswordInput("");
        setDeleteError("");
    }

    async function confirmarExclusao() {
        if (!deleteTarget) {
            return;
        }

        if (!deletePasswordHash) {
            setDeleteError("Defina uma senha de exclusão nas configurações antes de excluir arquivos.");
            return;
        }

        if (!deletePasswordInput) {
            setDeleteError("Digite a senha de exclusão.");
            return;
        }

        setDeleting(true);
        setDeleteError("");

        const hashDigitado = await sha256Hex(deletePasswordInput);

        if (hashDigitado !== deletePasswordHash) {
            setDeleting(false);
            setDeleteError("Senha incorreta.");
            return;
        }

        try {
            await supabase.from("transcriptions").delete().eq("audio_file_id", deleteTarget.id);
            await supabase.from("transcription_jobs").delete().eq("audio_file_id", deleteTarget.id);

            if (deleteTarget.storage_path) {
                await supabase.storage.from("audio").remove([deleteTarget.storage_path]);
            }

            await supabase.from("audio_files").delete().eq("id", deleteTarget.id);

            setDeleteTarget(null);
            setDeletePasswordInput("");
            await carregar();

        } catch (error) {
            setDeleteError("Erro ao excluir: " + error.message);
        } finally {
            setDeleting(false);
        }
    }

    const rowsFiltradas = rows.filter((row) => {
        if (statusFilter === "completed" && row.status !== "completed") return false;
        if (statusFilter === "pending" && row.status === "completed") return false;

        if (searchText.trim()) {
            const alvo = [
                row.filename,
                row.courses?.name,
                row.modules?.name,
                row.lessons?.title,
                row.profiles?.display_name
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if (!alvo.includes(searchText.trim().toLowerCase())) return false;
        }

        return true;
    });

    const workerHeartbeatOnline =
        worker &&
        worker.last_seen &&
        (now - new Date(worker.last_seen).getTime()) / 1000 < WORKER_OFFLINE_AFTER_SECONDS;

    const workerActivelyTranscribing =
        worker &&
        worker.current_job_id &&
        rows.some((r) =>
            (r.transcription_jobs || []).some(
                (job) => job.id === worker.current_job_id && job.status === "processing"
            )
        );

    const workerOnline = Boolean(workerHeartbeatOnline || workerActivelyTranscribing);

    const pendentesCount = rows.filter((r) => r.status !== "completed").length;

    const cursosAgrupados = Object.values(
        rows.reduce((acc, row) => {
            const nome = row.courses?.name || "Sem curso";
            if (!acc[nome]) acc[nome] = { nome, total: 0 };
            acc[nome].total += 1;
            return acc;
        }, {})
    ).sort((a, b) => b.total - a.total);

    const chartData = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (6 - i));
        const key = d.toISOString().slice(0, 10);
        const count = rows.filter((r) => r.created_at && r.created_at.slice(0, 10) === key).length;
        return { key, count, label: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "") };
    });
    const chartMax = Math.max(1, ...chartData.map((d) => d.count));

    const usuariosCount = usuarios.length;
    const usuariosOnline = usuarios.filter((u) => userIsOnline(u)).length;

    function userIsOnline(usuario) {
        if (!usuario?.last_seen) return false;
        return (now - new Date(usuario.last_seen).getTime()) / 1000 < USER_OFFLINE_AFTER_SECONDS;
    }
    const concluidasCount = rows.filter((r) => r.status === "completed").length;

    function formatarHoraAgora() {
        return new Date(now).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return (
        <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
            {downloadMsg && (
                <div
                    style={{
                        position: "fixed",
                        top: 20,
                        right: 20,
                        zIndex: 9999,
                        background: "var(--accent, #16a34a)",
                        color: "#fff",
                        padding: "12px 18px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 600,
                        boxShadow: "0 8px 24px rgba(0,0,0,.25)"
                    }}
                >
                    ✓ {downloadMsg}
                </div>
            )}

            <aside className="sidebar">
                <div className="sidebar-header">
                    <img className="brand-badge" src="/icon-a3.png" alt="A3-OS" />
                    {!sidebarCollapsed && <span className="sidebar-title">A3-OS</span>}
                </div>

                <nav className="sidebar-nav">
                    {!sidebarCollapsed && <div className="sidebar-section-label">Operação</div>}

                    <button
                        className={`sidebar-item ${!["progresso", "notificacoes", "extensao", "configuracoes", "assistente"].includes(view) ? "active" : ""}`}
                        title="Dashboard"
                        onClick={() => { setView("files"); setStatusFilter("all"); }}
                    >
                        <IconGrid />
                        {!sidebarCollapsed && <span>Dashboard</span>}
                        {pendentesCount > 0 && (
                            <span className="sidebar-badge">{pendentesCount}</span>
                        )}
                    </button>

                    <button
                        className={`sidebar-item ${view === "progresso" ? "active" : ""}`}
                        title="Progresso"
                        onClick={() => setView("progresso")}
                    >
                        <IconTrendingUp />
                        {!sidebarCollapsed && <span>Progresso</span>}
                    </button>

                    <button
                        className={`sidebar-item ${view === "notificacoes" ? "active" : ""}`}
                        title="Notificações"
                        onClick={() => setView("notificacoes")}
                    >
                        <IconBell />
                        {!sidebarCollapsed && <span>Notificações</span>}
                    </button>

                    <button
                        className={`sidebar-item ${view === "extensao" ? "active" : ""}`}
                        title="Downloads"
                        onClick={() => setView("extensao")}
                    >
                        <IconDownload />
                        {!sidebarCollapsed && <span>Downloads</span>}
                    </button>

                    <button
                        className={`sidebar-item ${view === "configuracoes" ? "active" : ""}`}
                        title="Configurações"
                        onClick={() => setView("configuracoes")}
                    >
                        <IconGear />
                        {!sidebarCollapsed && <span>Configurações</span>}
                    </button>

                    <button
                        className={`sidebar-item ${view === "assistente" ? "active" : ""}`}
                        title="Assistente"
                        onClick={() => setView("assistente")}
                    >
                        <IconMic />
                        {!sidebarCollapsed && <span>Assistente</span>}
                    </button>

                    {!sidebarCollapsed && <div className="sidebar-section-label">Visão geral</div>}

                    <div
                        className="sidebar-stat sidebar-stat-files sidebar-stat-clickable"
                        data-active={view === "files" && statusFilter === "all"}
                        onClick={() => { setView("files"); setStatusFilter("all"); }}
                        title="Arquivos enviados"
                    >
                        <span className="sidebar-stat-icon"><IconFolder /></span>
                        {!sidebarCollapsed && (
                            <div>
                                <div className="sidebar-stat-value">{rows.length}</div>
                                <div className="sidebar-stat-label">Arquivos enviados</div>
                            </div>
                        )}
                    </div>

                    <div
                        className="sidebar-stat sidebar-stat-users sidebar-stat-clickable"
                        data-active={view === "usuarios"}
                        onClick={() => setView("usuarios")}
                        title="Usuários"
                    >
                        <span className="sidebar-stat-icon"><IconUsers /></span>
                        {!sidebarCollapsed && (
                            <div>
                                <div className="sidebar-stat-value">{usuariosCount}</div>
                                <div className="sidebar-stat-label">Usuários</div>
                            </div>
                        )}
                    </div>

                    <div
                        className="sidebar-stat sidebar-stat-completed sidebar-stat-clickable"
                        data-active={view === "files" && statusFilter === "completed"}
                        onClick={() => { setView("files"); setStatusFilter("completed"); }}
                        title="Transcrições concluídas"
                    >
                        <span className="sidebar-stat-icon"><IconCheckCircle /></span>
                        {!sidebarCollapsed && (
                            <div>
                                <div className="sidebar-stat-value">{concluidasCount}</div>
                                <div className="sidebar-stat-label">Concluídas</div>
                            </div>
                        )}
                    </div>

                    <div
                        className="sidebar-stat sidebar-stat-pending sidebar-stat-clickable"
                        data-active={view === "files" && statusFilter === "pending"}
                        onClick={() => { setView("files"); setStatusFilter("pending"); }}
                        title="Pendentes"
                    >
                        <span className="sidebar-stat-icon"><IconClock /></span>
                        {!sidebarCollapsed && (
                            <div>
                                <div className="sidebar-stat-value">{pendentesCount}</div>
                                <div className="sidebar-stat-label">Pendentes</div>
                            </div>
                        )}
                    </div>

                </nav>

                <div className="sidebar-footer">
                    <button className="sidebar-item" title="Sair" onClick={sair}>
                        <IconLogout />
                        {!sidebarCollapsed && <span>Sair</span>}
                    </button>

                    <button
                        className="sidebar-collapse-btn"
                        title={sidebarCollapsed ? "Expandir" : "Recolher"}
                        onClick={alternarSidebar}
                    >
                        <IconChevron collapsed={sidebarCollapsed} />
                        {!sidebarCollapsed && <span>Recolher</span>}
                    </button>
                </div>
            </aside>

            <main className="main-content">
                <div className="top-bar">
                    <div className="top-search">
                        <IconSearch />
                        <input
                            type="text"
                            placeholder="Buscar arquivo, curso ou aluno..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                    </div>

                    <div className="top-bar-actions">
                        <div className={`status-pill ${workerOnline ? "status-pill-ok" : "status-pill-off"}`}>
                            <span className={`dot ${workerOnline ? "dot-online" : "dot-offline"}`} />
                            Transcritor: {workerOnline ? "Ativo" : "Offline"}
                        </div>
                        <div className="top-bar-clock">{formatarHoraAgora()}</div>
                        <button className="icon-btn" title="Atualizar" onClick={carregar}>
                            <IconRefresh />
                        </button>
                        <div className="avatar" title={ADMIN_EMAIL}>
                            {ADMIN_EMAIL.charAt(0).toUpperCase()}
                        </div>
                    </div>
                </div>

                <div className="page-header">
                    <h1>
                        {view === "usuarios"
                            ? "Usuários"
                            : view === "progresso"
                                ? "Progresso"
                                : view === "notificacoes"
                                    ? "Notificações"
                                    : view === "extensao"
                                        ? "Extensão"
                                        : view === "configuracoes"
                                            ? "Configurações"
                                            : view === "assistente"
                                                ? "Assistente"
                                                : "Painel do Transcritor"}
                    </h1>
                    <div className="subtitle" style={{ marginBottom: 0 }}>
                        {view === "usuarios"
                            ? "Quem está usando a extensão agora"
                            : view === "progresso"
                                ? "Progresso geral e por módulo do curso"
                                : view === "notificacoes"
                                    ? "Escolha quais avisos você quer receber"
                                    : view === "extensao"
                                        ? "Baixe a extensão e compartilhe com seus amigos"
                                        : view === "configuracoes"
                                            ? "Ajustes gerais do painel e da transcrição"
                                            : view === "assistente"
                                                ? "Pergunte por voz sobre o que já foi transcrito"
                                                : "Áudios enviados pela extensão e status da transcrição"}
                    </div>
                </div>

                {view === "assistente" && <Assistente />}

                {view === "progresso" && (
                    <>
                        <div className="card">
                            <div className="section-title">Progresso geral do curso</div>
                            <div className="progress-summary-row">
                                <div className="progress-summary-item">
                                    <div className="progress-summary-top">
                                        <span className="progress-summary-label">Aulas concluídas</span>
                                        <span className="progress-summary-value">
                                            {progresso.completedLessons} de {progresso.totalLessons}
                                        </span>
                                    </div>
                                    <div className="progress-track-lg">
                                        <div
                                            className="progress-fill-accent"
                                            style={{
                                                width: `${progresso.totalLessons > 0 ? Math.min(100, (progresso.completedLessons / progresso.totalLessons) * 100) : 0}%`
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="progress-summary-item">
                                    <div className="progress-summary-top">
                                        <span className="progress-summary-label">Módulos concluídos</span>
                                        <span className="progress-summary-value">
                                            {progresso.completedModules} de {progresso.totalModules}
                                        </span>
                                    </div>
                                    <div className="progress-track-lg">
                                        <div
                                            className="progress-fill-accent"
                                            style={{
                                                width: `${progresso.totalModules > 0 ? Math.min(100, (progresso.completedModules / progresso.totalModules) * 100) : 0}%`
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <div className="section-title">Progresso por módulo</div>
                            <div className="module-progress-list">
                                {modulosProgresso.length === 0 && (
                                    <div className="empty" style={{ padding: 16 }}>Nenhum módulo cadastrado ainda.</div>
                                )}
                                {modulosProgresso.map((modulo) => {
                                    const aulas = modulo.lessons || [];
                                    const concluidas = aulas.filter((l) => l.status === "completed").length;
                                    const total = modulo.total_lessons || 0;
                                    const percentual = total > 0 ? Math.min(100, (concluidas / total) * 100) : 0;

                                    return (
                                        <div className="module-progress-row" key={modulo.id}>
                                            <div className="module-progress-top">
                                                <span className="module-progress-name">
                                                    {modulo.module_number}. {modulo.name}
                                                </span>
                                                <span className="module-progress-value">
                                                    {concluidas} de {total} · {Math.round(percentual)}%
                                                </span>
                                            </div>
                                            <div className="progress-track-lg">
                                                <div
                                                    className="progress-fill-accent"
                                                    style={{ width: `${percentual}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {view === "notificacoes" && (
                    <div className="card">
                        <div className="section-title">Preferências de notificação</div>

                        <div className="settings-row">
                            <span>Amigos online</span>
                            <div
                                className="switch"
                                data-on={notifPrefs.amigosOnline}
                                onClick={() => alternarNotifPref("amigosOnline")}
                            >
                                <div className="switch-dot" />
                            </div>
                        </div>

                        <div className="settings-row">
                            <span>Áudio pendente de transcrição</span>
                            <div
                                className="switch"
                                data-on={notifPrefs.audioPendente}
                                onClick={() => alternarNotifPref("audioPendente")}
                            >
                                <div className="switch-dot" />
                            </div>
                        </div>

                        <div className="settings-row">
                            <span>Transcrição concluída</span>
                            <div
                                className="switch"
                                data-on={notifPrefs.transcricaoSucesso}
                                onClick={() => alternarNotifPref("transcricaoSucesso")}
                            >
                                <div className="switch-dot" />
                            </div>
                        </div>

                        <div className="settings-row">
                            <span>Falha na transcrição</span>
                            <div
                                className="switch"
                                data-on={notifPrefs.transcricaoFalha}
                                onClick={() => alternarNotifPref("transcricaoFalha")}
                            >
                                <div className="switch-dot" />
                            </div>
                        </div>
                    </div>
                )}

                {view === "extensao" && (
                    <div className="card">
                        <div className="section-title">Extensão A3-OS Recorder</div>
                        <p style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6, maxWidth: 640 }}>
                            Baixe o pacote da extensão para instalar no Chrome ou enviar para um amigo instalar no computador dele.
                            O arquivo já vem configurado para se conectar ao mesmo banco de dados.
                        </p>

                        <a
                            href="/a3-os-extension.zip"
                            download
                            className="btn-small"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, textDecoration: "none" }}
                            onClick={() => avisarDownloadConcluido("a3-os-extension.zip")}
                        >
                            <IconDownload />
                            Baixar extensão (.zip)
                        </a>

                        <div className="section-title" style={{ marginTop: 24 }}>Como instalar</div>
                        <ol style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.9, paddingLeft: 18, maxWidth: 640 }}>
                            <li>Baixe e descompacte o arquivo <strong>a3-os-extension.zip</strong> em uma pasta.</li>
                            <li>Abra o Chrome e acesse <strong>chrome://extensions</strong>.</li>
                            <li>Ative o <strong>Modo do desenvolvedor</strong> no canto superior direito.</li>
                            <li>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta descompactada.</li>
                            <li>Pronto! A extensão vai aparecer na barra do Chrome.</li>
                        </ol>
                    </div>
                )}

                {view === "extensao" && (
                    <div className="card" style={{ marginTop: 16 }}>
                        <div className="section-title">Transcritor Local</div>
                        <p style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6, maxWidth: 640 }}>
                            O transcritor roda no seu computador e processa os áudios com a GPU local.
                            Baixe o instalador, gere um código de instalação de uso único abaixo e cole
                            quando o transcritor pedir na primeira execução. Ele já conecta sozinho a
                            este painel e se registra no Agendador de Tarefas do Windows.
                        </p>

                        <a
                            href="/TranscritorLocal-Setup.exe"
                            download
                            className="btn-small"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, textDecoration: "none" }}
                            onClick={() => avisarDownloadConcluido("TranscritorLocal-Setup.exe")}
                        >
                            <IconDownload />
                            Baixar Transcritor Local (.exe)
                        </a>

                        <div className="section-title" style={{ marginTop: 20, fontSize: 13 }}>Código de instalação</div>

                        <button
                            className="btn-small"
                            style={{ marginTop: 8 }}
                            onClick={gerarCodigoInstalacao}
                            disabled={gerandoCodigo}
                        >
                            {gerandoCodigo ? "Gerando..." : "Gerar código de instalação"}
                        </button>

                        {installCode && (
                            <div
                                style={{
                                    marginTop: 16,
                                    padding: "14px 18px",
                                    borderRadius: 10,
                                    border: "1px solid var(--border-soft)",
                                    background: "var(--bg-elevated, rgba(255,255,255,0.03))",
                                    maxWidth: 320
                                }}
                            >
                                <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
                                    Código de instalação
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3, fontFamily: "monospace" }}>
                                        {installCode.code}
                                    </div>
                                    <button
                                        type="button"
                                        title="Copiar código"
                                        onClick={() => {
                                            copiarTexto(installCode.code);
                                            setCodigoCopiado(true);
                                            setTimeout(() => setCodigoCopiado(false), 1500);
                                        }}
                                        style={{
                                            background: "transparent",
                                            border: "none",
                                            cursor: "pointer",
                                            padding: 6,
                                            borderRadius: 6,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: codigoCopiado ? "var(--accent, #16a34a)" : "var(--text-dim)"
                                        }}
                                    >
                                        {codigoCopiado ? (
                                            <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        ) : (
                                            <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                                                <rect x="9" y="9" width="11" height="11" rx="2" />
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
                                    {now < new Date(installCode.expiresAt).getTime()
                                        ? `Expira em ${Math.max(0, Math.round((new Date(installCode.expiresAt).getTime() - now) / 1000 / 60))} min`
                                        : "Expirado — gere um novo código"}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {view === "configuracoes" && (
                    <div className="card">
                        <div className="section-title">Transcrição</div>
                        <div className="settings-row">
                            <span>Transcrição automática</span>
                            <div
                                className="switch"
                                data-on={autoTranscribe}
                                onClick={alternarAuto}
                            >
                                <div className="switch-dot" />
                            </div>
                        </div>

                        <div className="section-title" style={{ marginTop: 24 }}>Tema</div>
                        <div className="theme-options">
                            <div
                                className="theme-option"
                                data-active={theme === "dark"}
                                onClick={() => alternarTema("dark")}
                            >
                                Escuro
                            </div>
                            <div
                                className="theme-option"
                                data-active={theme === "light"}
                                onClick={() => alternarTema("light")}
                            >
                                Claro
                            </div>
                        </div>

                        <div className="section-title" style={{ marginTop: 24 }}>Segurança</div>
                        <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                            <span>Senha para excluir arquivos</span>
                            <input
                                type="password"
                                placeholder={deletePasswordHash ? "Alterar senha" : "Definir senha"}
                                value={newPasswordInput}
                                onChange={(e) => setNewPasswordInput(e.target.value)}
                                style={{ margin: 0 }}
                            />
                            <button
                                className="btn-small"
                                disabled={savingPassword}
                                onClick={salvarSenhaExclusao}
                            >
                                {savingPassword ? "Salvando..." : "Salvar senha"}
                            </button>
                            {passwordSavedMsg && (
                                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                                    {passwordSavedMsg}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {view === "configuracoes" && (
                    <div className="card" style={{ marginTop: 16 }}>
                        <div className="section-title">Base de conhecimento</div>
                        <p style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6, maxWidth: 640 }}>
                            A gravação de cada pessoa é automaticamente salva na base de conhecimento pessoal dela
                            e, quando é conteúdo de curso, também na base consolidada da A3. Não é mais necessário
                            configurar pastas manualmente.
                        </p>
                    </div>
                )}

                {view === "usuarios" && (
                    <div className="card">
                        <div className="section-title">
                            {usuariosOnline} de {usuarios.length} online agora
                        </div>
                        <div className="connections-list">
                            {usuarios.map((usuario) => {
                                const online = userIsOnline(usuario);
                                return (
                                    <div className="connection-row" key={usuario.id}>
                                        <div className="connection-icon" style={{ background: "rgba(124, 58, 237, .18)", color: "#7c3aed" }}>
                                            <IconUsers />
                                        </div>
                                        <div className="connection-info">
                                            <div className="connection-name">{usuario.display_name || "Sem nome"}</div>
                                            <div className="connection-sub">
                                                {online
                                                    ? "Usando a extensão agora"
                                                    : usuario.last_seen
                                                        ? `Visto por último ${new Date(usuario.last_seen).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                                                        : "Nunca conectou"}
                                            </div>
                                        </div>
                                        {(() => {
                                            const prog = progressoPorPessoa[usuario.id] || { percentCurso: 0, aulasConcluidas: 0, percentContribuicao: 0, contribuicoesPessoa: 0 };
                                            return (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160, marginRight: 12 }}>
                                                    <div>
                                                        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                                                            Progresso do curso — {prog.aulasConcluidas} aulas
                                                        </div>
                                                        <div className="progress-track-lg">
                                                            <div className="progress-fill-accent" style={{ width: `${prog.percentCurso}%` }} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                                                            Contribuição à base central — {prog.contribuicoesPessoa} aulas
                                                        </div>
                                                        <div className="progress-track-lg">
                                                            <div className="progress-fill-accent" style={{ width: `${prog.percentContribuicao}%` }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        <span className={`connection-pill ${online ? "" : "connection-pill-off"}`}>
                                            {online ? "online" : "offline"}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {view === "files" && (
                <>
                <div className="card">
                    <div className="section-title">Progresso do curso</div>
                    <div className="progress-summary-row">
                        <div className="progress-summary-item">
                            <div className="progress-summary-top">
                                <span className="progress-summary-label">Aulas concluídas</span>
                                <span className="progress-summary-value">
                                    {progresso.completedLessons} de {progresso.totalLessons}
                                </span>
                            </div>
                            <div className="progress-track-lg">
                                <div
                                    className="progress-fill-accent"
                                    style={{
                                        width: `${progresso.totalLessons > 0 ? Math.min(100, (progresso.completedLessons / progresso.totalLessons) * 100) : 0}%`
                                    }}
                                />
                            </div>
                        </div>

                        <div className="progress-summary-item">
                            <div className="progress-summary-top">
                                <span className="progress-summary-label">Módulos concluídos</span>
                                <span className="progress-summary-value">
                                    {progresso.completedModules} de {progresso.totalModules}
                                </span>
                            </div>
                            <div className="progress-track-lg">
                                <div
                                    className="progress-fill-accent"
                                    style={{
                                        width: `${progresso.totalModules > 0 ? Math.min(100, (progresso.completedModules / progresso.totalModules) * 100) : 0}%`
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card chart-card">
                    <div className="section-title">Áudios enviados (últimos 7 dias)</div>
                    <div className="chart-bars">
                        {chartData.map((d) => (
                            <div className="chart-bar-col" key={d.key}>
                                <div className="chart-bar-value">{d.count > 0 ? d.count : ""}</div>
                                <div className="chart-bar-track">
                                    <div
                                        className="chart-bar-fill"
                                        style={{ height: `${chartMax > 0 ? (d.count / chartMax) * 100 : 0}%` }}
                                    />
                                </div>
                                <div className="chart-bar-label">{d.label}</div>
                            </div>
                        ))}
                    </div>
                </div>

            <div className="card list-view">
                {loading ? (
                    <div className="empty">Carregando...</div>
                ) : rowsFiltradas.length === 0 ? (
                    <div className="empty">Nenhum áudio encontrado para esse filtro.</div>
                ) : (
                    rowsFiltradas.map((row) => {
                        const job = row.transcription_jobs?.[0];

                        return (
                            <div className="list-row" key={row.id}>
                                <div className="list-row-icon">
                                    <IconAudio />
                                </div>

                                <div className="list-row-main">
                                    <span
                                        className="filename-link list-row-title"
                                        title={row.filename}
                                        onClick={() => window.open(`/transcricao/${row.id}`, "_blank")}
                                    >
                                        {nomeExibicao(row.filename)}
                                    </span>
                                    <div className="list-row-path">
                                        {row.courses?.name || "—"}
                                        {row.modules ? ` / Módulo ${row.modules.module_number}` : ""}
                                        {row.lessons ? ` / ${row.lessons.lesson_number} — ${row.lessons.title}` : ""}
                                    </div>
                                    {playingAudio && playingAudio.id === row.id && (
                                        <div className="audio-player-wrap">
                                            {playingAudio.loading ? (
                                                <span className="progress-label">Carregando áudio...</span>
                                            ) : (
                                                <audio
                                                    className="audio-player"
                                                    src={playingAudio.url}
                                                    controls
                                                    autoPlay
                                                    onEnded={() => setPlayingAudio(null)}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                                <span className={`badge badge-${row.status} list-row-badge`}>
                                    {STATUS_LABEL[row.status] || row.status}
                                </span>

                                <div className="list-row-meta">
                                    <div className="list-row-meta-label">Enviado por</div>
                                    <div>{row.profiles?.display_name || "—"}</div>
                                </div>

                                <div className="list-row-result">
                                    {job ? (
                                        <>
                                            <span className={`badge badge-${job.status}`}>
                                                {STATUS_LABEL[job.status] || job.status}
                                            </span>
                                            {job.status === "processing" && (
                                                <>
                                                    <div className="progress-track">
                                                        <div
                                                            className="progress-fill"
                                                            style={{ width: `${job.progress_percent || 0}%` }}
                                                        />
                                                    </div>
                                                    <div className="progress-label">
                                                        {Math.round(job.progress_percent || 0)}%
                                                        {tempoDecorrido(job) && (
                                                            <> · {tempoDecorrido(job)} decorridos</>
                                                        )}
                                                        {estimativaTranscricao(row, job) && (
                                                            <> · {estimativaTranscricao(row, job)}</>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                            {job.status === "pending" && estimativaTranscricao(row, job) && (
                                                <div className="progress-label">
                                                    {estimativaTranscricao(row, job)}
                                                </div>
                                            )}
                                            {job.error_message && (
                                                <div style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>
                                                    {job.error_message}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        "—"
                                    )}
                                </div>

                                <div className="list-row-actions">
                                    {job && job.status === "pending" && (
                                        <button
                                            className="btn-small"
                                            disabled={autoTranscribe || job.manual_requested || busyIds[job.id]}
                                            onClick={() => transcreverAgora(job.id)}
                                        >
                                            {job.manual_requested ? "Na fila" : "Transcrever agora"}
                                        </button>
                                    )}
                                    {job && job.status === "processing" && (
                                        <button
                                            className="btn-small"
                                            disabled={job.cancel_requested || busyIds[job.id]}
                                            onClick={() => pararTranscricao(job.id)}
                                        >
                                            {job.cancel_requested ? "Parando..." : "Parar"}
                                        </button>
                                    )}
                                    {job && job.status === "failed" && (
                                        <button
                                            className="icon-btn"
                                            title="Tentar novamente"
                                            disabled={busyIds[job.id]}
                                            onClick={() => tentarNovamente(job.id)}
                                        >
                                            <IconRefresh />
                                        </button>
                                    )}
                                    <button
                                        className="icon-btn"
                                        title={playingAudio?.id === row.id ? "Pausar áudio" : "Ouvir áudio"}
                                        onClick={() => tocarAudio(row)}
                                    >
                                        {playingAudio?.id === row.id && !playingAudio.loading ? <IconPause /> : <IconPlay />}
                                    </button>
                                    <button
                                        className="icon-btn"
                                        title="Detalhes"
                                        onClick={() => {
                                            setDetailsTarget(row);
                                            garantirDuracao(row);
                                        }}
                                    >
                                        <IconInfo />
                                    </button>
                                    <button
                                        className="icon-btn"
                                        title="Abrir transcrição"
                                        onClick={() => window.open(`/transcricao/${row.id}`, "_blank")}
                                    >
                                        <IconEye />
                                    </button>
                                    <button
                                        className="icon-btn icon-btn-danger"
                                        onClick={() => pedirExclusao(row)}
                                        title="Excluir arquivo"
                                    >
                                        <IconTrash />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="bottom-columns">
                <div className="card">
                    <div className="section-title">Capacidades</div>
                    <div className="capabilities-grid">
                        {cursosAgrupados.length === 0 && (
                            <div className="empty" style={{ padding: 16 }}>Nenhum curso ainda.</div>
                        )}
                        {cursosAgrupados.map((c) => (
                            <div className="capability-card" key={c.nome}>
                                <div className="capability-icon"><IconGraduation /></div>
                                <div>
                                    <div className="capability-name">{c.nome}</div>
                                    <div className="capability-slug">{c.total} áudio{c.total === 1 ? "" : "s"}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="card">
                    <div className="section-title">Conexões</div>
                    <div className="connections-list">
                        <div className="connection-row">
                            <div className="connection-icon"><IconDatabase /></div>
                            <div className="connection-info">
                                <div className="connection-name">Supabase</div>
                                <div className="connection-sub">Banco de dados e storage</div>
                            </div>
                            <span className="connection-pill">conectado</span>
                        </div>

                        <div className="connection-row">
                            <div className="connection-icon"><IconServer /></div>
                            <div className="connection-info">
                                <div className="connection-name">Worker de transcrição</div>
                                <div className="connection-sub">
                                    {worker?.gpu_name || "—"} · v{worker?.worker_version || "—"}
                                </div>
                            </div>
                            <span className={`connection-pill ${workerOnline ? "" : "connection-pill-off"}`}>
                                {workerOnline ? "conectado" : "offline"}
                            </span>
                        </div>

                        <div className="connection-row">
                            <div className="connection-icon"><IconPuzzle /></div>
                            <div className="connection-info">
                                <div className="connection-name">Extensão do navegador</div>
                                <div className="connection-sub">Envio automático de áudios</div>
                            </div>
                            <span className="connection-pill">conectado</span>
                        </div>
                    </div>
                </div>
            </div>
                </>
                )}
            </main>

            {detailsTarget && (
                <div className="modal-overlay" onClick={() => setDetailsTarget(null)}>
                    <div className="card modal-box" onClick={(e) => e.stopPropagation()}>
                        <h1 style={{ fontSize: 16 }}>Detalhes do áudio</h1>
                        <div className="subtitle" title={detailsTarget.filename}>
                            {nomeExibicao(detailsTarget.filename)}
                        </div>

                        <div className="details-grid">
                            <div className="details-row">
                                <span className="details-label">Duração do áudio</span>
                                <span className="details-value">{formatarDuracao(detailsTarget.duration)}</span>
                            </div>
                            <div className="details-row">
                                <span className="details-label">Tamanho do arquivo</span>
                                <span className="details-value">{formatarBytes(detailsTarget.file_size)}</span>
                            </div>
                            <div className="details-row">
                                <span className="details-label">Tempo de transcrição (GPU)</span>
                                <span className="details-value">
                                    {tempoGpu(detailsTarget.transcription_jobs?.[0])}
                                </span>
                            </div>
                            {["pending", "processing"].includes(detailsTarget.transcription_jobs?.[0]?.status) && (
                                <div className="details-row">
                                    <span className="details-label">Estimativa</span>
                                    <span className="details-value">
                                        {estimativaTranscricao(detailsTarget, detailsTarget.transcription_jobs[0]) ||
                                            "Calculando..."}
                                    </span>
                                </div>
                            )}
                            {detailsTarget.transcription_jobs?.[0]?.status === "completed" && (
                                <div className="details-row">
                                    <span className="details-label">Arquivo .md salvo em</span>
                                    <span className="details-value" style={{ wordBreak: "break-all", textAlign: "right" }}>
                                        {(() => {
                                            return "Salvo automaticamente na base de conhecimento pessoal (e na central, se aplicável)";
                                        })()}
                                    </span>
                                </div>
                            )}
                            <div className="details-row">
                                <span className="details-label">Enviado por</span>
                                <span className="details-value">{detailsTarget.profiles?.display_name || "—"}</span>
                            </div>
                            <div className="details-row">
                                <span className="details-label">Enviado em</span>
                                <span className="details-value">
                                    {detailsTarget.created_at
                                        ? new Date(detailsTarget.created_at).toLocaleString("pt-BR")
                                        : "—"}
                                </span>
                            </div>
                        </div>

                        <button
                            className="btn-secondary"
                            style={{ width: "100%", marginTop: 4 }}
                            onClick={() => setDetailsTarget(null)}
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="card modal-box" onClick={(e) => e.stopPropagation()}>
                        <h1 style={{ fontSize: 16 }}>Excluir arquivo</h1>
                        <div className="subtitle">
                            Isso vai apagar permanentemente <strong>{deleteTarget.filename}</strong>,
                            sua transcrição e o job associado. Digite a senha de exclusão para confirmar.
                        </div>

                        {deleteError && <div className="error-text">{deleteError}</div>}

                        <input
                            type="password"
                            placeholder="Senha de exclusão"
                            value={deletePasswordInput}
                            onChange={(e) => setDeletePasswordInput(e.target.value)}
                            autoFocus
                        />

                        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                            <button
                                className="btn-secondary"
                                style={{ flex: 1 }}
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn-danger-solid"
                                style={{ flex: 1 }}
                                onClick={confirmarExclusao}
                                disabled={deleting}
                            >
                                {deleting ? "Excluindo..." : "Confirmar exclusão"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
