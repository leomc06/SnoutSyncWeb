import React, { useEffect, useState } from 'react';
import { api, API_URL } from './api.js';

const pages = [
  ['dashboard', 'Dashboard'],
  ['clientes', 'Clientes e Pets'],
  ['agendamentos', 'Agendamentos'],
  ['financeiro', 'Financeiro'],
  ['ia', 'IA e Consultas']
];

const emptyClient = {
  nome: '',
  telefone: '',
  tipo: 'AVULSO',
  pet_nome: '',
  especie: 'Cachorro',
  raca: '',
  peso: '',
  porte: 'M'
};

const emptySchedule = {
  pet_id: '',
  servico_id: '',
  data: new Date().toISOString().slice(0, 10),
  hora: '10:00',
  status: 'AGENDADO',
  observacoes: ''
};

function storedUser() {
  try {
    const stored = localStorage.getItem('snoutsync:user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    localStorage.removeItem('snoutsync:user');
    return null;
  }
}

function currency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function useApiData(path, deps = []) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    let ignore = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(path)
      .then((data) => {
        if (!ignore) setState({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message, data: null });
      });
    return () => {
      ignore = true;
    };
  }, deps);

  return state;
}

export default function App() {
  const [user, setUser] = useState(storedUser);
  const [page, setPage] = useState('dashboard');

  function login(nextUser) {
    localStorage.setItem('snoutsync:user', JSON.stringify(nextUser));
    setUser(nextUser);
  }

  function logout() {
    localStorage.removeItem('snoutsync:user');
    setUser(null);
  }

  if (!user) return <Login onLogin={login} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>S</span><strong>SnoutSync</strong></div>
        <nav>
          {pages.map(([key, label]) => (
            <button className={page === key ? 'active' : ''} key={key} onClick={() => setPage(key)}>{label}</button>
          ))}
        </nav>
        <div className="session">
          <small>{user.perfil}</small>
          <strong>{user.nome}</strong>
          <button onClick={logout}>Sair</button>
        </div>
      </aside>
      <main>
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'clientes' && <Clientes />}
        {page === 'agendamentos' && <Agendamentos />}
        {page === 'financeiro' && <Financeiro />}
        {page === 'ia' && <Assistant />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ usuario: 'leonardo', senha: 'TROCAR_SENHA' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: form });
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="logo-mark">S</div>
        <h1>SnoutSync</h1>
        <p>Sistema de gestao para pet shop, banho e tosa.</p>
        <div className="hero-list"><span>Agenda</span><span>Clientes</span><span>Financeiro</span><span>IA</span></div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Bem-vindo de volta</p>
        <h2>Acesse sua conta</h2>
        <label>Usuario<input value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} /></label>
        <label>Senha<input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></label>
        {error && <div className="alert">{error}</div>}
        <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
        <small>API: {API_URL}</small>
      </form>
    </div>
  );
}

function Header({ title, subtitle, action }) {
  return <header className="page-header"><div><p className="eyebrow">SnoutSync</p><h1>{title}</h1><span>{subtitle}</span></div>{action}</header>;
}

function Dashboard({ go }) {
  const { loading, error, data } = useApiData('/dashboard', []);
  if (loading) return <Loading title="Dashboard" />;
  if (error) return <ErrorMessage message={error} />;

  const metrics = data.metrics;
  return (
    <>
      <Header title="Dashboard" subtitle="Painel operacional conectado ao PostgreSQL." />
      <section className="metrics-grid">
        <Metric label="Agendamentos hoje" value={metrics.agendamentos_hoje} hint="Data atual" />
        <Metric label="Clientes cadastrados" value={metrics.clientes} hint="Base ativa" />
        <Metric label="Servicos realizados" value={metrics.servicos_realizados} hint="Nao cancelados" />
        <Metric label="Faturamento estimado" value={currency(metrics.faturamento_mes)} hint={`${metrics.planos_ativos} plano(s)`} />
      </section>
      <section className="two-columns">
        <div className="card">
          <div className="card-title"><h3>Agendamentos de hoje</h3><button onClick={() => go('agendamentos')}>Ver todos</button></div>
          <Rows rows={data.agendamentos_hoje} empty="Sem agendamentos hoje" render={(item) => (
            <div className="row" key={item.id}><strong>{item.hora}</strong><span>{item.pet_nome}</span><span>{item.servico_nome}</span><Badge text={item.status_label} /></div>
          )} />
        </div>
        <div className="card accent-card">
          <h3>Resumo financeiro</h3>
          <strong className="big-number">{currency(metrics.faturamento_mes)}</strong>
          <p>Receita estimada com planos e agendamentos nao cancelados.</p>
          <MiniBars values={data.receita_diaria} />
        </div>
      </section>
      <section className="quick-actions">
        <button onClick={() => go('agendamentos')}>Novo agendamento</button>
        <button onClick={() => go('clientes')}>Novo cliente</button>
        <button onClick={() => go('ia')}>Consultar IA</button>
      </section>
    </>
  );
}

