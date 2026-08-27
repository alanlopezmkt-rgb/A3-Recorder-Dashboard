import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase, ADMIN_EMAIL } from "../../lib/supabaseClient";

export default function Transcricao() {
    const router = useRouter();
    const { id } = router.query;

    const [session, setSession] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [notFound, setNotFound] = useState(false);

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

    useEffect(() => {
        if (!id || session === undefined || !session || session.user.email !== ADMIN_EMAIL) {
            return;
        }

        async function carregar() {
            const { data: audio } = await supabase
                .from("audio_files")
                .select(
                    `
                    id,
                    filename,
                    lessons ( title, lesson_number ),
                    modules ( name, module_number ),
                    courses ( name ),
                    transcriptions ( text, created_at )
                    `
                )
                .eq("id", id)
                .maybeSingle();

            if (!audio) {
                setNotFound(true);
            } else {
                setData(audio);
            }

            setLoading(false);
        }

        carregar();
    }, [id, session]);

    if (session === undefined || loading) {
        return null;
    }

    if (!session || session.user.email !== ADMIN_EMAIL) {
        return (
            <div className="wrap">
                <div className="card empty">Acesso restrito ao administrador.</div>
            </div>
        );
    }

    if (notFound || !data) {
        return (
            <div className="wrap">
                <div className="card empty">Áudio não encontrado.</div>
            </div>
        );
    }

    const transcript = data.transcriptions?.[0];

    return (
        <div className="wrap">
            <div className="topbar">
                <div className="brand">
                    <div className="brand-badge">A3</div>
                    <div>
                        <h1>{data.lessons ? `${data.lessons.lesson_number} — ${data.lessons.title}` : data.filename}</h1>
                        <div className="subtitle" style={{ marginBottom: 0 }}>
                            {data.courses?.name || "—"}
                            {data.modules ? ` · Módulo ${data.modules.module_number} — ${data.modules.name}` : ""}
                            {" · "}
                            {data.filename}
                        </div>
                    </div>
                </div>

                <button className="btn-secondary" onClick={() => window.close()}>
                    Fechar
                </button>
            </div>

            <div className="card">
                {!transcript ? (
                    <div className="empty">Transcrição ainda não disponível para este áudio.</div>
                ) : (
                    <div className="transcript-text">{transcript.text}</div>
                )}
            </div>
        </div>
    );
}
