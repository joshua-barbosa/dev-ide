// As abas da IDE que NÃO precisam do Monaco: tabela, chave e resultado.
//
// Ele mandou o print da grade e escreveu *"Tabela ainda mostrando com visual
// errado"*. Estava certo: eu desenhava uma `<table>` à mão no host, sem
// ordenação, sem paginação, sem visor de célula, sem a sub-aba de estrutura —
// uma imitação pobre de algo que já existe pronto.
//
// Aqui rodam `TabelaHost`, `ChaveHost` e `ResultGrid`, os mesmos da IDE.
//
// Separado do caderno mesmo assim: os dois arrastam o Monaco (este por
// `CampoColorido` e `VisorDeCelula`, que colorem com o tokenizador do editor),
// mas o caderno MONTA editores de verdade, e uma aba de grade não tem por que
// pagar por isso.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryResult } from '../../shared/contracts';
import { pedidoDeConsulta } from '../../shared/sql/pedido-de-execucao';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import { ChaveHost } from '../chaves/ChaveHost';
import { ResultGrid } from '../grid/ResultGrid';
import { TabelaHost } from '../tabela/TabelaHost';
import { useQuickInput } from '../useQuickInput';
import { QuickInput } from '../QuickInput';
import { abaSintetica } from './abaSintetica';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { ligarPonte, pedirAoHost, quandoOHostMandarDados } from './ponte';
import { dialogosNativos } from './dialogos';

declare const BRAYTECH: {
  readonly base: string;
  readonly tipo: 'tabela' | 'chave' | 'resultado';
  readonly titulo: string;
  readonly tema: 'escuro' | 'claro';
  readonly fontSize: number;
  readonly tabSize: number;
  readonly dados: Record<string, unknown>;
};

function texto(chave: string): string {
  const v = BRAYTECH.dados[chave];
  return typeof v === 'string' ? v : '';
}

interface Consulta {
  readonly connectionId: string;
  readonly database: string;
  readonly statement: string;
}

/**
 * A aba `Result`, com a paginação da IDE.
 *
 * O `+Tab` mandava as linhas prontas e nada mais, e a grade parava na primeira
 * página — "não está fazendo paginação". Paginar é rodar a MESMA consulta com
 * outro `offset`, então o que faltava era a consulta chegar aqui.
 *
 * O estado nasce dos dados da webview e é TROCADO quando o host manda outros:
 * o `▷ Run` do caderno reaproveita esta aba a cada execução.
 */
function AbaDeResultado({ dados, titulo }: {
  readonly dados: Record<string, unknown>;
  readonly titulo: string;
}) {
  const consulta = dados.consulta as Consulta | undefined;
  const [estado, setEstado] = useState(() => ({
    resultado: dados.resultado as QueryResult,
    pagina: 1,
    carregando: false,
    erro: null as string | null,
  }));

  useEffect(() => {
    setEstado({
      resultado: dados.resultado as QueryResult,
      pagina: 1,
      carregando: false,
      erro: null,
    });
  }, [dados]);

  const irPara = (pagina: number): void => {
    if (consulta === undefined) return;
    setEstado((a) => ({ ...a, carregando: true, erro: null, pagina }));
    void Api.execute(
      consulta.connectionId,
      pedidoDeConsulta(consulta.statement, consulta.database, pagina)
    )
      .then((r) => setEstado({ resultado: r, pagina, carregando: false, erro: null }))
      .catch((e: unknown) =>
        setEstado((a) => ({
          ...a,
          carregando: false,
          erro: e instanceof Error ? e.message : String(e),
        }))
      );
  };

  return (
    <ResultGrid
      resultado={estado.resultado}
      erro={estado.erro}
      carregando={estado.carregando}
      rotulo={titulo}
      pagina={estado.pagina}
      // Só há para onde ir quando a página veio CHEIA — botão de página num
      // resultado de três linhas seria ruído — ou quando JÁ se virou uma: a
      // última página não vem cortada, e sem esta metade as setas sumiriam
      // justamente ali, deixando quem chegou ao fim sem caminho de volta.
      // Sem consulta não há como repetir nada, e o botão seria quebrado.
      {...(consulta !== undefined &&
      (estado.resultado?.truncated === true || estado.pagina > 1)
        ? { irPara }
        : {})}
    />
  );
}

function Aba() {
  const qi = useQuickInput();
  const [dialogs] = useState(dialogosNativos);
  // Os dados da aba MUDAM: o `▷ Run` do caderno reenvia o resultado para esta
  // mesma aba em vez de abrir uma por execução.
  const [dados, setDados] = useState(BRAYTECH.dados);
  useEffect(() => quandoOHostMandarDados(setDados), []);

  const erro = (e: unknown): void => {
    pedirAoHost({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
  };

  if (BRAYTECH.tipo === 'chave') {
    return (
      <ChaveHost
        conexaoId={texto('conexaoId')}
        chave={texto('chave')}
        somenteLeitura={BRAYTECH.dados.somenteLeitura === true}
      />
    );
  }

  if (BRAYTECH.tipo === 'resultado') {
    return <AbaDeResultado dados={dados} titulo={BRAYTECH.titulo} />;
  }

  return (
    <>
      <TabelaHost
        aba={abaSintetica('tabela', BRAYTECH.titulo, BRAYTECH.dados)}
        somenteLeitura={BRAYTECH.dados.somenteLeitura === true}
        qi={qi}
        tema={BRAYTECH.tema}
        fontSize={BRAYTECH.fontSize}
        tabSize={BRAYTECH.tabSize}
        onErro={erro}
        // Exportar abre uma aba sem título no editor, que é onde ele salva.
        onExportar={(conteudo, linguagem) =>
          pedirAoHost({ tipo: 'abrirSemTitulo', conteudo, linguagem })
        }
        // O SQL gerado por uma alteração vai para uma aba de query da conexão:
        // quem executa é ele, depois de ler.
        abrirComando={(id, titulo, sql) =>
          pedirAoHost({
            tipo: 'abrirQuery',
            connectionId: id,
            database: typeof BRAYTECH.dados.database === 'string' ? BRAYTECH.dados.database : null,
            titulo: `${titulo}.sql`,
            conteudo: sql,
          })
        }
        onConfirmar={(mensagem, titulo) =>
          dialogs.confirmar({ titulo, mensagem, rotuloConfirmar: 'Aplicar', destrutivo: true })
        }
      />
      {/* A entrada rápida das alterações. Numa aba de largura inteira ela cabe;
          era na coluna de 300 px que não cabia. */}
      <QuickInput
        aberto={qi.pedido !== null}
        titulo={qi.pedido?.titulo}
        placeholder={qi.pedido?.placeholder ?? ''}
        opcoes={qi.pedido?.opcoes}
        valorInicial={qi.pedido?.valorInicial}
        erro={qi.pedido?.erro ?? null}
        permiteVazio={qi.pedido?.permiteVazio === true}
        filtrar={qi.pedido?.filtrar}
        onConfirmar={qi.confirmar}
        onCancelar={qi.cancelar}
      />
    </>
  );
}

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