function Clientes() {
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const { loading, error, data } = useApiData(`/clientes?search=${encodeURIComponent(search)}`, [search, reload]);

  async function remove(cliente) {
    if (!confirm(`Excluir ${cliente.nome} e seus registros relacionados?`)) return;
    await api(`/clientes/${cliente.cliente_id}`, { method: 'DELETE' });
    setReload((value) => value + 1);
  }

  return (
    <>
      <Header title="Clientes e Pets" subtitle="Cadastros espelhados do sistema original." action={<button className="primary" onClick={() => setEditing(emptyClient)}>+ Novo Cliente</button>} />
      <div className="toolbar"><input placeholder="Buscar cliente, pet, telefone ou raca" value={search} onChange={(e) => setSearch(e.target.value)} /><button onClick={() => setSearch('')}>Limpar</button></div>
      <div className="card table-card">
        {loading && <p>Carregando...</p>}
        {error && <ErrorMessage message={error} />}
        {data && <Rows rows={data} empty="Nenhum cliente encontrado" render={(item) => (
          <div className="table-row" key={`${item.cliente_id}-${item.pet_id}`}>
            <span><strong>{item.nome}</strong><small>{item.telefone || 'Sem telefone'}</small></span>
            <span>{item.pet_nome}<small>{item.raca || 'Raca nao informada'}</small></span>
            <span>{item.porte_label}</span>
            <Badge text={item.tipo_label} />
            <span className="actions"><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
          </div>
        )} />}
      </div>
      {editing && <ClientModal client={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload((v) => v + 1); }} />}
    </>
  );
}

function ClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyClient, ...client, tipo: client.tipo || 'AVULSO', porte: client.porte || 'M' });
  const isEdit = Boolean(client.cliente_id);

  async function submit(event) {
    event.preventDefault();
    const method = isEdit ? 'PUT' : 'POST';
    const path = isEdit ? `/clientes/${client.cliente_id}/pets/${client.pet_id}` : '/clientes';
    await api(path, { method, body: form });
    onSaved();
  }

  return <Modal title={isEdit ? 'Editar Cliente' : 'Novo Cliente'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
    <label>Telefone<input value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></label>
    <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="AVULSO">Avulso</option><option value="PLANO">Plano</option></select></label>
    <label>Pet<input required value={form.pet_nome} onChange={(e) => setForm({ ...form, pet_nome: e.target.value })} /></label>
    <label>Especie<input value={form.especie || ''} onChange={(e) => setForm({ ...form, especie: e.target.value })} /></label>
    <label>Raca<input value={form.raca || ''} onChange={(e) => setForm({ ...form, raca: e.target.value })} /></label>
    <label>Peso<input type="number" step="0.1" value={form.peso || ''} onChange={(e) => setForm({ ...form, peso: e.target.value })} /></label>
    <label>Porte<select value={form.porte} onChange={(e) => setForm({ ...form, porte: e.target.value })}><option value="P">Pequeno</option><option value="M">Medio</option><option value="G">Grande</option></select></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function Agendamentos() {
  const [filters, setFilters] = useState({ data: '', status: 'Todos', search: '' });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value))).toString();
  const { loading, error, data } = useApiData(`/agendamentos?${query}`, [query, reload]);
  const refs = useRefs(reload);

  async function remove(item) {
    if (!confirm('Excluir este agendamento?')) return;
    await api(`/agendamentos/${item.id}`, { method: 'DELETE' });
    setReload((value) => value + 1);
  }

  return (
    <>
      <Header title="Agendamentos" subtitle="Agenda operacional com filtros por data, status e busca." action={<button className="primary" onClick={() => setEditing(emptySchedule)}>+ Novo Agendamento</button>} />
      <div className="toolbar multi">
        <input type="date" value={filters.data} onChange={(e) => setFilters({ ...filters, data: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option>Todos</option><option>Confirmado</option><option>Pendente</option><option>Concluido</option><option>Cancelado</option></select>
        <input placeholder="Buscar agendamento" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <button onClick={() => setFilters({ data: '', status: 'Todos', search: '' })}>Limpar</button>
      </div>
      <div className="card table-card">
        {loading && <p>Carregando...</p>}
        {error && <ErrorMessage message={error} />}
        {data && <Rows rows={data} empty="Nenhum agendamento encontrado" render={(item) => (
          <div className="table-row schedule" key={item.id}>
            <span><strong>{item.hora}</strong><small>{new Date(`${item.data}T00:00:00`).toLocaleDateString('pt-BR')}</small></span>
            <span>{item.pet_nome}<small>{item.cliente_nome}</small></span>
            <span>{item.servico_nome}<small>{currency(item.valor_estimado)}</small></span>
            <Badge text={item.status_label} />
            <span className="actions"><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
          </div>
        )} />}
      </div>
      {editing && <ScheduleModal schedule={editing} refs={refs} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload((v) => v + 1); }} />}
    </>
  );
}

