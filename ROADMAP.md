# Roadmap SnoutSync

## Implementado Agora

- Refresh token opaco separado do access token JWT, armazenado com hash no PostgreSQL.
- Rotacao de refresh token em `/api/auth/refresh`, invalidando o token anterior.
- Logout server-side em `/api/auth/logout`, revogando refresh token e adicionando o access token a uma blacklist curta por `jti`.
- Politica de senha forte para troca e recuperacao: minimo de 10 caracteres, maiuscula, minuscula, numero e caractere especial.
- Recuperacao de senha com token temporario, expiracao e adapter mock de e-mail em `server/src/services/email.js`.
- Auditoria em `audit_log` para login, refresh, logout, senha, CRUDs sensiveis, conclusao de atendimento e IA.
- Middleware de autorizacao por perfil e endpoint administrativo `/api/admin/audit-logs` restrito a `ADMIN`.
- Migrations SQL versionadas com runner dedicado em `server/src/database/migrate.js`.
- Tabelas novas: `refresh_token`, `revoked_token`, `password_reset_token`, `audit_log`, `profissional`, `despesa` e `produto`.
- Migration base idempotente para permitir subir ambiente novo com Docker.
- Frontend com refresh automatico de sessao, toasts, skeleton loading, busca global, tokens de design, erros por campo e calendario operacional preparado para drag-and-drop.
- Dockerfile do backend, Dockerfile do frontend com Nginx e `docker-compose.yml` completo.
- CI no GitHub Actions com instalacao, lint sintatico do backend e build do frontend.

## Preparado

- Adapter de e-mail pode ser substituido por SMTP, SES, Resend ou similar sem mudar os endpoints.
- Auditoria esta centralizada em `server/src/utils/audit.js` para ser chamada por novos modulos.
- RBAC esta centralizado em `requireRole`, pronto para separar permissoes por endpoint.
- Tabelas `profissional`, `despesa` e `produto` ja possuem campos de status, autoria e timestamps.
- Calendario visual usa cartoes `draggable`, pronto para persistir remarcacao em uma proxima etapa.
- Docker Compose ja separa banco, API e frontend.

## Proximos Passos

1. Configurar envio real de e-mail e template de recuperacao de senha.
2. Criar telas CRUD para profissionais, despesas reais e produtos/estoque.
3. Definir matriz de permissoes por perfil e aplicar RBAC progressivamente nos endpoints administrativos.
4. Implementar drag-and-drop real no calendario, considerando profissional/sala e conflito por recurso.
5. Adicionar constraint opcional de telefone unico somente apos decidir a regra de negocio e limpar duplicidades.
6. Evoluir financeiro para usar `despesa` real em vez de estimativa operacional.
7. Adicionar testes de integracao com banco PostgreSQL provisionado no CI.
8. Implantar logs estruturados com nivel, requestId, usuario e duracao da requisicao.
9. Adicionar notificacoes por WhatsApp/e-mail para lembretes de agenda.
10. Preparar multiempresa/multiloja com `tenant_id` nas tabelas principais.

## Longo Prazo

- Multiempresa e multilojas.
- Assinaturas, planos recorrentes e cobranca automatizada.
- Estoque completo com movimentacoes e alertas.
- Prontuario avancado do pet com anexos, vacinas e restricoes.
- BI com sazonalidade, previsao de demanda e cohort de clientes.
