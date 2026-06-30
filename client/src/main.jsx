import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const rootElement = document.getElementById('root');

window.addEventListener('error', (event) => {
  if (rootElement && !rootElement.hasChildNodes()) {
    rootElement.innerHTML = `<div class="boot-error">Erro ao carregar o SnoutSync: ${event.message}</div>`;
  }
});

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
