// Cliente de Supabase (backend compartido de SIT EBEMA)
// La clave publishable es pública por diseño: los datos están protegidos
// por Row Level Security (solo usuarios autenticados @ebema.cl).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bWhva3Zkb3dmcWljam9wYmhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMjEwNjcsImV4cCI6MjA5Njc5NzA2N30.E8FpnZJgFrmmQBTohnbMjxaY5lXVxKS9WpFz415Dwe4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
