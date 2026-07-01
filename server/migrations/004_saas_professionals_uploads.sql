ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'GERENTE';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'BANHISTA';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'FINANCEIRO';

CREATE TABLE IF NOT EXISTS empresa_assinatura (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  plano VARCHAR(30) NOT NULL CHECK (plano IN ('FILHOTE', 'ADULTO', 'ALPHA')),
  status VARCHAR(30) NOT NULL DEFAULT 'ATIVA',
  limite_lojas INTEGER NOT NULL,
  limite_usuarios INTEGER NOT NULL,
  limite_agendamentos_mes INTEGER NOT NULL,
  data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fim DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_empresa_assinatura_ativa ON empresa_assinatura (empresa_id) WHERE status = 'ATIVA';

INSERT INTO empresa_assinatura (empresa_id, plano, limite_lojas, limite_usuarios, limite_agendamentos_mes)
SELECT e.id, 'FILHOTE', 1, 2, 200
  FROM empresa e
 WHERE NOT EXISTS (SELECT 1 FROM empresa_assinatura ea WHERE ea.empresa_id = e.id AND ea.status = 'ATIVA');

CREATE TABLE IF NOT EXISTS loja (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nome VARCHAR(180) NOT NULL,
  documento VARCHAR(40),
  email VARCHAR(160),
  endereco TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_loja_empresa_ativo ON loja (empresa_id, ativo, nome);

INSERT INTO loja (empresa_id, nome)
SELECT e.id, 'Matriz'
  FROM empresa e
 WHERE NOT EXISTS (SELECT 1 FROM loja l WHERE l.empresa_id = e.id);

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS loja_id INTEGER REFERENCES loja(id) ON DELETE SET NULL;
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS loja_id INTEGER REFERENCES loja(id) ON DELETE SET NULL;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS loja_id INTEGER REFERENCES loja(id) ON DELETE SET NULL;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS documento VARCHAR(40);
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS email VARCHAR(160);
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS cargo VARCHAR(80) DEFAULT 'BANHISTA';
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS especialidades JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS horario_inicio TIME;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS horario_fim TIME;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS dias_semana JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]'::jsonb;
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS profissional_id INTEGER REFERENCES profissional(id) ON DELETE SET NULL;

UPDATE usuario u SET loja_id = l.id FROM loja l WHERE u.loja_id IS NULL AND l.empresa_id = COALESCE(u.empresa_id, 1);
UPDATE profissional p SET loja_id = l.id FROM loja l WHERE p.loja_id IS NULL AND l.empresa_id = COALESCE(p.empresa_id, 1);
UPDATE agendamento a SET loja_id = l.id FROM loja l WHERE a.loja_id IS NULL AND l.empresa_id = COALESCE(a.empresa_id, 1);

CREATE INDEX IF NOT EXISTS idx_agendamento_profissional_data ON agendamento (profissional_id, data, hora);
CREATE INDEX IF NOT EXISTS idx_profissional_loja ON profissional (loja_id, ativo, nome);

CREATE TABLE IF NOT EXISTS cliente_telefone (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  numero VARCHAR(40) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'CELULAR',
  principal BOOLEAN NOT NULL DEFAULT false,
  whatsapp BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_telefone_cliente ON cliente_telefone (cliente_id);

INSERT INTO cliente_telefone (cliente_id, numero, principal, whatsapp)
SELECT c.id, c.telefone, true, true
  FROM cliente c
 WHERE c.telefone IS NOT NULL AND c.telefone <> ''
   AND NOT EXISTS (SELECT 1 FROM cliente_telefone ct WHERE ct.cliente_id = c.id AND ct.numero = c.telefone);

CREATE TABLE IF NOT EXISTS empresa_telefone (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  numero VARCHAR(40) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'COMERCIAL',
  principal BOOLEAN NOT NULL DEFAULT false,
  whatsapp BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loja_telefone (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES loja(id) ON DELETE CASCADE,
  numero VARCHAR(40) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'COMERCIAL',
  principal BOOLEAN NOT NULL DEFAULT false,
  whatsapp BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pet_medicacao (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  nome VARCHAR(160) NOT NULL,
  dosagem VARCHAR(120),
  frequencia VARCHAR(120),
  data_inicio DATE,
  data_fim DATE,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pet_alerta (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  tipo VARCHAR(80) NOT NULL DEFAULT 'GERAL',
  titulo VARCHAR(160) NOT NULL,
  descricao TEXT,
  severidade VARCHAR(30) NOT NULL DEFAULT 'MEDIA',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pet_anexo (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  nome_original VARCHAR(255) NOT NULL,
  arquivo VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  tamanho INTEGER,
  url TEXT NOT NULL,
  descricao TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pet_medicacao_pet ON pet_medicacao (pet_id, ativo);
CREATE INDEX IF NOT EXISTS idx_pet_alerta_pet ON pet_alerta (pet_id, ativo);
CREATE INDEX IF NOT EXISTS idx_pet_anexo_pet ON pet_anexo (pet_id, created_at DESC);
