import React from 'react';

function currency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function Header({ title, subtitle, action }) {
  return <header className="page-header"><div><p className="eyebrow">SnoutSync</p><h1>{title}</h1><span>{subtitle}</span></div>{action}</header>;
}

export function Metric({ label, value, hint }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

export function Rows({ rows, empty, render }) {
  if (!rows.length) return <div className="empty-state">{empty}</div>;
  return rows.map(render);
}

export function Badge({ text }) {
  return <span className={`badge ${String(text).toLowerCase()}`}>{text}</span>;
}

export function MiniBars({ values }) {
  const max = Math.max(...values.map((item) => item.valor), 1);
  return <div className="mini-bars">{values.slice(-18).map((item) => <span key={item.dia} title={`${item.dia}: ${currency(item.valor)}`} style={{ height: `${Math.max(8, (item.valor / max) * 72)}px` }} />)}</div>;
}

export function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal"><div className="card-title"><h2>{title}</h2><button onClick={onClose}>X</button></div>{children}</div></div>;
}

export function Loading({ title }) {
  return <><Header title={title} subtitle="Carregando dados..." /><div className="card">Carregando...</div></>;
}

export function ErrorMessage({ message }) {
  return <div className="alert">{message}</div>;
}
