# SnoutSync Web

Sistema web full stack para gestão de pet shops, banho e tosa, baseado no projeto `github.com/leomc06/SnoutSync-atualizado` e evoluído para uma arquitetura React + Node.js/Express + PostgreSQL.

## Funcionalidades

- Autenticação com JWT e senha com `bcrypt`.
- Refresh token com rotacao, logout server-side e blacklist curta de access tokens.
- Recuperacao de senha com token temporario e adapter mock de e-mail.
- Auditoria de acoes sensiveis e middleware de permissao por perfil.
- Migração automática de senha antiga em texto puro para hash no primeiro login válido.
- Dashboard com métricas operacionais e financeiras.
- CRUD de clientes, pets, planos, serviços e agendamentos.
- Serviços com preço e duração por porte do pet.
- Validação de conflito de horários na agenda.
- Conclusão de atendimento com valor cobrado e forma de pagamento.
- Histórico do pet com atendimentos, agendamentos e notas automáticas.
- Financeiro com receitas, despesas estimadas, lucro e lançamentos.
- Relatórios financeiros em CSV e PDF.
- IA em `/api/ai/ask`, com LLM configurável e contexto seguro do PostgreSQL.
- Consultas SQL da IA limitadas por whitelist, sem execução de SQL livre gerado pela IA.
- Segurança HTTP com `helmet`, `cors`, `compression` e `express-rate-limit`.
- Índices PostgreSQL criados automaticamente para consultas principais.

## Estrutura

```text
client/
  src/
    components/ui.jsx
    api.js
    App.jsx
    main.jsx
    styles.css
  server/
  migrations/
    000_base_schema.sql
    001_security_and_domain_tables.sql
  src/
    config/env.js
    database/ensureSchema.js
    database/migrate.js
    middlewares/auth.js
    middlewares/errors.js
    middlewares/security.js
    utils/http.js
    utils/validators.js
    services/email.js
    db.js
    index.js
  test/api.test.js
```

## Rodar Localmente

```bash
npm run install:all
npm run migrate
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- Health check: `http://localhost:3001/api/health`

Testes:

```bash
npm test
```

Lint/verificacao sintatica:

```bash
npm run lint
```

Build:

```bash
npm run build
```

## Variáveis De Ambiente

