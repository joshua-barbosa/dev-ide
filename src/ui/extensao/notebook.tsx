// O notebook `.brnb` na extensão (spec 112, etapa 6).
//
// A tela é o MESMO `NotebookHost` da IDE. O que muda é a moldura: aqui o
// arquivo é um documento do EDITOR (editor personalizado, ver
// `extensao/src/notebookEditor.ts`), e por isso cada mudança vai ao host, que a
// aplica no documento — o "não salvo", o Ctrl+S e o "mudou no disco" ficam do
// jeito nativo, em vez de uma gravação paralela.
//
// Pacote próprio porque arrasta o Monaco (as células são editores de verdade).
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import { NotebookHost } from '../notebook/NotebookHost';
import { abaSintetica } from './abaSintetica';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { escolherVinculo, pedirTexto } from './acoes';
import { chamarHost, ligarPonte, pedirAoHost, quandoOHostMandarDados } from './ponte';
import { achatarConexoes } from '../../shared/connections/achatar';
import type { Vinculo } from '../../shared/sql/vinculo';

declare const BRAYTECH: {
  readonly base: string;
  readonly caminho: string;
  readonly titulo: string;
  readonly conteudo: string;
  readonly tema: 'escuro' | 'claro';
  readonly fontSize: number;
  readonly tabSize: number;
  /** A pasta do workspace que contém o notebook: o limite da busca por `.venv`. */
  readonly raiz: string | null;
};

function Notebook() {
  const [conteudo, setConteudo] = useState(BRAYTECH.conteudo);
  const [rotulos, setRotulos] = useState<ReadonlyMap<string, string>>(new Map());

  // O documento mudou no editor (desfazer, git, outro editor): a tela relê.
  useEffect(
    () =>
      quandoOHostMandarDados((dados) => {
        if (typeof dados.conteudo === 'string') setConteudo(dados.conteudo);
      }),
    []
  );

  // O nome das conexões, para a barra dizer "exemplo · loja" e não um id.
  useEffect(() => {
    void Api.connections()
      .then((r) => setRotulos(new Map(achatarConexoes(r.tree).map((c) => [c.id, c.label]))))
      .catch(() => undefined);
  }, []);

  const aba = useMemo(
    () => abaSintetica('notebook', BRAYTECH.titulo, { content: conteudo, path: BRAYTECH.caminho }),
    [conteudo]
  );

  return (
    <NotebookHost
      aba={aba}
      fontSize={BRAYTECH.fontSize}
      tabSize={BRAYTECH.tabSize}
      tema={BRAYTECH.tema}
      raiz={BRAYTECH.raiz}
      onMudar={(_id, novo) => {
        setConteudo(novo);
        pedirAoHost({ tipo: 'notebookMudou', conteudo: novo });
      }}
      escolherConexao={(atual: Vinculo | null) => escolherVinculo(atual)}
      rotuloDaConexao={(v) => `${rotulos.get(v.connectionId) ?? 'conexão'} · ${v.database}`}
      escolherOpcao={(titulo, opcoes) => chamarHost<string | null>('escolher', { titulo, opcoes })}
      pedirTexto={(titulo, placeholder, inicial) =>
        pedirTexto({ titulo, placeholder, ...(inicial === undefined ? {} : { valorInicial: inicial }) })
      }
    />
  );
}

ligarPonte();
definirBaseDaApi(BRAYTECH.base);

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <ComTemaDoEditor>
        <Notebook />
      </ComTemaDoEditor>
    </StrictMode>
  );
}
