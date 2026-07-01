# SnoutSync Web

Sistema web full stack para gestao de pet shops, banho e tosa, evoluido para uma arquitetura com React, Node.js/Express e PostgreSQL.

## Stack

- Frontend: React 19 + Vite.
- Backend: Node.js + Express 5.
- Banco de dados: PostgreSQL.
- Autenticacao: JWT access token + refresh token opaco com rotacao.
- Seguranca HTTP: `helmet`, `cors`, `compression` e `express-rate-limit`.
- Relatorios: CSV e PDF.
- IA: endpoint com LLM configuravel e fallback local.
- Infra: Docker, Docker Compose e GitHub Actions.

## Funcionalidades

- Login com JWT e senhas com `bcryptjs`.
- Migracao automatica de senha antiga em texto puro para hash no primeiro login valido.
- Refresh token separado do access token, armazenado com hash no banco.
- Rotacao de refresh token em `/api/auth/refresh`.
- Logout server-side com revogacao de refresh token e blacklist curta de access token por `jti`.
- Recuperacao de senha com token temporario, expiracao e adapter mock de e-mail.
- Politica de senha forte para troca e recuperacao de senha.
- Auditoria de acoes sensiveis em `audit_log`.
- Autorizacao por perfil com `requireRole`.
- Dashboard com metricas operacionais e financeiras.
- CRUD de clientes, pets, servicos e agendamentos.
- Validacao de conflito de horarios na agenda.
- Conclusao de atendimento com valor cobrado e forma de pagamento.
- Historico do pet com atendimentos, agendamentos e notas automaticas.
- Financeiro com receitas, despesas estimadas, lucro e lancamentos.
- Relatorios financeiros em CSV e PDF.
- IA em `/api/ai/ask`, com contexto seguro do PostgreSQL.
- UX com busca global, toasts, skeleton loading, erros por campo e calendario operacional preparado para drag-and-drop.

## Estrutura

```text
.
|-- client/
|   |-- Dockerfile
|   |-- nginx.conf
|   `-- src/
|       |-- components/ui.jsx
|       |-- api.js
|       |-- App.jsx
|       |-- main.jsx
|       `-- styles.css
|-- server/
|   |-- Dockerfile
|   |-- migrations/
|   |   |-- 000_base_schema.sql
|   |   `-- 001_security_and_domain_tables.sql
|   |-- src/
|   |   |-- config/env.js
|   |   |-- database/ensureSchema.js
|   |   |-- database/migrate.js
|   |   |-- middlewares/auth.js
|   |   |-- middlewares/errors.js
|   |   |-- middlewares/security.js
|   |   |-- services/email.js
|   |   |-- utils/audit.js
|   |   |-- utils/http.js
|   |   |-- utils/validators.js
|   |   |-- db.js
|   |   `-- index.js
|   `-- test/api.test.js
|-- scripts/check-syntax.js
|-- docker-compose.yml
|-- ROADMAP.md
`-- .env.example
```

## Requisitos

- Node.js 22 ou superior recomendado.
- npm.
- PostgreSQL local ou Docker.
- Docker e Docker Compose, caso use o ambiente containerizado.

## Variaveis De Ambiente

Crie um arquivo `.env` na raiz usando `.env.example` como base.

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=SnoutSync
POSTGRES_PORT=5423
DATABASE_URL=postgresql://postgres:postgres@localhost:5423/SnoutSync
NODE_ENV=development
API_PORT=3001
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3001/api
JWT_SECRET=troque-este-segredo-em-producao
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_EXPIRES_DAYS=14
PASSWORD_RESET_EXPIRES_MINUTES=30
FRONTEND_URL=http://localhost:5173
AI_API_KEY=
AI_MODEL=gpt-5.5
AI_BASE_URL=https://api.openai.com/v1
```

Em producao, configure obrigatoriamente `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN` e HTTPS no proxy/reverse proxy.

## Rodar Localmente

Instale as dependencias:

```bash
npm run install:all
```

Rode as migrations:

```bash
npm run migrate
```

Suba frontend e backend em modo desenvolvimento:

```bash
npm run dev
```

URLs locais:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- Health check: `http://localhost:3001/api/health`

## Rodar Com Docker

Crie o `.env` e suba o ambiente completo:

```bash
docker compose up --build
```

Servicos:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- PostgreSQL: porta definida em `POSTGRES_PORT`

## Scripts

- `npm run install:all`: instala dependencias da raiz, backend e frontend.
- `npm run dev`: sobe backend e frontend em desenvolvimento.
- `npm run migrate`: executa migrations versionadas.
- `npm run build`: gera build do frontend.
- `npm run lint`: verifica sintaxe dos arquivos do backend.
- `npm test`: executa testes do backend.
- `npm start`: inicia a API.

