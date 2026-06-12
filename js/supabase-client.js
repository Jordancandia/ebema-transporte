// Cliente de Supabase (backend compartido de SIT EBEMA)
// La clave publishable es pública por diseño: los datos están protegidos
// por Row Level Security (solo usuarios autenticados @ebema.cl).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dLgQJv4W2TrzRVSpRHSG1g_yiPCvj99';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
