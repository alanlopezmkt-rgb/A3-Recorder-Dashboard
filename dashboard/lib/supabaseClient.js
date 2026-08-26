import { createClient } from "@supabase/supabase-js";

export const REMEMBER_ME_KEY = "a3os_remember_me";

// Guarda a sessao em localStorage (sobrevive ao fechar o navegador) quando
// "Lembrar-me" esta marcado, ou em sessionStorage (some ao fechar) quando
// nao esta. A escolha e lida no momento de gravar, entao precisa ser
// definida em localStorage.setItem(REMEMBER_ME_KEY, ...) ANTES do login.
const authStorage = {
    getItem: (key) => {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    },
    setItem: (key, value) => {
        if (typeof window === "undefined") return;
        const lembrar = window.localStorage.getItem(REMEMBER_ME_KEY) !== "false";
        if (lembrar) {
            window.localStorage.setItem(key, value);
            window.sessionStorage.removeItem(key);
        } else {
            window.sessionStorage.setItem(key, value);
            window.localStorage.removeItem(key);
        }
    },
    removeItem: (key) => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
    }
};

export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
        auth: {
            storage: authStorage,
            persistSession: true,
            autoRefreshToken: true
        }
    }
);

export const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
