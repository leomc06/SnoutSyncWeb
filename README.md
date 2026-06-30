# SnoutSync Web

Sistema web para pet shop baseado no projeto `github.com/leomc06/SnoutSync-atualizado`, agora com frontend React, backend Node/Express e PostgreSQL.

## O que foi implementado

- Login usando a tabela `usuario`.
- Dashboard com métricas, agendamentos do dia e faturamento estimado.
- CRUD de clientes e pets usando `cliente`, `pet` e `plano`.
- CRUD de agendamentos usando `agendamento`, `pet` e `servico`.
- Financeiro com receitas, despesas estimadas, lucro e lançamentos.
- IA em `/api/ai/ask`, respondendo perguntas gerais quando houver LLM configurada e usando contexto do PostgreSQL conectado.

## Rodar o sistema

```bash
npm run install:all
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001/api`
- Health check: `http://localhost:3001/api/health`

Credenciais do seed original:

- Usuário: `leonardo`
- Senha: `TROCAR_SENHA`

Também existe o usuário `atendente` com a mesma senha `TROCAR_SENHA`.

## Banco

A API usa `DATABASE_URL` do arquivo `.env` na raiz. O mesmo `.env` continua servindo ao MCP PostgreSQL configurado no `opencode.json`, então a IA do servidor pode continuar consultando o banco conectado.

## IA

Sem chave de IA, o sistema usa um fallback local limitado a perguntas sobre clientes, agenda, financeiro e melhorias.

Para responder perguntas abertas, configure uma API OpenAI-compatível no `.env`:

```env
AI_API_KEY=sua_chave
AI_MODEL=gpt-5.5
AI_BASE_URL=https://api.openai.com/v1
```

A rota `/api/ai/ask` envia para a LLM um resumo seguro do PostgreSQL conectado: métricas, financeiro, clientes, serviços e últimos agendamentos. Ela não executa SQL livre gerado pela IA.
