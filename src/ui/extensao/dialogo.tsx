// Os diálogos ricos do painel — criar objeto e filtrar — como aba do editor.
//
// São os MESMOS `DialogoDeCriacao` e `DialogoDeFiltro` da IDE. O que muda é o
// quadro em volta: numa coluna de 300 px eles colapsam do mesmo jeito que o
// cadastro colapsou, e foi disso que ele reclamou.
//
// Um pacote só para os dois: são poucos e sempre chegam pelo mesmo caminho.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import type { FiltroDaArvore } from '../../shared/tree/filtro-da-arvore';
import { DialogoDeCriacao, type PedidoDeCriacao } from '../connections/DialogoDeCriacao';
import { DialogoDeFiltro, type PedidoDeFiltro } from '../connections/DialogoDeFiltro';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { ligarPonte, pedirAoHost } from './ponte';

/** O que o host injeta na página antes de carregar este pacote. */
declare const BRAYTECH: {
  readonly base: string;
  readonly dialogo: 'criacao' | 'filtro';
  readonly pedido: PedidoDeCriacao | PedidoDeFiltro;
};

/** Fecha a aba e manda o painel redesenhar SÓ o ramo mexido. */
function pronto(id: string, caminho: readonly string[]): void {
  pedirAoHost({ tipo: 'conexoesMudaram', conexaoId: id, caminho });
  pedirAoHost({ tipo: 'fecharFormulario' });
}

const fechar = (): void => pedirAoHost({ tipo: 'fecharFormulario' });

function Aba() {
  if (BRAYTECH.dialogo === 'criacao') {
    const pedido = BRAYTECH.pedido as PedidoDeCriacao;
    return (
      <DialogoDeCriacao
        pedido={pedido}
        onCancelar={fechar}
        onAbrirNoEditor={(sql) => {
          // O esqueleto vira um `.sql` de verdade no editor, que é onde o
          // Ctrl+Enter da extensão já executa.
          pedirAoHost({
            tipo: 'abrirQuery',
            connectionId: pedido.id,
            database: pedido.database,
            titulo: `${pedido.nomeBase}.sql`,
            conteudo: sql,
          });
          fechar();
        }}
        onExecutar={async (sql) => {
          await Api.execute(pedido.id, {
            statement: sql,
            ...(pedido.database === null ? {} : { database: pedido.database }),
          });
          // Sem isto o objeto criado só apareceria no recarregar seguinte.
          pronto(pedido.id, pedido.caminho);
        }}
      />
    );
  }

  const pedido = BRAYTECH.pedido as PedidoDeFiltro;
  return (
    <DialogoDeFiltro
      pedido={pedido}
      onCancelar={fechar}
      // O filtro é estado do PAINEL — ele guarda, aplica e redesenha. A aba só
      // devolve a escolha; aplicá-la daqui deixaria os dois discordando sobre o
      // que está filtrado.
      onAplicar={async (filtro: FiltroDaArvore) => {
        pedirAoHost({
          tipo: 'conexoesMudaram',
          conexaoId: pedido.id,
          caminho: pedido.caminho,
          filtro,
        });
        fechar();
      }}
    />
  );
}

// A ordem importa: a ponte instala o transporte, e só depois a aba monta.
ligarPonte();
definirBaseDaApi(BRAYTECH.base);

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <ComTemaDoEditor>
        <Aba />
      </ComTemaDoEditor>
    </StrictMode>
  );
}
