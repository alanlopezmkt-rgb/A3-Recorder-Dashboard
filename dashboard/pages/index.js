import { useEffect, useState } from "react";
import { supabase, ADMIN_EMAIL } from "../lib/supabaseClient";

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
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function entrar(event) {
        event.preventDefault();
        setError("");
        setLoading(true);

        if (isWrongUser) {
            await supabase.auth.signOut();
        }

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
                <div className="login-badge">A3</div>
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

function Dashboard() {
    const [rows, setRows] = useState([]);
    const [autoTranscribe, setAutoTranscribe] = useState(true);
    const [loading, setLoading] = useState(true);
    const [busyIds, setBusyIds] = useState({});
    const [worker, setWorker] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [theme, setTheme] = useState("dark");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [statusFilter, setStatusFilter] = useState("all");
    const [deletePasswordHash, setDeletePasswordHash] = useState(null);
    const [newPasswordInput, setNewPasswordInput] = useState("");
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordSavedMsg, setPasswordSavedMsg] = useState("");
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deletePasswordInput, setDeletePasswordInput] = useState("");
    const [deleteError, setDeleteError] = useState("");
    const [deleting, setDeleting] = useState(false);

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
                profiles ( display_name ),
                lessons ( title, lesson_number ),
                modules ( name, module_number ),
                courses ( name ),
                transcription_jobs ( id, status, attempts, manual_requested, error_message, progress_percent )
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
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(timer);
    }, []);

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
        if (statusFilter === "all") return true;
        if (statusFilter === "completed") return row.status === "completed";
        if (statusFilter === "pending") return row.status !== "completed";
        return true;
    });

    const workerOnline =
        worker &&
        worker.last_seen &&
        (now - new Date(worker.last_seen).getTime()) / 1000 < WORKER_OFFLINE_AFTER_SECONDS;

    return (
        <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="brand-badge">A3</div>
                    {!sidebarCollapsed && <span className="sidebar-title">A3-OS</span>}
                </div>

                <nav className="sidebar-nav">
                    <button className="sidebar-item active" title="Dashboard">
                        <IconGrid />
                        {!sidebarCollapsed && <span>Dashboard</span>}
                    </button>

                    <div className="sidebar-settings-wrap">
                        <button
                            className="sidebar-item"
                            title="Configurações"
                            onClick={() => setSettingsOpen((v) => !v)}
                        >
                            <IconGear />
                            {!sidebarCollapsed && <span>Configurações</span>}
                        </button>

                        {settingsOpen && (
                            <div className="settings-menu settings-menu-sidebar" onMouseLeave={() => setSettingsOpen(false)}>
                                <div className="settings-menu-title">Transcrição</div>
                                <div className="settings-row">
                                    <span>Automática</span>
                                    <div
                                        className="switch"
                                        data-on={autoTranscribe}
                                        onClick={alternarAuto}
                                    >
                                        <div className="switch-dot" />
                                    </div>
                                </div>

                                <div className="settings-menu-title">Tema</div>
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

                                <div className="settings-menu-title">Segurança</div>
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
                <div className="page-header">
                    <h1>Painel do Transcritor</h1>
                    <div className="subtitle" style={{ marginBottom: 0 }}>
                        Áudios enviados pela extensão e status da transcrição
                    </div>
                </div>

                <div className="stats-grid">
                <div
                    className="stat-card stat-card-clickable"
                    data-active={statusFilter === "all"}
                    onClick={() => setStatusFilter("all")}
                >
                    <div className="stat-card-icon">📁</div>
                    <div>
                        <div className="stat-card-value">{rows.length}</div>
                        <div className="stat-card-label">Arquivos enviados</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-card-icon">👤</div>
                    <div>
                        <div className="stat-card-value">
                            {new Set(rows.map((r) => r.uploaded_by).filter(Boolean)).size}
                        </div>
                        <div className="stat-card-label">Usuários</div>
                    </div>
                </div>

                <div
                    className="stat-card stat-card-clickable"
                    data-active={statusFilter === "completed"}
                    onClick={() => setStatusFilter("completed")}
                >
                    <div className="stat-card-icon">✅</div>
                    <div>
                        <div className="stat-card-value">
                            {rows.filter((r) => r.status === "completed").length}
                        </div>
                        <div className="stat-card-label">Transcrições concluídas</div>
                    </div>
                </div>

                <div
                    className="stat-card stat-card-clickable"
                    data-active={statusFilter === "pending"}
                    onClick={() => setStatusFilter("pending")}
                >
                    <div className="stat-card-icon">⏳</div>
                    <div>
                        <div className="stat-card-value">
                            {rows.filter((r) => r.status !== "completed").length}
                        </div>
                        <div className="stat-card-label">Pendentes</div>
                    </div>
                </div>
            </div>

            <div className="card worker-panel">
                <div className="worker-stat">
                    <div className="worker-stat-icon">
                        <span className={`dot ${workerOnline ? (worker.status === "processing" ? "dot-processing" : "dot-online") : "dot-offline"}`} />
                    </div>
                    <div>
                        <div className="worker-stat-label">Transcritor</div>
                        <div className="worker-stat-value">
                            {!worker
                                ? "Nunca conectado"
                                : workerOnline
                                ? (worker.status === "processing" ? "Processando" : "Online")
                                : "Offline"}
                        </div>
                    </div>
                </div>

                <div className="worker-stat">
                    <div className="worker-stat-icon">🖥️</div>
                    <div>
                        <div className="worker-stat-label">GPU</div>
                        <div className="worker-stat-value">
                            {worker?.gpu_name || "—"}
                        </div>
                    </div>
                </div>

                <div className="worker-stat">
                    <div className="worker-stat-icon">🏷️</div>
                    <div>
                        <div className="worker-stat-label">Versão</div>
                        <div className="worker-stat-value">
                            {worker?.worker_version || "—"}
                        </div>
                    </div>
                </div>
            </div>

            <div className="card">
                {loading ? (
                    <div className="empty">Carregando...</div>
                ) : rowsFiltradas.length === 0 ? (
                    <div className="empty">Nenhum áudio encontrado para esse filtro.</div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Curso / Módulo / Aula</th>
                                <th>Arquivo</th>
                                <th>Enviado por</th>
                                <th>Status do áudio</th>
                                <th>Transcrição</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rowsFiltradas.map((row) => {
                                const job = row.transcription_jobs?.[0];
                                const podeTranscrever =
                                    job &&
                                    job.status === "pending" &&
                                    !job.manual_requested &&
                                    !autoTranscribe;

                                return (
                                    <tr key={row.id}>
                                        <td>
                                            <div className="lesson-title">
                                                {row.courses?.name || "—"}
                                            </div>
                                            <div className="lesson-meta">
                                                {row.modules
                                                    ? `Módulo ${row.modules.module_number} — ${row.modules.name}`
                                                    : "—"}
                                            </div>
                                            <div className="lesson-meta">
                                                {row.lessons
                                                    ? `${row.lessons.lesson_number} — ${row.lessons.title}`
                                                    : "—"}
                                            </div>
                                        </td>
                                        <td>
                                            <span
                                                className="filename-link"
                                                onClick={() => window.open(`/transcricao/${row.id}`, "_blank")}
                                            >
                                                {row.filename}
                                            </span>
                                        </td>
                                        <td>{row.profiles?.display_name || "—"}</td>
                                        <td>
                                            <span className={`badge badge-${row.status}`}>
                                                {STATUS_LABEL[row.status] || row.status}
                                            </span>
                                        </td>
                                        <td style={{ minWidth: 160 }}>
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
                                                                {(job.progress_percent || 0).toFixed(0)}%
                                                            </div>
                                                        </>
                                                    )}

                                                    {job.attempts > 0 && (
                                                        <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>
                                                            tentativas: {job.attempts}
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
                                        </td>
                                        <td>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                                                {job && job.status === "pending" && (
                                                    <button
                                                        className="btn-small"
                                                        disabled={
                                                            autoTranscribe ||
                                                            job.manual_requested ||
                                                            busyIds[job.id]
                                                        }
                                                        onClick={() => transcreverAgora(job.id)}
                                                    >
                                                        {job.manual_requested
                                                            ? "Na fila"
                                                            : "Transcrever agora"}
                                                    </button>
                                                )}

                                                <button
                                                    className="btn-small btn-danger"
                                                    onClick={() => pedirExclusao(row)}
                                                    title="Excluir arquivo"
                                                >
                                                    🗑️ Excluir
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            </main>

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
