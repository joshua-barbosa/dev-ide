// O `.sqlbook` desenhado como CADERNO, numa aba do editor.
//
// Ele mandou o print: o arquivo abrindo como JSON cru, com `versao`, `celulas`,
// `linguagem`, `conteudo`. Eu tinha mandado um aviso dizendo que era assim "por
// enquanto" — mas o caderno já existe pronto na IDE, e o que faltava era
// hospedá-lo.
//
// Pacote próprio porque é o único que arrasta o Monaco (os blocos são editores
// de verdade, com realce e o mesmo tokenizador da IDE).
import { StrictMode, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryResult } from '../../shared/contracts';
import type { ResultadoSalvo } from '../../shared/sql/caderno';
import { pedidoAoRunner, pedidoDeConsulta } from '../../shared/sql/pedido-de-execucao';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import { CadernoHost } from '../caderno/CadernoHost';
import { useCodebase } from '../sql/useCodebase';
import { abaSintetica } from './abaSintetica';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { escolherSimNao, escreverNaSaida, mostrarSaida, pedirTexto } from './acoes';
import { chamarHost, ligarPonte, pedirAoHost } from './ponte';

declare const BRAYTECH: {
  readonly base: string;
  readonly caminho: string;
  readonly titulo: string;
  readonly conteudo: string;
  readonly tema: 'escuro' | 'claro';
  readonly fontSize: number;
  readonly tabSize: number;
  readonly connectionId: string | null;
  readonly database: string | null;
};

function Caderno() {
  const [conteudo, setConteudo] = useState(BRAYTECH.conteudo);
  /** Quantos `+Tab` já saíram: cada um abre uma aba SUA, ao lado das outras. */
  const proxima = useRef(0);

  const erro = useCallback((e: unknown) => {
    pedirAoHost({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
  }, []);

  // Gravar é pela mesma rota de arquivo da IDE: o `.sqlbook` aberto aqui é o
  // MESMO arquivo que aparece lá, e o disco é a única fonte de verdade.
  const mudar = useCallback(
    (_id: string, novo: string) => {
      setConteudo(novo);
      Api.saveFile(BRAYTECH.caminho, novo).catch(erro);
    },
    [erro]
  );

  const vinculo =
    BRAYTECH.connectionId === null || BRAYTECH.database === null
      ? null
      : { connectionId: BRAYTECH.connectionId, database: BRAYTECH.database };

  // O catálogo do banco alimenta o autocomplete do bloco de SQL (T053). Faltava
  // aqui: o Monaco do bloco subia sem provedor nenhum, e completar não fazia
  // nada. Recebe o VÍNCULO inteiro — a mesma fonte que o `▷ Run` usa —, e por
  // isso nunca sugere tabela de outro banco.
  useCodebase(vinculo);

  return (
    <CadernoHost
      aba={abaSintetica('caderno', BRAYTECH.titulo, {
        content: conteudo,
        path: BRAYTECH.caminho,
      })}
      fontSize={BRAYTECH.fontSize}
      tabSize={BRAYTECH.tabSize}
      tema={BRAYTECH.tema}
      vinculo={vinculo}
      onMudar={mudar}
      onRodar={async (modo, sql, _caminho, titulo): Promise<QueryResult | null> => {
        if (vinculo === null) {
          erro(new Error('Este caderno não está amarrado a uma conexão.'));
          return null;
        }
        try {
          const r = await Api.execute(
            vinculo.connectionId,
            pedidoDeConsulta(sql, vinculo.database)
          );
          if (modo === 'json') {
            pedirAoHost({
              tipo: 'abrirSemTitulo',
              conteudo: JSON.stringify(r, null, 2),
              linguagem: 'json',
            });
            return r;
          }
          // **`run` TAMBÉM abre a grade** — é o que a IDE faz, e eu tinha
          // escrito aqui que ele "desenha no próprio bloco". Não desenha em
          // lugar nenhum: o resultado só ia parar na memória do bloco, e o
          // botão parecia não fazer nada.
          //
          // A diferença entre os dois é o TÍTULO, porque é ele que dá nome à
          // aba no host: `run` repinta sempre a mesma, `+Tab` abre a próxima ao
          // lado — que é a razão de o `+Tab` existir.
          const base = `${titulo} · ${vinculo.database}`;
          pedirAoHost({
            tipo: 'abrirResultado',
            titulo: modo === 'tab' ? `${base} (${(proxima.current += 1)})` : base,
            resultado: r,
            // Com a consulta, a aba vira a página sozinha.
            consulta: { ...vinculo, statement: sql },
          });
          return r;
        } catch (e) {
          erro(e);
          return null;
        }
      }}
      onRodarCodigo={async (linguagem, codigo) => {
        // A saída vai para o canal do VS Code, que é o par do painel `Output`.
        mostrarSaida();
        try {
          const r = await Api.run({ ...pedidoAoRunner(linguagem, codigo) });
          const saida = [r.stdout, r.stderr].filter((t) => t !== '').join('\n');
          escreverNaSaida(saida === '' ? '(sem saída)' : saida, r.stderr !== '');
        } catch (e) {
          erro(e);
        }
      }}
      onPedirLinguagem={(atual) =>
        chamarHost<string | null>('escolher', {
          titulo: `Linguagem do bloco (atual: ${atual})`,
          opcoes: ['sql', 'markdown', 'javascript', 'typescript', 'python', 'bash'].map((l) => ({
            valor: l,
            rotulo: l,
          })),
        })
      }
      onPedirNome={() => pedirTexto({ titulo: 'Nome do resultado guardado' })}
      onAbrirResultadoSalvo={(titulo, salvo: ResultadoSalvo) => {
        pedirAoHost({
          tipo: 'abrirResultado',
          titulo,
          resultado: {
            // `ColumnInfo` usa `name`. Com `nome` o cabeçalho sai vazio — e o
            // `as unknown` abaixo escondia isso do compilador.
            columns: salvo.colunas.map((name) => ({ name })),
            rows: salvo.linhas,
            rowCount: salvo.linhas.length,
            durationMs: 0,
            truncated: salvo.cortado,
          } as unknown as QueryResult,
        });
      }}
      onTrocarVinculo={() => {
        void escolherSimNao(
          'A troca de vínculo ainda mora na IDE. Abrir o caderno por outra conexão?'
        );
      }}
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
        <Caderno />
      </ComTemaDoEditor>
    </StrictMode>
  );
}
