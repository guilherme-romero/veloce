# Treino Bike — Backend (server/)

Backend Fastify + SQLite + auth single-user.

## Setup inicial

### 1. Instalar Node.js 18+ (Ubuntu)

```bash
sudo apt update && sudo apt install -y nodejs npm
node --version   # deve ser >= 18
```

### 2. Instalar dependências

```bash
cd server
npm install
```

### 3. Configurar `.env`

```bash
cp .env.example .env
```

Gerar segredo do JWT:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Cole o output em `JWT_SECRET=...` no `.env`.

Gerar hash da senha:

```bash
npm run hash-password "suaSenhaForte123!"
```

Cole o output em `ADMIN_PASS_HASH=$2b$12$...` no `.env`.

### 4. Subir o servidor

```bash
npm start
# ou em modo watch (dev)
npm run dev
```

Deve imprimir `Treino Bike API rodando em http://127.0.0.1:3000`.

### 5. Configurar nginx (proxy /api → :3000)

Edite `/etc/nginx/sites-enabled/treino_bike` adicionando **antes** do `location / { ... }`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Sem cache em /api/*
    add_header Cache-Control "no-store" always;
}
```

Recarregar:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Testar

1. Abrir `http://<host>:8002/login.html` → tela de login
2. Logar com `ADMIN_USER` e a senha bruta (não o hash)
3. Cookie `tb_session` setado → redireciona para `/index.html`
4. Botão "Sair" no header → POST /api/auth/logout → volta pro login

## Instância de demonstração (subdomínio)

Instância isolada com login `user`/`user` e **dados mockados**, para
apresentar o projeto sem expor dados reais. Roda um 2º backend na porta
**3001** apontando para `data/demo.db`, exposto em
`demo.bike.arkhamcloud.net`. Reaproveita todo o código: `config.js` aceita
`ENV_FILE`, `DB_PATH`, `COOKIE_NAME`, `COOKIE_PATH` por ambiente.

### 1. Gerar o banco demo

```bash
cd server
DB_PATH="$PWD/../data/demo.db" node scripts/seed-demo.js
```

Popula perfil "Ciclista Demo", pesagens, treinos, bikes e passeios
fictícios. Idempotente (zera e re-insere). Recusa rodar sobre `training.db`.

### 2. Criar `.env.demo`

```bash
cp .env.demo.example .env.demo
# gere o hash de "user" (ou outra senha) e o JWT_SECRET:
node -e "require('./utils/password').hash('user').then(console.log)"
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Sem chaves Strava/Garmin → integrações aparecem como "desconectado". O
`ENV_FILE` no systemd garante que esta instância **nunca** carrega o
`server/.env` de produção.

### 3. Habilitar o serviço systemd

```bash
sudo cp treino-bike-demo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now treino-bike-demo
sudo systemctl status treino-bike-demo --no-pager -n 5   # porta 3001
```

### 4. nginx — server block do subdomínio

Novo arquivo `/etc/nginx/sites-enabled/treino_bike_demo` (mesmo webroot dos
estáticos; `/api/` → :3001):

```nginx
server {
    listen 80;
    server_name demo.bike.arkhamcloud.net;
    root /caminho/para/o/webroot;   # mesmo dos estáticos de produção
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-store" always;
    }

    location / { try_files $uri $uri/ /index.html; }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5. DNS (Cloudflare)

Adicionar registro (A/CNAME **proxied**) `demo` → mesmo destino de
`bike.arkhamcloud.net`. Como o cookie é host-only ao subdomínio, logar no
demo não desloga a sessão real.

### Re-seed / atualizar dados demo

```bash
DB_PATH="$PWD/../data/demo.db" node scripts/seed-demo.js
sudo systemctl restart treino-bike-demo
```

## Arquitetura

```
server/
├── index.js              Bootstrap Fastify
├── config.js             Lê e valida .env
├── db/
│   ├── init.js           Abre training.db + roda schema
│   └── schema-training.sql
├── middleware/
│   └── auth.js           Verifica JWT no cookie
├── routes/
│   └── auth.js           POST /login, /logout · GET /me
├── utils/
│   └── password.js       bcrypt wrapper
└── scripts/
    ├── hash-password.js  Gera bcrypt hash da senha
    └── seed-demo.js      Popula demo.db (instância de demonstração)
```

## Próximas sub-fases

- **3b**: migrar entidade `weights` para a API
- **3c**: migrar entidades restantes + import JSON inicial
