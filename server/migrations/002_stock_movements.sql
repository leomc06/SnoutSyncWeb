CREATE TABLE IF NOT EXISTS produto_movimentacao (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA', 'AJUSTE')),
  quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
  estoque_anterior INTEGER NOT NULL CHECK (estoque_anterior >= 0),
  estoque_novo INTEGER NOT NULL CHECK (estoque_novo >= 0),
  motivo VARCHAR(180),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_produto_movimentacao_produto_created ON produto_movimentacao (produto_id, created_at DESC);
