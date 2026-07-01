CREATE TABLE IF NOT EXISTS empresa (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(180) NOT NULL,
  documento VARCHAR(40),
  telefone VARCHAR(40),
  email VARCHAR(160),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO empresa (id, nome)
VALUES (1, 'SnoutSync Demo')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('empresa', 'id'), GREATEST((SELECT MAX(id) FROM empresa), 1));

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE servico ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE profissional ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE despesa ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE produto ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresa(id) ON DELETE RESTRICT DEFAULT 1;

UPDATE usuario SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE cliente SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE servico SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE agendamento SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE profissional SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE despesa SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE produto SET empresa_id = 1 WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_usuario_empresa ON usuario (empresa_id);
CREATE INDEX IF NOT EXISTS idx_cliente_empresa ON cliente (empresa_id);
CREATE INDEX IF NOT EXISTS idx_servico_empresa ON servico (empresa_id);
CREATE INDEX IF NOT EXISTS idx_agendamento_empresa_data ON agendamento (empresa_id, data, hora);
CREATE INDEX IF NOT EXISTS idx_profissional_empresa ON profissional (empresa_id, ativo, nome);
CREATE INDEX IF NOT EXISTS idx_despesa_empresa_data ON despesa (empresa_id, data_vencimento, status);
CREATE INDEX IF NOT EXISTS idx_produto_empresa ON produto (empresa_id, ativo, nome);

CREATE TABLE IF NOT EXISTS pet_prontuario (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  alergias TEXT,
  restricoes TEXT,
  comportamento TEXT,
  observacoes_clinicas TEXT,
  peso_atual NUMERIC(8, 2),
  castrado BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  UNIQUE (pet_id)
);

CREATE TABLE IF NOT EXISTS pet_vacina (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  nome VARCHAR(160) NOT NULL,
  data_aplicacao DATE,
  data_reforco DATE,
  observacoes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pet_vacina_pet_reforco ON pet_vacina (pet_id, data_reforco);