Use `.env.example` como base.

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5423/SnoutSync
NODE_ENV=development
API_PORT=3001
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=um_segredo_longo_e_privado
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_EXPIRES_DAYS=14
PASSWORD_RESET_EXPIRES_MINUTES=30
FRONTEND_URL=http://localhost:5173
AI_API_KEY=
AI_MODEL=gpt-5.5
AI_BASE_URL=https://api.openai.com/v1
```

Em produção, `DATABASE_URL` e `JWT_SECRET` são obrigatórios e validados no bootstrap da API.

## Login De Desenvolvimento

- Usuário: `leonardo`
- Senha: `TROCAR_SENHA`

Também existe o usuário `atendente` com a mesma senha no seed atual.

## API

As rotas protegidas usam `Authorization: Bearer <token>`.

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `POST /api/auth/change-password`
- `GET /api/admin/audit-logs` (`ADMIN`)
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

Respostas JSON novas seguem o envelope:

```json
{ "success": true, "data": {} }
```

Erros seguem:

```json
{ "error": "Mensagem", "code": "BAD_REQUEST", "details": null, "requestId": "..." }
```

## Análise Técnica

### O Que Está Bom

- O domínio principal do pet shop já está bem representado: clientes, pets, serviços, agenda, atendimento e financeiro.
- O uso de PostgreSQL com enums reduz inconsistências em campos críticos.
- A IA já trabalha com contexto do banco, sem expor SQL livre.
- O frontend é simples, direto e responsivo para desktop/mobile.
- A API usa queries parametrizadas, reduzindo risco de SQL injection.

### Principais Problemas Encontrados

- `server/src/index.js` concentrava configuração, middlewares, autenticação, validação, queries, regras de negócio e rotas.
- `client/src/App.jsx` concentrava telas e componentes reutilizáveis.
- Não havia headers de segurança, compressão HTTP nem rate limit.
- O erro da API não tinha `requestId`, código de erro ou formato padronizado.
- Índices importantes do PostgreSQL não eram criados explicitamente.
- Configurações críticas de produção não eram validadas no bootstrap.
- Relatórios e rotas protegidas dependiam de padrões mistos de resposta.

### O Que Foi Refatorado

- Configuração de ambiente em `server/src/config/env.js`.
- Autenticação JWT em `server/src/middlewares/auth.js`.
- Segurança HTTP em `server/src/middlewares/security.js`.
- Erros centralizados em `server/src/middlewares/errors.js`.
- Validações em `server/src/utils/validators.js`.
- Helpers HTTP em `server/src/utils/http.js`.
- Preparação de schema/índices em `server/src/database/ensureSchema.js`.
- Componentes React reutilizáveis em `client/src/components/ui.jsx`.

### O Que Pode Quebrar Em Produção

- Uso de `JWT_SECRET` fraco ou padrão.
- Banco sem backups e sem migrations versionadas.
- Falta de HTTPS no proxy/reverse proxy.
- Faturamento ainda estimado para despesas; despesas reais ainda não têm módulo próprio.
- IA externa pode falhar por cota, timeout ou chave inválida; por isso há fallback local.
- Conflito de horários considera duração do serviço, mas ainda não considera profissionais/salas/banhistas.

## Segurança

- `helmet` para headers HTTP.
- `express-rate-limit` para API e login.
- CORS com origem configurável por ambiente.
- JWT com expiração configurável.
- `bcrypt` para senha.
- Access token JWT curto configuravel por `JWT_EXPIRES_IN`.
- Refresh token opaco armazenado apenas com hash em `refresh_token`.
- Rotacao de refresh token a cada renovacao de sessao.
- Logout server-side com revogacao do refresh token e blacklist de access token por `jti`.
- Tokens temporarios de recuperacao de senha com expiracao.
- Auditoria em `audit_log`.
- Autorizacao por perfil com `requireRole`.
- Queries SQL parametrizadas.
- Respostas de erro sem stack trace em produção.
- `requestId` por requisição para rastreabilidade.

Melhorias futuras de segurança:

- Configurar envio real de e-mail no adapter `server/src/services/email.js`.
- Aplicar matriz de permissoes por perfil em mais endpoints administrativos quando a regra de negocio estiver definida.
- Reduzir `JWT_EXPIRES_IN` em producao e usar HTTPS obrigatorio no proxy.

## PostgreSQL

Índices criados automaticamente:

- `pet(cliente_id)`
- `plano(cliente_id)`
- `agendamento(data, hora)`
- `agendamento(pet_id, data)`
- `agendamento(status)`
- `atendimento(agendamento_id)`
- `historico_pet(pet_id, criado_em DESC)`
- `LOWER(cliente.nome)`
- `LOWER(pet.nome)`

Melhorias futuras no banco:

- Constraint de telefone unico opcional por negocio, apos limpeza de duplicidades.
- CRUDs para profissionais/banhistas, despesas reais e produtos.
- Auditoria detalhada por campo alterado.

## UX/UI

Melhorias já aplicadas:

- Componentes UI reutilizáveis.
- Sidebar clara por módulo.
- Cards de métricas e tabelas responsivas.
- Modais para edição e conclusão de atendimento.
- Baixa de relatórios direto na tela Financeiro.
- Busca global no topo.
- Toasts de sucesso/erro.
- Skeleton loading.
- Tokens de design em CSS.
- Mensagens de erro por campo quando a API retorna `details.field`.
- Calendario operacional preparado para drag-and-drop.

Melhorias futuras:

- Persistir drag-and-drop na agenda com validacao por profissional/sala.
- Evoluir a busca global para consultar clientes, pets e agendamentos na API.
- Separar componentes de formulario em biblioteca interna.

## Docker

Crie um `.env` a partir de `.env.example` e suba o ambiente completo:

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- PostgreSQL: porta definida por `POSTGRES_PORT`

## Migrations

As migrations rodam automaticamente no bootstrap da API e tambem podem ser executadas manualmente:

```bash
npm run migrate
```

Arquivos versionados ficam em `server/migrations/` e execucoes aplicadas sao registradas em `schema_migrations`.

## Roadmap

### Curto Prazo

- Criar módulo de profissionais.
- Criar despesas reais no financeiro.
- Melhorar agenda em visão calendário.
- Criar permissões por perfil `ADMIN` e `ATENDENTE`.
- Adicionar toasts e estados de loading por botão.

### Médio Prazo

- Migrations versionadas.
- CI/CD com build, testes e lint.
- Dockerfile para frontend/backend.
- Observabilidade com logs estruturados.
- Relatórios por período e por serviço.
- Notificações por WhatsApp/e-mail.

### Longo Prazo

- Multiempresa/multilojas.
- Assinaturas e planos recorrentes.
- Estoque e produtos.
- Prontuário avançado do pet.
- Painel de BI com sazonalidade e previsão de demanda.

## Checklist De Produção

- Definir `NODE_ENV=production`.
- Definir `DATABASE_URL` com usuário de menor privilégio.
- Definir `JWT_SECRET` forte.
- Usar HTTPS no proxy.
- Configurar `CORS_ORIGIN` com domínio real.
- Configurar backup do PostgreSQL.
- Rodar `npm test` e `npm run build` no CI.
- Monitorar logs com `requestId`.
- Configurar variáveis de IA somente no servidor.
- Não versionar `.env`.