function useRefs(reload) {
  const pets = useApiData('/pets', [reload]);
  const servicos = useApiData('/servicos', [reload]);
  return { pets: pets.data || [], servicos: servicos.data || [] };
}

function ScheduleModal({ schedule, refs, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptySchedule, ...schedule, status: schedule.status || 'AGENDADO' });
  const isEdit = Boolean(schedule.id);

  async function submit(event) {
    event.preventDefault();
    await api(isEdit ? `/agendamentos/${schedule.id}` : '/agendamentos', { method: isEdit ? 'PUT' : 'POST', body: form });
    onSaved();
  }

  return <Modal title={isEdit ? 'Editar Agendamento' : 'Novo Agendamento'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label>Pet<select required value={form.pet_id} onChange={(e) => setForm({ ...form, pet_id: e.target.value })}><option value="">Selecione</option>{refs.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.nome} - {pet.cliente_nome}</option>)}</select></label>
    <label>Servico<select required value={form.servico_id} onChange={(e) => setForm({ ...form, servico_id: e.target.value })}><option value="">Selecione</option>{refs.servicos.map((servico) => <option key={servico.id} value={servico.id}>{servico.nome}</option>)}</select></label>
    <label>Data<input required type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></label>
    <label>Hora<input required type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} /></label>
    <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="AGENDADO">Confirmado</option><option value="EM_ANDAMENTO">Pendente</option><option value="CONCLUIDO">Concluido</option><option value="CANCELADO">Cancelado</option></select></label>
    <label className="wide">Observacoes<input value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function Financeiro() {
  const { loading, error, data } = useApiData('/financeiro', []);
  if (loading) return <Loading title="Financeiro" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <>
      <Header title="Financeiro" subtitle="Receitas, despesas estimadas e lancamentos dos agendamentos." />
      <section className="metrics-grid">
        <Metric label="Receitas" value={currency(data.resumo.receitas)} hint="Mes atual" />
        <Metric label="Despesas" value={currency(data.resumo.despesas)} hint="25% operacional" />
        <Metric label="Lucro" value={currency(data.resumo.lucro)} hint="Estimado" />
        <Metric label="Em aberto" value={currency(data.resumo.aberto)} hint="Pendentes" />
      </section>
      <div className="card table-card">
        <div className="card-title"><h3>Lancamentos</h3><button onClick={() => window.print()}>Relatorio</button></div>
        <Rows rows={data.lancamentos} empty="Nenhum lancamento" render={(item) => (
          <div className="table-row" key={item.id}><span>{new Date(`${item.data}T00:00:00`).toLocaleDateString('pt-BR')}</span><span>{item.descricao}</span><span>{item.categoria}</span><strong>{currency(item.valor)}</strong><Badge text={item.status} /></div>
        )} />
      </div>
    </>
  );
}

function Assistant() {
  const [question, setQuestion] = useState('Como esta o financeiro?');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api('/ai/ask', { method: 'POST', body: { question } });
      setAnswer(`${data.answer}\nFonte: ${data.source}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header title="IA e Consultas" subtitle="Assistente analitico consultando o PostgreSQL conectado." />
      <section className="assistant-card">
        <form onSubmit={ask}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pergunte sobre agenda, clientes, faturamento ou melhorias" />
          <button className="primary" disabled={loading}>{loading ? 'Consultando...' : 'Perguntar'}</button>
        </form>
        {answer && <pre>{answer}</pre>}
        <div className="suggestions"><button onClick={() => setQuestion('Quais agendamentos tenho hoje?')}>Agenda de hoje</button><button onClick={() => setQuestion('Quantos clientes tenho?')}>Clientes</button><button onClick={() => setQuestion('Sugestoes de melhoria')}>Melhorias</button></div>
      </section>
    </>
  );
}

function Metric({ label, value, hint }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function Rows({ rows, empty, render }) {
  if (!rows.length) return <div className="empty-state">{empty}</div>;
  return rows.map(render);
}

function Badge({ text }) {
  return <span className={`badge ${String(text).toLowerCase()}`}>{text}</span>;
}

function MiniBars({ values }) {
  const max = Math.max(...values.map((item) => item.valor), 1);
  return <div className="mini-bars">{values.slice(-18).map((item) => <span key={item.dia} title={`${item.dia}: ${currency(item.valor)}`} style={{ height: `${Math.max(8, (item.valor / max) * 72)}px` }} />)}</div>;
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal"><div className="card-title"><h2>{title}</h2><button onClick={onClose}>X</button></div>{children}</div></div>;
}

function Loading({ title }) {
  return <><Header title={title} subtitle="Carregando dados..." /><div className="card">Carregando...</div></>;
}

function ErrorMessage({ message }) {
  return <div className="alert">{message}</div>;
}
