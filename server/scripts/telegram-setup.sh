#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# telegram-setup.sh — wizard de setup do bot do Telegram (#95, Fase 2)
#
# Guia a criação do bot no BotFather, captura o chat_id e grava
# TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no server/.env. Idempotente: roda de
# novo sem duplicar linhas. Usa curl + node (sem jq).
#
# Uso:  cd server && bash scripts/telegram-setup.sh
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

say()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

command -v curl >/dev/null || { err "curl não encontrado."; exit 1; }
command -v node >/dev/null || { err "node não encontrado."; exit 1; }

# Extrai um campo JSON simples da resposta da Bot API via node (sem jq).
json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const v=process.argv[1].split(".").reduce((a,k)=>a&&a[k],o);process.stdout.write(v==null?"":String(v))}catch(e){}})' "$1"; }

say "═══ Setup do relatório mensal no Telegram ═══"
cat <<'EOF'

1) No Telegram, abra @BotFather e envie /newbot. Escolha um nome e um
   username (terminando em "bot"). O BotFather devolve um TOKEN parecido com:
       123456789:AAH...xyz
EOF

read -rp $'\nCole o TOKEN do bot: ' TOKEN
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -n "$TOKEN" ] || { err "Token vazio."; exit 1; }

say "Validando o token (getMe)…"
ME="$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getMe" || true)"
OK="$(printf '%s' "$ME" | json_field ok)"
if [ "$OK" != "true" ]; then
  err "Token inválido ou sem rede. Resposta: $ME"
  exit 1
fi
BOT_USER="$(printf '%s' "$ME" | json_field result.username)"
say "Bot OK: @${BOT_USER}"

cat <<EOF

2) Abra o chat https://t.me/${BOT_USER} e envie qualquer mensagem (ex.: /start).
   Isso permite ao bot descobrir o seu chat_id.
EOF
read -rp $'\nJá enviou a mensagem? Enter para capturar o chat_id… ' _

say "Capturando o chat_id (getUpdates)…"
CHAT_ID=""
for i in $(seq 1 10); do
  UP="$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getUpdates" || true)"
  CHAT_ID="$(printf '%s' "$UP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const r=(o.result||[]);for(let i=r.length-1;i>=0;i--){const m=r[i].message||r[i].channel_post;if(m&&m.chat&&m.chat.id!=null){process.stdout.write(String(m.chat.id));break}}}catch(e){}})')"
  [ -n "$CHAT_ID" ] && break
  warn "  nada ainda… (tentativa $i/10) — envie uma mensagem ao bot e aguarde."
  sleep 3
done
[ -n "$CHAT_ID" ] || { err "Não consegui capturar o chat_id. Envie uma mensagem ao bot e rode de novo."; exit 1; }
say "chat_id capturado: ${CHAT_ID}"

# Grava no .env (substitui a linha se já existir; senão, acrescenta).
touch "$ENV_FILE"
upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # usa | como delimitador (token não contém |)
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}
upsert_env TELEGRAM_BOT_TOKEN "$TOKEN"
upsert_env TELEGRAM_CHAT_ID "$CHAT_ID"
say "Gravado em $ENV_FILE"

say "Enviando mensagem de teste…"
TEST="$(curl -fsS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=✅ Veloce Labs conectado. Você receberá o relatório mensal aqui." || true)"
if [ "$(printf '%s' "$TEST" | json_field ok)" = "true" ]; then
  say "Tudo pronto! Verifique a mensagem no Telegram."
else
  warn "Gravei o .env, mas a mensagem de teste falhou: $TEST"
fi

cat <<'EOF'

Próximos passos:
  • Reinicie o backend para carregar o .env:  sudo systemctl restart veloce-api
  • No app, abra o Perfil e ligue "Enviar o resumo mensal pelo Telegram".
  O envio automático acontece todo dia 1º, às 8h.
EOF
