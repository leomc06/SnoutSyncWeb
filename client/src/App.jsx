import React, { useEffect, useState } from 'react';
import { api, API_URL, clearSession, saveSession } from './api.js';
import { Badge, ErrorMessage, FieldError, Header, Loading, Metric, MiniBars, Modal, Rows, Skeleton, ToastStack } from './components/ui.jsx';

const pages = [
  ['dashboard', 'Dashboard'],
  ['clientes', 'Clientes e Pets'],
  ['agendamentos', 'Agendamentos'],
  ['servicos', 'Servicos'],
  ['despesas', 'Despesas'],
  ['estoque', 'Estoque'],
  ['financeiro', 'Financeiro'],
  ['bi', 'BI'],
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

const emptyService = {
  nome: '',
  descricao: '',
  preco_pequeno: 0,
  preco_medio: 0,
  preco_grande: 0,
  duracao_pequeno: 30,
  duracao_medio: 45,
  duracao_grande: 60
};

const emptyExpense = {
  descricao: '',
  categoria: 'Operacional',
  valor: 0,
  data_vencimento: new Date().toISOString().slice(0, 10),
  data_pagamento: '',
  status: 'ABERTA',
  observacoes: ''
};

const emptyProduct = {
  sku: '',
  nome: '',
  descricao: '',
  categoria: '',
  preco_venda: 0,
  custo: 0,
  estoque_atual: 0,
  estoque_minimo: 0
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

function formErrorState(error) {
  const field = error.details?.field;
  return { message: error.message, fields: field ? { [field]: error.message } : {} };
}

async function downloadReport(path, filename) {
  const token = localStorage.getItem('snoutsync:token');
  const response = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('Nao foi possivel baixar o relatorio.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const [toasts, setToasts] = useState([]);

  function notify(message, type = 'info') {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }

  function login(nextUser) {
    saveSession(nextUser);
    setUser(nextUser.user);
    notify('Login realizado com sucesso.', 'success');
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: localStorage.getItem('snoutsync:refreshToken') } });
    } catch {
      // Mesmo se o token ja expirou, a saida local deve acontecer.
    }
    clearSession();
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
        <GlobalSearch currentPage={page} go={setPage} />
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'clientes' && <Clientes notify={notify} />}
        {page === 'agendamentos' && <Agendamentos notify={notify} />}
        {page === 'servicos' && <Servicos notify={notify} />}
        {page === 'despesas' && <Despesas notify={notify} />}
        {page === 'estoque' && <Estoque notify={notify} />}
        {page === 'financeiro' && <Financeiro notify={notify} />}
        {page === 'bi' && <BI />}
        {page === 'ia' && <Assistant notify={notify} />}
        <ToastStack toasts={toasts} />
      </main>
    </div>
  );
}

function GlobalSearch({ currentPage, go }) {
  const [term, setTerm] = useState('');
  const matches = pages.filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()));

  return <div className="topbar">
    <div className="global-search">
      <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Busca global: telas, agenda, clientes..." />
      {term && <div className="search-results">
        <Rows rows={matches} empty="Nenhuma tela encontrada" render={([key, label]) => (
          <button key={key} className={currentPage === key ? 'active' : ''} onClick={() => { go(key); setTerm(''); }}>{label}</button>
        )} />
      </div>}
    </div>
  </div>;
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ usuario: 'leonardo', senha: 'TROCAR_SENHA' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: form });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function requestReset() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await api('/auth/password-reset/request', { method: 'POST', body: { usuario: form.usuario } });
      setMessage(data.message);
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
        {!recovering && <label>Senha<input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></label>}
        {error && <div className="alert">{error}</div>}
        {message && <div className="success-message">{message}</div>}
        {recovering
          ? <button className="primary" type="button" disabled={loading} onClick={requestReset}>{loading ? 'Enviando...' : 'Enviar recuperacao'}</button>
          : <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>}
        <button className="link-button" type="button" onClick={() => setRecovering((value) => !value)}>{recovering ? 'Voltar ao login' : 'Esqueci minha senha'}</button>
        <small>API: {API_URL}</small>
      </form>
    </div>
  );
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

