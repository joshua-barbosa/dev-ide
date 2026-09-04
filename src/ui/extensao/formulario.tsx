// O formulário de conexão, numa aba do editor do VS Code.
//
// Pacote separado do painel de propósito: a barra lateral não precisa carregar
// o formulário para desenhar a árvore, e a aba não precisa da árvore para
// cadastrar uma conexão.
//
// É o `ConnectionForm` da IDE, sem adaptação: os campos, as seções e a grade de
// tipos vêm todos dos metadados do driver, e gravar é o mesmo `salvarConexao`.
import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { definirBaseDaApi } from '../api-http';
import { ConnectionForm } from '../connections/ConnectionForm';
import { useConnections } from '../connections/useConnections';
import { useDialogs } from '../useDialogs';
import { criarTema } from '../theme';
import { ligarPonte, pedirAoHost } from './ponte';

/** O que o host injeta na página antes de carregar este pacote. */
declare const BRAYTECH: {
  readonly base: string;
  readonly conexaoId: string | null;
  readonly grupo: string;
};

function Formulario() {
  const dialogs = useDialogs();
  const ctrl = useConnections({ confirmar: dialogs.confirmar });

  const fechar = useCallback(() => pedirAoHost({ tipo: 'fecharFormulario' }), []);

  // Os drivers chegam pela API; até lá não há grade de tipos para desenhar, e
  // montar o formulário vazio faria a escolha de tipo piscar.
  if (ctrl.drivers.size === 0) return null;

  const conexao = BRAYTECH.conexaoId === null ? null : ctrl.acharConexao(BRAYTECH.conexaoId);

  return (
    <>
      <ConnectionForm
        drivers={[...ctrl.drivers.values()]}
        gruposConhecidos={ctrl.grupos}
        conexao={conexao}
        grupoInicial={BRAYTECH.grupo}
        // Aba do VS Code não tem o ponto de "não salvo" que a aba da IDE tem;
        // marcar sujeira aqui não teria onde aparecer.
        onSujar={() => undefined}
        onCancelar={fechar}
        onSalvar={async (input, conectar) => {
          await ctrl.salvarConexao(input, BRAYTECH.conexaoId, conectar);
          // A barra lateral é OUTRA webview: sem este aviso ela seguiria
          // mostrando a árvore de antes do que ele acabou de gravar.
          pedirAoHost({ tipo: 'conexoesMudaram' });
          fechar();
        }}
      />
      {dialogs.elemento}
    </>
  );
}

// A ordem importa: a ponte instala o transporte, e só depois o formulário monta
// e começa a pedir. A base só vale fora do VS Code, onde não há ponte.
ligarPonte();
definirBaseDaApi(BRAYTECH.base);

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <ThemeProvider theme={criarTema('escuro')}>
        <CssBaseline />
        <Formulario />
      </ThemeProvider>
    </StrictMode>
  );
}
