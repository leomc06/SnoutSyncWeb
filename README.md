# SnoutSync Web

Sistema web full stack para gestão de pet shops, banho e tosa, baseado no projeto `github.com/leomc06/SnoutSync-atualizado` e evoluído para uma arquitetura React + Node.js/Express + PostgreSQL.

## Funcionalidades

- Autenticação com JWT e senha com `bcrypt`.
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
  src/
    config/env.js
    database/ensureSchema.js
    middlewares/auth.js
    middlewares/errors.js
    middlewares/security.js
    utils/http.js
    utils/validators.js
    db.js
    index.js
  test/api.test.js
```

## Rodar Localmente

```bash
npm run install:all
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- Health check: `http://localhost:3001/api/health`

Testes:

```bash
npm test
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
- Queries SQL parametrizadas.
- Respostas de erro sem stack trace em produção.
- `requestId` por requisição para rastreabilidade.

Melhorias futuras de segurança:

- Refresh token com rotação.
- Logout server-side com blacklist curta.
- Política de senha forte.
- Recuperação de senha por e-mail.
- Auditoria de ações sensíveis.
- Controle de permissões por perfil em endpoints administrativos.

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

- Migrations versionadas com ferramenta dedicada.
- Constraint de telefone único opcional por negócio.
- Tabela de profissionais/banhistas.
- Tabela de despesas reais.
- Tabela de estoque/produtos.
- Auditoria de alterações por usuário.

## UX/UI

Melhorias já aplicadas:

- Componentes UI reutilizáveis.
- Sidebar clara por módulo.
- Cards de métricas e tabelas responsivas.
- Modais para edição e conclusão de atendimento.
- Baixa de relatórios direto na tela Financeiro.

Melhorias futuras:

- Calendário semanal/diário drag-and-drop.
- Busca global no topo.
- Toasts de sucesso/erro.
- Skeleton loading.
- Design system com tokens de cor, espaçamento e tipografia.
- Formulários com mensagens por campo.

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