function Clientes({ notify }) {
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [historyPet, setHistoryPet] = useState(null);
  const { loading, error, data } = useApiData(`/clientes?search=${encodeURIComponent(search)}`, [search, reload]);

  async function remove(cliente) {
    if (!confirm(`Excluir ${cliente.nome} e seus registros relacionados?`)) return;
    try {
      await api(`/clientes/${cliente.cliente_id}`, { method: 'DELETE' });
      notify('Cliente excluido com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <>
      <Header title="Clientes e Pets" subtitle="Cadastros espelhados do sistema original." action={<button className="primary" onClick={() => setEditing(emptyClient)}>+ Novo Cliente</button>} />
      <div className="toolbar"><input placeholder="Buscar cliente, pet, telefone ou raca" value={search} onChange={(e) => setSearch(e.target.value)} /><button onClick={() => setSearch('')}>Limpar</button></div>
      <div className="card table-card">
        {loading && <Skeleton rows={4} />}
        {error && <ErrorMessage message={error} />}
        {data && <Rows rows={data} empty="Nenhum cliente encontrado" render={(item) => (
          <div className="table-row" key={`${item.cliente_id}-${item.pet_id}`}>
            <span><strong>{item.nome}</strong><small>{item.telefone || 'Sem telefone'}</small></span>
            <span>{item.pet_nome}<small>{item.raca || 'Raca nao informada'}</small></span>
            <span>{item.porte_label}</span>
            <Badge text={item.tipo_label} />
            <span className="actions"><button onClick={() => setHistoryPet(item)}>Historico</button><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
          </div>
        )} />}
      </div>
      {editing && <ClientModal client={editing} onClose={() => setEditing(null)} onSaved={() => { notify('Cliente salvo com sucesso.', 'success'); setEditing(null); setReload((v) => v + 1); }} />}
      {historyPet && <HistoryModal pet={historyPet} onClose={() => setHistoryPet(null)} />}
    </>
  );
}

function ClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyClient, ...client, tipo: client.tipo || 'AVULSO', porte: client.porte || 'M' });
  const [errors, setErrors] = useState({ message: '', fields: {} });
  const isEdit = Boolean(client.cliente_id);

  async function submit(event) {
    event.preventDefault();
    const method = isEdit ? 'PUT' : 'POST';
    const path = isEdit ? `/clientes/${client.cliente_id}/pets/${client.pet_id}` : '/clientes';
    try {
      await api(path, { method, body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title={isEdit ? 'Editar Cliente' : 'Novo Cliente'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><FieldError message={errors.fields.nome} /></label>
    <label>Telefone<input value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></label>
    <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="AVULSO">Avulso</option><option value="PLANO">Plano</option></select></label>
    <label>Pet<input required value={form.pet_nome} onChange={(e) => setForm({ ...form, pet_nome: e.target.value })} /><FieldError message={errors.fields.pet_nome} /></label>
    <label>Especie<input value={form.especie || ''} onChange={(e) => setForm({ ...form, especie: e.target.value })} /></label>
    <label>Raca<input value={form.raca || ''} onChange={(e) => setForm({ ...form, raca: e.target.value })} /></label>
    <label>Peso<input type="number" step="0.1" value={form.peso || ''} onChange={(e) => setForm({ ...form, peso: e.target.value })} /></label>
    <label>Porte<select value={form.porte} onChange={(e) => setForm({ ...form, porte: e.target.value })}><option value="P">Pequeno</option><option value="M">Medio</option><option value="G">Grande</option></select></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function HistoryModal({ pet, onClose }) {
  const { loading, error, data } = useApiData(`/pets/${pet.pet_id}/historico`, [pet.pet_id]);
  const [reload, setReload] = useState(0);
  const [editingRecord, setEditingRecord] = useState(false);
  const [addingVaccine, setAddingVaccine] = useState(false);
  const record = useApiData(`/pets/${pet.pet_id}/prontuario`, [pet.pet_id, reload]);

  return <Modal title={`Historico de ${pet.pet_nome}`} onClose={onClose}>
    {loading && <p>Carregando...</p>}
    {error && <ErrorMessage message={error} />}
    {data && <div className="history-list">
      <div className="card-title"><h3>Prontuario</h3><span className="actions"><button onClick={() => setEditingRecord(true)}>Editar prontuario</button><button onClick={() => setAddingVaccine(true)}>Nova vacina</button></span></div>
      {record.loading && <Skeleton rows={2} />}
      {record.data && <div className="history-item"><strong>Dados clinicos</strong><span>Alergias: {record.data.prontuario?.alergias || 'Nao informado'}</span><small>Restricoes: {record.data.prontuario?.restricoes || 'Nao informado'} | Comportamento: {record.data.prontuario?.comportamento || 'Nao informado'}</small></div>}
      {record.data && <Rows rows={record.data.vacinas} empty="Sem vacinas cadastradas" render={(item) => (
        <div className="history-item" key={`v-${item.id}`}><strong>{item.nome}</strong><span>Aplicacao: {item.data_aplicacao || 'Sem data'} | Reforco: {item.data_reforco || 'Sem data'}</span><small>{item.observacoes || 'Sem observacoes'}</small></div>
      )} />}
      <h3>Atendimentos e agendamentos</h3>
      <Rows rows={data.agendamentos} empty="Sem historico de agendamentos" render={(item) => (
        <div className="history-item" key={`a-${item.id}`}><strong>{item.servico_nome}</strong><span>{new Date(`${item.data}T00:00:00`).toLocaleDateString('pt-BR')} as {item.hora} - {item.status}</span><small>{item.forma_pagamento ? `${item.forma_pagamento} - ${currency(item.valor_cobrado)}` : item.observacoes || 'Sem observacoes'}</small></div>
      )} />
      <h3>Notas</h3>
      <Rows rows={data.historico} empty="Sem notas adicionais" render={(item) => (
        <div className="history-item" key={`h-${item.id}`}><strong>{item.tipo}</strong><span>{new Date(item.criado_em).toLocaleString('pt-BR')}</span><small>{item.descricao}</small></div>
      )} />
    </div>}
    {editingRecord && <ProntuarioModal petId={pet.pet_id} record={record.data?.prontuario} onClose={() => setEditingRecord(false)} onSaved={() => { setEditingRecord(false); setReload((value) => value + 1); }} />}
    {addingVaccine && <VaccineModal petId={pet.pet_id} onClose={() => setAddingVaccine(false)} onSaved={() => { setAddingVaccine(false); setReload((value) => value + 1); }} />}
  </Modal>;
}

function ProntuarioModal({ petId, record, onClose, onSaved }) {
  const [form, setForm] = useState({ alergias: '', restricoes: '', comportamento: '', observacoes_clinicas: '', peso_atual: '', castrado: '', ...(record || {}) });
  const [errors, setErrors] = useState({ message: '', fields: {} });

  async function submit(event) {
    event.preventDefault();
    try {
      await api(`/pets/${petId}/prontuario`, { method: 'PUT', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title="Editar Prontuario" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Alergias<input value={form.alergias || ''} onChange={(e) => setForm({ ...form, alergias: e.target.value })} /></label>
    <label>Restricoes<input value={form.restricoes || ''} onChange={(e) => setForm({ ...form, restricoes: e.target.value })} /></label>
    <label>Comportamento<input value={form.comportamento || ''} onChange={(e) => setForm({ ...form, comportamento: e.target.value })} /></label>
    <label>Peso atual<input type="number" step="0.1" value={form.peso_atual || ''} onChange={(e) => setForm({ ...form, peso_atual: e.target.value })} /></label>
    <label>Castrado<select value={form.castrado ?? ''} onChange={(e) => setForm({ ...form, castrado: e.target.value })}><option value="">Nao informado</option><option value="true">Sim</option><option value="false">Nao</option></select></label>
    <label className="wide">Observacoes clinicas<input value={form.observacoes_clinicas || ''} onChange={(e) => setForm({ ...form, observacoes_clinicas: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function VaccineModal({ petId, onClose, onSaved }) {
  const [form, setForm] = useState({ nome: '', data_aplicacao: '', data_reforco: '', observacoes: '' });
  const [errors, setErrors] = useState({ message: '', fields: {} });

  async function submit(event) {
    event.preventDefault();
    try {
      await api(`/pets/${petId}/vacinas`, { method: 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title="Nova Vacina" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><FieldError message={errors.fields.nome} /></label>
    <label>Aplicacao<input type="date" value={form.data_aplicacao} onChange={(e) => setForm({ ...form, data_aplicacao: e.target.value })} /></label>
    <label>Reforco<input type="date" value={form.data_reforco} onChange={(e) => setForm({ ...form, data_reforco: e.target.value })} /></label>
    <label className="wide">Observacoes<input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function Servicos({ notify }) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const { loading, error, data } = useApiData('/servicos', [reload]);

  async function remove(servico) {
    if (!confirm(`Excluir o servico ${servico.nome}?`)) return;
    try {
      await api(`/servicos/${servico.id}`, { method: 'DELETE' });
      notify('Servico excluido com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return <>
    <Header title="Servicos" subtitle="Edite precos, duracao e catalogo de banho e tosa." action={<button className="primary" onClick={() => setEditing(emptyService)}>+ Novo Servico</button>} />
    <div className="card table-card">
      {loading && <Skeleton rows={4} />}
      {error && <ErrorMessage message={error} />}
      {data && <Rows rows={data} empty="Nenhum servico cadastrado" render={(item) => (
        <div className="table-row service-row" key={item.id}>
          <span><strong>{item.nome}</strong><small>{item.descricao || 'Sem descricao'}</small></span>
          <span>P {currency(item.preco_pequeno)}<small>{item.duracao_pequeno} min</small></span>
          <span>M {currency(item.preco_medio)}<small>{item.duracao_medio} min</small></span>
          <span>G {currency(item.preco_grande)}<small>{item.duracao_grande} min</small></span>
          <span className="actions"><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
        </div>
      )} />}
    </div>
    {editing && <ServiceModal service={editing} onClose={() => setEditing(null)} onSaved={() => { notify('Servico salvo com sucesso.', 'success'); setEditing(null); setReload((v) => v + 1); }} />}
  </>;
}

function ServiceModal({ service, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyService, ...service });
  const [errors, setErrors] = useState({ message: '', fields: {} });
  const isEdit = Boolean(service.id);

  async function submit(event) {
    event.preventDefault();
    try {
      await api(isEdit ? `/servicos/${service.id}` : '/servicos', { method: isEdit ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  function field(name, value) {
    setForm({ ...form, [name]: value });
  }

  return <Modal title={isEdit ? 'Editar Servico' : 'Novo Servico'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Nome<input required value={form.nome} onChange={(e) => field('nome', e.target.value)} /><FieldError message={errors.fields.nome} /></label>
    <label>Descricao<input value={form.descricao || ''} onChange={(e) => field('descricao', e.target.value)} /></label>
    <label>Preco pequeno<input required type="number" step="0.01" value={form.preco_pequeno} onChange={(e) => field('preco_pequeno', e.target.value)} /></label>
    <label>Duracao pequeno<input required type="number" value={form.duracao_pequeno} onChange={(e) => field('duracao_pequeno', e.target.value)} /></label>
    <label>Preco medio<input required type="number" step="0.01" value={form.preco_medio} onChange={(e) => field('preco_medio', e.target.value)} /></label>
    <label>Duracao medio<input required type="number" value={form.duracao_medio} onChange={(e) => field('duracao_medio', e.target.value)} /></label>
    <label>Preco grande<input required type="number" step="0.01" value={form.preco_grande} onChange={(e) => field('preco_grande', e.target.value)} /></label>
    <label>Duracao grande<input required type="number" value={form.duracao_grande} onChange={(e) => field('duracao_grande', e.target.value)} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function Agendamentos({ notify }) {
  const [filters, setFilters] = useState({ data: '', status: 'Todos', search: '' });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(null);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value))).toString();
  const { loading, error, data } = useApiData(`/agendamentos?${query}`, [query, reload]);
  const refs = useRefs(reload);

  async function remove(item) {
    if (!confirm('Excluir este agendamento?')) return;
    try {
      await api(`/agendamentos/${item.id}`, { method: 'DELETE' });
      notify('Agendamento excluido com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function moveSchedule(item, nextDate) {
    try {
      await api(`/agendamentos/${item.id}`, {
        method: 'PUT',
        body: {
          pet_id: item.pet_id,
          servico_id: item.servico_id,
          data: nextDate,
          hora: item.hora,
          status: item.status,
          observacoes: item.observacoes || ''
        }
      });
      notify('Agendamento remarcado com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
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
      {data && <CalendarStrip items={data} onEdit={setEditing} onMove={moveSchedule} />}
      <div className="card table-card">
        {loading && <Skeleton rows={4} />}
        {error && <ErrorMessage message={error} />}
        {data && <Rows rows={data} empty="Nenhum agendamento encontrado" render={(item) => (
          <div className="table-row schedule" key={item.id}>
            <span><strong>{item.hora}</strong><small>{new Date(`${item.data}T00:00:00`).toLocaleDateString('pt-BR')}</small></span>
            <span>{item.pet_nome}<small>{item.cliente_nome}</small></span>
            <span>{item.servico_nome}<small>{currency(item.valor_cobrado ?? item.valor_estimado)}</small></span>
            <Badge text={item.status_label} />
            <span className="actions"><button onClick={() => setClosing(item)}>Concluir</button><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
          </div>
        )} />}
      </div>
      {editing && <ScheduleModal schedule={editing} refs={refs} onClose={() => setEditing(null)} onSaved={() => { notify('Agendamento salvo com sucesso.', 'success'); setEditing(null); setReload((v) => v + 1); }} />}
      {closing && <CheckoutModal schedule={closing} onClose={() => setClosing(null)} onSaved={() => { notify('Atendimento concluido com sucesso.', 'success'); setClosing(null); setReload((v) => v + 1); }} />}
    </>
  );
}

function CalendarStrip({ items, onEdit, onMove }) {
  const byDate = items.reduce((acc, item) => {
    acc[item.data] = acc[item.data] || [];
    acc[item.data].push(item);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort().slice(0, 7);
  if (!dates.length) return null;

  return <section className="calendar-strip card">
    <div className="card-title"><h3>Calendario operacional</h3><small>Cartoes preparados para drag-and-drop futuro</small></div>
    <div className="calendar-grid">
      {dates.map((date) => <div className="calendar-day" key={date} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        const id = Number(event.dataTransfer.getData('text/plain'));
        const item = items.find((candidate) => candidate.id === id);
        if (item && item.data !== date) onMove(item, date);
      }}>
        <strong>{new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</strong>
        {byDate[date].map((item) => <button draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))} className="calendar-event" key={item.id} onClick={() => onEdit(item)} title="Arraste para outro dia visivel para remarcar">
          <span>{item.hora}</span>
          <b>{item.pet_nome}</b>
          <small>{item.servico_nome}</small>
        </button>)}
      </div>)}
    </div>
  </section>;
}

function useRefs(reload) {
  const pets = useApiData('/pets', [reload]);
  const servicos = useApiData('/servicos', [reload]);
  return { pets: pets.data || [], servicos: servicos.data || [] };
}

function ScheduleModal({ schedule, refs, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptySchedule, ...schedule, status: schedule.status || 'AGENDADO' });
  const [errors, setErrors] = useState({ message: '', fields: {} });
  const isEdit = Boolean(schedule.id);

  async function submit(event) {
    event.preventDefault();
    try {
      await api(isEdit ? `/agendamentos/${schedule.id}` : '/agendamentos', { method: isEdit ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title={isEdit ? 'Editar Agendamento' : 'Novo Agendamento'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Pet<select required value={form.pet_id} onChange={(e) => setForm({ ...form, pet_id: e.target.value })}><option value="">Selecione</option>{refs.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.nome} - {pet.cliente_nome}</option>)}</select><FieldError message={errors.fields.pet_id} /></label>
    <label>Servico<select required value={form.servico_id} onChange={(e) => setForm({ ...form, servico_id: e.target.value })}><option value="">Selecione</option>{refs.servicos.map((servico) => <option key={servico.id} value={servico.id}>{servico.nome}</option>)}</select><FieldError message={errors.fields.servico_id} /></label>
    <label>Data<input required type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /><FieldError message={errors.fields.data} /></label>
    <label>Hora<input required type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} /><FieldError message={errors.fields.hora} /></label>
    <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="AGENDADO">Confirmado</option><option value="EM_ANDAMENTO">Pendente</option><option value="CONCLUIDO">Concluido</option><option value="CANCELADO">Cancelado</option></select></label>
    <label className="wide">Observacoes<input value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function CheckoutModal({ schedule, onClose, onSaved }) {
  const [form, setForm] = useState({ valor_cobrado: schedule.valor_cobrado ?? schedule.valor_estimado, forma_pagamento: schedule.forma_pagamento || 'Pix' });
  const [errors, setErrors] = useState({ message: '', fields: {} });

  async function submit(event) {
    event.preventDefault();
    try {
      await api(`/agendamentos/${schedule.id}/concluir`, { method: 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title={`Concluir ${schedule.pet_nome}`} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Valor cobrado<input required type="number" step="0.01" value={form.valor_cobrado} onChange={(e) => setForm({ ...form, valor_cobrado: e.target.value })} /><FieldError message={errors.fields.valor_cobrado} /></label>
    <label>Forma de pagamento<select value={form.forma_pagamento} onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })}><option>Pix</option><option>Cartao</option><option>Dinheiro</option><option>Plano mensal</option></select><FieldError message={errors.fields.forma_pagamento} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Registrar pagamento</button></div>
  </form></Modal>;
}

function Despesas({ notify }) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const { loading, error, data } = useApiData('/despesas', [reload]);

  async function remove(item) {
    if (!confirm(`Excluir despesa ${item.descricao}?`)) return;
    try {
      await api(`/despesas/${item.id}`, { method: 'DELETE' });
      notify('Despesa excluida com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return <>
    <Header title="Despesas" subtitle="Lancamentos reais usados no financeiro." action={<button className="primary" onClick={() => setEditing(emptyExpense)}>+ Nova Despesa</button>} />
    <div className="card table-card">
      {loading && <Skeleton rows={4} />}
      {error && <ErrorMessage message={error} />}
      {data && <Rows rows={data} empty="Nenhuma despesa cadastrada" render={(item) => (
        <div className="table-row" key={item.id}>
          <span><strong>{item.descricao}</strong><small>{item.categoria}</small></span>
          <span>{new Date(`${item.data_vencimento}T00:00:00`).toLocaleDateString('pt-BR')}<small>{item.data_pagamento ? `Pago em ${new Date(`${item.data_pagamento}T00:00:00`).toLocaleDateString('pt-BR')}` : 'Sem pagamento'}</small></span>
          <strong>{currency(item.valor)}</strong>
          <Badge text={item.status} />
          <span className="actions"><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
        </div>
      )} />}
    </div>
    {editing && <ExpenseModal expense={editing} onClose={() => setEditing(null)} onSaved={() => { notify('Despesa salva com sucesso.', 'success'); setEditing(null); setReload((v) => v + 1); }} />}
  </>;
}

function ExpenseModal({ expense, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyExpense, ...expense });
  const [errors, setErrors] = useState({ message: '', fields: {} });
  const isEdit = Boolean(expense.id);

  async function submit(event) {
    event.preventDefault();
    try {
      await api(isEdit ? `/despesas/${expense.id}` : '/despesas', { method: isEdit ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  function field(name, value) {
    setForm({ ...form, [name]: value });
  }

  return <Modal title={isEdit ? 'Editar Despesa' : 'Nova Despesa'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Descricao<input required value={form.descricao} onChange={(e) => field('descricao', e.target.value)} /><FieldError message={errors.fields.descricao} /></label>
    <label>Categoria<input value={form.categoria || ''} onChange={(e) => field('categoria', e.target.value)} /></label>
    <label>Valor<input required type="number" step="0.01" value={form.valor} onChange={(e) => field('valor', e.target.value)} /><FieldError message={errors.fields.valor} /></label>
    <label>Vencimento<input required type="date" value={form.data_vencimento || ''} onChange={(e) => field('data_vencimento', e.target.value)} /><FieldError message={errors.fields.data_vencimento} /></label>
    <label>Pagamento<input type="date" value={form.data_pagamento || ''} onChange={(e) => field('data_pagamento', e.target.value)} /></label>
    <label>Status<select value={form.status} onChange={(e) => field('status', e.target.value)}><option value="ABERTA">Aberta</option><option value="PAGA">Paga</option><option value="CANCELADA">Cancelada</option></select></label>
    <label className="wide">Observacoes<input value={form.observacoes || ''} onChange={(e) => field('observacoes', e.target.value)} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function Estoque({ notify }) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [moving, setMoving] = useState(null);
  const { loading, error, data } = useApiData('/produtos', [reload]);

  async function remove(item) {
    if (!confirm(`Excluir produto ${item.nome}?`)) return;
    try {
      await api(`/produtos/${item.id}`, { method: 'DELETE' });
      notify('Produto excluido com sucesso.', 'success');
      setReload((value) => value + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return <>
    <Header title="Estoque" subtitle="Produtos, niveis minimos e movimentacoes." action={<button className="primary" onClick={() => setEditing(emptyProduct)}>+ Novo Produto</button>} />
    <div className="card table-card">
      {loading && <Skeleton rows={4} />}
      {error && <ErrorMessage message={error} />}
      {data && <Rows rows={data} empty="Nenhum produto cadastrado" render={(item) => (
        <div className="table-row service-row" key={item.id}>
          <span><strong>{item.nome}</strong><small>{item.sku || item.categoria || 'Sem SKU'}</small></span>
          <span>Venda {currency(item.preco_venda)}<small>Custo {currency(item.custo)}</small></span>
          <span>Estoque {item.estoque_atual}<small>Minimo {item.estoque_minimo}</small></span>
          <Badge text={item.estoque_atual <= item.estoque_minimo ? 'Baixo' : 'OK'} />
          <span className="actions"><button onClick={() => setMoving(item)}>Movimentar</button><button onClick={() => setEditing(item)}>Editar</button><button onClick={() => remove(item)}>Excluir</button></span>
        </div>
      )} />}
    </div>
    {editing && <ProductModal product={editing} onClose={() => setEditing(null)} onSaved={() => { notify('Produto salvo com sucesso.', 'success'); setEditing(null); setReload((v) => v + 1); }} />}
    {moving && <StockMoveModal product={moving} onClose={() => setMoving(null)} onSaved={() => { notify('Estoque movimentado com sucesso.', 'success'); setMoving(null); setReload((v) => v + 1); }} />}
  </>;
}

function ProductModal({ product, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyProduct, ...product });
  const [errors, setErrors] = useState({ message: '', fields: {} });
  const isEdit = Boolean(product.id);

  async function submit(event) {
    event.preventDefault();
    try {
      await api(isEdit ? `/produtos/${product.id}` : '/produtos', { method: isEdit ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  function field(name, value) {
    setForm({ ...form, [name]: value });
  }

  return <Modal title={isEdit ? 'Editar Produto' : 'Novo Produto'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Nome<input required value={form.nome} onChange={(e) => field('nome', e.target.value)} /><FieldError message={errors.fields.nome} /></label>
    <label>SKU<input value={form.sku || ''} onChange={(e) => field('sku', e.target.value)} /></label>
    <label>Categoria<input value={form.categoria || ''} onChange={(e) => field('categoria', e.target.value)} /></label>
    <label>Preco venda<input required type="number" step="0.01" value={form.preco_venda} onChange={(e) => field('preco_venda', e.target.value)} /></label>
    <label>Custo<input required type="number" step="0.01" value={form.custo} onChange={(e) => field('custo', e.target.value)} /></label>
    {!isEdit && <label>Estoque inicial<input type="number" value={form.estoque_atual} onChange={(e) => field('estoque_atual', e.target.value)} /></label>}
    <label>Estoque minimo<input type="number" value={form.estoque_minimo} onChange={(e) => field('estoque_minimo', e.target.value)} /></label>
    <label className="wide">Descricao<input value={form.descricao || ''} onChange={(e) => field('descricao', e.target.value)} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
  </form></Modal>;
}

function StockMoveModal({ product, onClose, onSaved }) {
  const [form, setForm] = useState({ tipo: 'ENTRADA', quantidade: 1, motivo: '' });
  const [errors, setErrors] = useState({ message: '', fields: {} });

  async function submit(event) {
    event.preventDefault();
    try {
      await api(`/produtos/${product.id}/movimentacoes`, { method: 'POST', body: form });
      onSaved();
    } catch (error) {
      setErrors(formErrorState(error));
    }
  }

  return <Modal title={`Movimentar ${product.nome}`} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {errors.message && <div className="alert wide">{errors.message}</div>}
    <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="ENTRADA">Entrada</option><option value="SAIDA">Saida</option><option value="AJUSTE">Ajuste para quantidade</option></select></label>
    <label>Quantidade<input required type="number" min="0" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /><FieldError message={errors.fields.quantidade} /></label>
    <label className="wide">Motivo<input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Registrar</button></div>
  </form></Modal>;
}

function Financeiro({ notify }) {
  const [filters, setFilters] = useState({ dataInicio: '', dataFim: '', servicoId: '' });
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value))).toString();
  const { loading, error, data } = useApiData(`/financeiro?${query}`, [query]);
  const servicos = useApiData('/servicos', []);
  const relatorioServicos = useApiData(`/relatorios/servicos?${query}`, [query]);
  if (loading) return <Loading title="Financeiro" />;
  if (error) return <ErrorMessage message={error} />;
  const reportQuery = query ? `?${query}` : '';

  return (
    <>
      <Header title="Financeiro" subtitle="Receitas, despesas reais e lancamentos filtraveis." />
      <div className="toolbar multi">
        <input type="date" value={filters.dataInicio} onChange={(e) => setFilters({ ...filters, dataInicio: e.target.value })} />
        <input type="date" value={filters.dataFim} onChange={(e) => setFilters({ ...filters, dataFim: e.target.value })} />
        <select value={filters.servicoId} onChange={(e) => setFilters({ ...filters, servicoId: e.target.value })}><option value="">Todos os servicos</option>{(servicos.data || []).map((servico) => <option key={servico.id} value={servico.id}>{servico.nome}</option>)}</select>
        <button onClick={() => setFilters({ dataInicio: '', dataFim: '', servicoId: '' })}>Limpar</button>
      </div>
      <section className="metrics-grid">
        <Metric label="Receitas" value={currency(data.resumo.receitas)} hint="Mes atual" />
        <Metric label="Despesas" value={currency(data.resumo.despesas)} hint="Lancamentos reais" />
        <Metric label="Lucro" value={currency(data.resumo.lucro)} hint="Estimado" />
        <Metric label="Em aberto" value={currency(data.resumo.aberto)} hint="Pendentes" />
      </section>
      <div className="card table-card">
        <div className="card-title"><h3>Relatorio por servico</h3></div>
        {relatorioServicos.loading && <Skeleton rows={3} />}
        {relatorioServicos.data && <Rows rows={relatorioServicos.data} empty="Sem servicos no periodo" render={(item) => (
          <div className="table-row" key={item.servico_id}><span><strong>{item.servico_nome}</strong><small>{item.quantidade} atendimento(s)</small></span><strong>{currency(item.receita)}</strong><span>Ticket medio<small>{currency(item.ticket_medio)}</small></span><span></span><span></span></div>
        )} />}
      </div>
      <div className="card table-card">
        <div className="card-title"><h3>Lancamentos</h3><span className="actions"><button onClick={() => downloadReport(`/relatorios/financeiro.csv${reportQuery}`, 'financeiro-snoutsync.csv').catch((error) => notify(error.message, 'error'))}>CSV</button><button onClick={() => downloadReport(`/relatorios/financeiro.pdf${reportQuery}`, 'financeiro-snoutsync.pdf').catch((error) => notify(error.message, 'error'))}>PDF</button></span></div>
        <Rows rows={data.lancamentos} empty="Nenhum lancamento" render={(item) => (
          <div className="table-row" key={item.id}><span>{new Date(`${item.data}T00:00:00`).toLocaleDateString('pt-BR')}</span><span>{item.descricao}</span><span>{item.categoria}</span><strong>{currency(item.valor)}</strong><Badge text={item.status} /></div>
        )} />
      </div>
    </>
  );
}

function BI() {
  const { loading, error, data } = useApiData('/bi', []);
  if (loading) return <Loading title="BI" />;
  if (error) return <ErrorMessage message={error} />;

  return <>
    <Header title="BI" subtitle="Indicadores de demanda, sazonalidade e estoque." />
    <section className="metrics-grid">
      <Metric label="Receita media mensal" value={currency(data.previsao_demanda.receita_media_mensal)} hint={data.previsao_demanda.metodo} />
      <Metric label="Agendamentos medio/mes" value={Number(data.previsao_demanda.agendamentos_media_mensal || 0).toFixed(1)} hint="Historico filtrado" />
      <Metric label="Produtos cadastrados" value={data.estoque.produtos} hint="Ativos" />
      <Metric label="Estoque baixo" value={data.estoque.abaixo_minimo} hint="Abaixo ou igual ao minimo" />
    </section>
    <section className="two-columns">
      <div className="card table-card">
        <div className="card-title"><h3>Top servicos</h3></div>
        <Rows rows={data.servicos_top} empty="Sem dados" render={(item) => (
          <div className="table-row" key={item.servico_id}><span><strong>{item.servico_nome}</strong><small>{item.quantidade} atendimento(s)</small></span><strong>{currency(item.receita)}</strong><span>Ticket<small>{currency(item.ticket_medio)}</small></span><span></span><span></span></div>
        )} />
      </div>
      <div className="card table-card">
        <div className="card-title"><h3>Sazonalidade mensal</h3></div>
        <Rows rows={data.sazonalidade_mensal} empty="Sem dados" render={(item) => (
          <div className="row" key={item.mes}><strong>{item.mes}</strong><span>{item.agendamentos} agendamento(s)</span><span>{currency(item.receita)}</span><span></span></div>
        )} />
      </div>
    </section>
  </>;
}

function Assistant({ notify }) {
  const [question, setQuestion] = useState('Como esta o financeiro?');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api('/ai/ask', { method: 'POST', body: { question } });
      setAnswer(`${data.answer}\nFonte: ${data.source}`);
      notify('Resposta gerada com sucesso.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header title="IA e Consultas" />
      <section className="assistant-card">
        <form onSubmit={ask}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pergunte sobre agenda, clientes, faturamento ou melhorias" />
          <button className="primary" disabled={loading}>{loading ? 'Consultando...' : 'Perguntar'}</button>
        </form>
        {answer && <pre>{answer}</pre>}
      </section>
    </>
  );
}
