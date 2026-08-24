import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
