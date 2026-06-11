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
    └── hash-password.js  Gera bcrypt hash da senha
```

## Próximas sub-fases

- **3b**: migrar entidade `weights` para a API
- **3c**: migrar entidades restantes + import JSON inicial
