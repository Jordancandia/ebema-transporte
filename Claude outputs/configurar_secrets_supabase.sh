#!/bin/bash
# Configura como secrets de Supabase (PRD: humhokvdowfqicjopbhf) las API keys
# que hoy están hardcodeadas en el código de google-distance y getapi-tolls.
#
# Alternativa sin CLI: Dashboard de Supabase → proyecto ebema-transporte →
# Edge Functions → Secrets → "Add secret", y cargar ahí las mismas dos
# variables con los mismos valores de abajo.
#
# Ejecutar UNA VEZ antes de avisarle a Claude que redespliegue
# google-distance y getapi-tolls — si no, esas funciones se quedan sin key
# y dejan de responder (el fallback hardcodeado ya se quitó del código).
#
# Uso (requiere Supabase CLI instalado y `supabase login` hecho antes):
#   bash configurar_secrets_supabase.sh

supabase secrets set --project-ref humhokvdowfqicjopbhf \
  GOOGLE_API_KEY="AIzaSyB_P9-2Nw0n3UNoswZPcz6l_YjtwyUJYZQ" \
  GETAPI_KEY="6c03747b-d980-42fc-b19f-e761547fbaf1"

echo "Listo. Avisa a Claude para que redespliegue google-distance y getapi-tolls."