## Login De Desenvolvimento

- Usuario admin: `leonardo`
- Usuario atendente: `atendente`
- Senha inicial: `TROCAR_SENHA`

As senhas iniciais existem apenas para desenvolvimento. No primeiro login valido, senhas antigas em texto puro sao migradas para hash.

## Migrations

As migrations ficam em `server/migrations/` e sao registradas em `schema_migrations`.

Elas podem ser executadas manualmente:

```bash
npm run migrate
```

Tambem rodam no bootstrap da API via `ensureSchema()`, mantendo compatibilidade com o fluxo atual.

Tabelas adicionadas ou preparadas:

- `refresh_token`
- `revoked_token`
- `password_reset_token`
- `audit_log`
- `profissional`
- `despesa`
- `produto`

## API

Rotas publicas:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `GET /api/health`

Rotas protegidas usam `Authorization: Bearer <access_token>`:

- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/dashboard`
- `GET /api/clientes`
- `POST /api/clientes`
- `PUT /api/clientes/:clienteId/pets/:petId`
- `DELETE /api/clientes/:clienteId`
- `GET /api/pets`
- `GET /api/pets/:id/historico`
- `GET /api/servicos`
- `POST /api/servicos`
- `PUT /api/servicos/:id`
- `DELETE /api/servicos/:id`
- `GET /api/agendamentos`
- `POST /api/agendamentos`
- `PUT /api/agendamentos/:id`
- `DELETE /api/agendamentos/:id`
- `POST /api/agendamentos/:id/concluir`
- `GET /api/financeiro`
- `GET /api/relatorios/financeiro.csv`
- `GET /api/relatorios/financeiro.pdf`
- `GET /api/ai/status`
- `POST /api/ai/ask`

Rotas administrativas:

- `GET /api/admin/audit-logs`, restrita a `ADMIN`.

Resposta de sucesso:

```json
{ "success": true, "data": {} }
```

Resposta de erro:

```json
{ "error": "Mensagem", "code": "BAD_REQUEST", "details": null, "requestId": "..." }
```

## Seguranca

- Access token JWT assinado com `JWT_SECRET`.
- Access token inclui `jti` para permitir blacklist no logout.
- Refresh token opaco, separado do JWT e salvo apenas como SHA-256 no banco.
- Refresh token e rotacionado a cada renovacao.
- Refresh token antigo e invalidado ao gerar um novo.
- Logout revoga refresh token ativo e bloqueia access token ate sua expiracao.
- Tokens de recuperacao de senha sao temporarios e tambem salvos com hash.
- Senha forte exige minimo de 10 caracteres, letra maiuscula, letra minuscula, numero e caractere especial.
- Auditoria registra ator, acao, entidade, metadados, IP, user-agent e requestId.
- `requireRole` permite restringir endpoints por perfil.
- Queries usam parametros para reduzir risco de SQL injection.
- Erros nao expõem stack trace em producao.

## Frontend

- Componentes reutilizaveis em `client/src/components/ui.jsx`.
- Busca global no topo da aplicacao.
- Toasts de sucesso e erro.
- Skeleton loading.
- Tokens CSS de cor, espacamento e raio.
- Formularios exibem erro por campo quando a API retorna `details.field`.
- Calendario operacional em agendamentos com cartoes `draggable`, preparado para persistir drag-and-drop futuramente.

## IA

Configure `AI_API_KEY`, `AI_MODEL` e `AI_BASE_URL` para usar uma LLM externa.

Sem chave configurada, o sistema usa fallback local com dados seguros do PostgreSQL.

## CI/CD

O workflow `.github/workflows/ci.yml` executa:

- Instalacao de dependencias.
- Verificacao sintatica do backend com `npm run lint`.
- Build do frontend com `npm run build`.

## Checklist De Producao

- Definir `NODE_ENV=production`.
- Usar `JWT_SECRET` forte e privado.
- Usar `DATABASE_URL` com usuario de menor privilegio.
- Configurar `CORS_ORIGIN` com dominio real.
- Usar HTTPS no proxy/reverse proxy.
- Configurar backup do PostgreSQL.
- Configurar envio real de e-mail em `server/src/services/email.js`.
- Reduzir `JWT_EXPIRES_IN` conforme a politica de seguranca.
- Monitorar logs com `requestId`.
- Configurar variaveis de IA somente no servidor.
- Nunca versionar `.env`.

## Roadmap

Consulte `ROADMAP.md` para ver o que foi implementado, o que ficou preparado e a ordem recomendada de evolucao.
