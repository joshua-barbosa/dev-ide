// O `.sqlbook` desenhado como CADERNO, numa aba do editor.
//
// Ele mandou o print: o arquivo abrindo como JSON cru, com `versao`, `celulas`,
// `linguagem`, `conteudo`. Eu tinha mandado um aviso dizendo que era assim "por
// enquanto" — mas o caderno já existe pronto na IDE, e o que faltava era
// hospedá-lo.
//
// Pacote próprio porque é o único que arrasta o Monaco (os blocos são editores
// de verdade, com realce e o mesmo tokenizador da IDE).
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryResult } from '../../shared/contracts';
import type { ResultadoSalvo } from '../../shared/sql/caderno';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import { CadernoHost } from '../caderno/CadernoHost';
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
          const r = await Api.execute(vinculo.connectionId, {
            statement: sql,
            database: vinculo.database,
          });
          // `tab` e `json` pedem uma janela; `run` desenha no próprio bloco.
          if (modo === 'tab') {
            pedirAoHost({ tipo: 'abrirResultado', titulo, resultado: r });
          } else if (modo === 'json') {
            pedirAoHost({
              tipo: 'abrirSemTitulo',
              conteudo: JSON.stringify(r, null, 2),
              linguagem: 'json',
            });
          }
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
          const r = await Api.run({ language: linguagem, code: codigo });
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
