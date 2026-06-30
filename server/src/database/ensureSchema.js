import { query } from '../db.js';

export async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS historico_pet (
      id SERIAL PRIMARY KEY,
      pet_id INTEGER NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
      agendamento_id INTEGER REFERENCES agendamento(id) ON DELETE SET NULL,
      tipo VARCHAR(50) NOT NULL,
      descricao TEXT NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_pet_cliente_id ON pet (cliente_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_plano_cliente_id ON plano (cliente_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_agendamento_data_hora ON agendamento (data, hora)');
  await query('CREATE INDEX IF NOT EXISTS idx_agendamento_pet_data ON agendamento (pet_id, data)');
  await query('CREATE INDEX IF NOT EXISTS idx_agendamento_status ON agendamento (status)');
  await query('CREATE INDEX IF NOT EXISTS idx_atendimento_agendamento_id ON atendimento (agendamento_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_historico_pet_criado ON historico_pet (pet_id, criado_em DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_cliente_nome_lower ON cliente (LOWER(nome))');
  await query('CREATE INDEX IF NOT EXISTS idx_pet_nome_lower ON pet (LOWER(nome))');
}
