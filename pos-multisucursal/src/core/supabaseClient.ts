import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './supabaseConfig';

export { supabaseAnonKey, supabaseUrl };

// Cliente seguro para componentes React en el navegador (solo usa anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// El servidor lee este token desde una cookie. Supabase renueva la sesión en
// localStorage, así que mantenemos la cookie sincronizada para evitar que el
// servidor siga recibiendo un JWT vencido mientras la sesión del navegador vive.
if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
      return;
    }

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax${secure}`;
    }
  });
}
