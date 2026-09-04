// As abas da IDE que NÃO precisam do Monaco: tabela, chave, resultado,
// servidor e processos.
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
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryResult } from '../../shared/contracts';
import { pedidoDeConsulta } from '../../shared/sql/pedido-de-execucao';
import { Api } from '../api';
import { definirBaseDaApi } from '../api-http';
import { ChaveHost } from '../chaves/ChaveHost';
import { ResultGrid } from '../grid/ResultGrid';
import { TabelaHost } from '../tabela/TabelaHost';
import { ServidorHost } from '../servidor/ServidorHost';
import { ProcessosHost } from '../processos/ProcessosHost';
import { useContextMenu } from '../ContextMenu';
import { pedirTexto } from './acoes';
import type { SessionCapabilities } from '../../shared/contracts';
import { useQuickInput } from '../useQuickInput';
import { QuickInput } from '../QuickInput';
import { abaSintetica } from './abaSintetica';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { ligarPonte, pedirAoHost, quandoOHostMandarDados } from './ponte';
import { dialogosNativos } from './dialogos';

declare const BRAYTECH: {
  readonly base: string;
  readonly tipo: 'tabela' | 'chave' | 'resultado' | 'servidor' | 'processos';
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


/**
 * A aba do SERVIDOR — Monitor, SFTP e Port Forwarding.
 *
 * Quais divisórias existem é a SESSÃO que diz, pelas capacidades, e por isso
 * elas são buscadas aqui antes de desenhar: com `null` o `ServidorHost` não
 * mostra divisória nenhuma, e a aba pareceria vazia por um instante.
 */
function AbaDoServidor({ conexaoId, rotulo, somenteLeitura, menu, confirmar, onErro }: {
  readonly conexaoId: string;
  readonly rotulo: string;
  readonly somenteLeitura: boolean;
  readonly menu: ReturnType<typeof useContextMenu>;
  readonly confirmar: ReturnType<typeof dialogosNativos>['confirmar'];
  readonly onErro: (e: unknown) => void;
}) {
  const [capacidades, setCapacidades] = useState<SessionCapabilities | null>(null);

  useEffect(() => {
    let vivo = true;
    // `connect` numa conexão JÁ aberta devolve as capacidades sem abrir sessão
    // nova — é o mesmo caminho que o painel usa ao expandir a árvore.
    Api.connect(conexaoId)
      .then((c) => { if (vivo) setCapacidades(c); })
      .catch(onErro);
    return () => { vivo = false; };
  }, [conexaoId, onErro]);

  return (
    <ServidorHost
      conexaoId={conexaoId}
      rotulo={rotulo}
      capacidades={capacidades}
      somenteLeitura={somenteLeitura}
      onAbrirArquivo={async (id, caminho) => {
        pedirAoHost({ tipo: 'abrirArquivoRemoto', conexaoId: id, caminho });
      }}
      // O terminal é o do editor, com fonte, busca e histórico próprios — a
      // spec 099 já o entregou, e a sub-aba de Terminal daqui só o chama.
      onAbrirTerminal={() => pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexaoId, rotulo })}
      abrirMenu={menu.abrir}
      confirmar={confirmar}
      // A caixa NATIVA do editor: `window.prompt` devolveria `null` calado
      // dentro da webview, e o clique não faria nada.
      pedirTexto={pedirTexto}
      onErro={onErro}
    />
  );
}

/**
 * A aba de PROCESSOS, com o Manager ao lado.
 *
 * `ativa` vem do `visibilityState`: a aba do editor continua montada quando
 * some de vista, e um relógio que sobrevive a isso consultaria o banco dele a
 * cada dois segundos, para sempre, sem ninguém olhando.
 */
function AbaDeProcessos({ conexaoId, titulo, somenteLeitura, confirmar, onErro }: {
  readonly conexaoId: string;
  readonly titulo: string;
  readonly somenteLeitura: boolean;
  readonly confirmar: ReturnType<typeof dialogosNativos>['confirmar'];
  readonly onErro: (e: unknown) => void;
}) {
  const [bancos, setBancos] = useState<readonly string[]>([]);
  const [ativa, setAtiva] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const ver = (): void => setAtiva(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', ver);
    return () => document.removeEventListener('visibilitychange', ver);
  }, []);

  useEffect(() => {
    let vivo = true;
    // A MESMA regra do `App`: banco é o nó da raiz que tem filhos.
    Api.children(conexaoId, [])
      .then((nos) => {
        if (vivo) setBancos(nos.filter((n) => n.hasChildren).map((n) => n.label));
      })
      .catch(onErro);
    return () => { vivo = false; };
  }, [conexaoId, onErro]);

  return (
    <ProcessosHost
      aba={abaSintetica('processos', titulo, { connectionId: conexaoId })}
      ativa={ativa}
      bancos={bancos}
      somenteLeitura={somenteLeitura}
      onAbrirSql={(nome, sql) =>
        pedirAoHost({
          tipo: 'abrirQuery',
          connectionId: conexaoId,
          database: null,
          titulo: `${nome}.sql`,
          conteudo: sql,
        })
      }
      onConfirmar={(mensagem, tituloDoAviso) =>
        confirmar({
          titulo: tituloDoAviso,
          mensagem,
          rotuloConfirmar: 'Confirmar',
          destrutivo: true,
        })
      }
      onErro={onErro}
    />
  );
}

function Aba() {
  const qi = useQuickInput();
  const menu = useContextMenu((e) => erro(e));
  const [dialogs] = useState(dialogosNativos);
  // Os dados da aba MUDAM: o `▷ Run` do caderno reenvia o resultado para esta
  // mesma aba em vez de abrir uma por execução.
  const [dados, setDados] = useState(BRAYTECH.dados);
  useEffect(() => quandoOHostMandarDados(setDados), []);

  const erro = useCallback((e: unknown): void => {
    pedirAoHost({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
  }, []);

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

  if (BRAYTECH.tipo === 'servidor') {
    return (
      <>
        <AbaDoServidor
          conexaoId={texto('conexaoId')}
          rotulo={texto('rotulo')}
          somenteLeitura={BRAYTECH.dados.somenteLeitura === true}
          menu={menu}
          confirmar={dialogs.confirmar}
          onErro={erro}
        />
        {menu.elemento}
      </>
    );
  }

  if (BRAYTECH.tipo === 'processos') {
    return (
      <AbaDeProcessos
        conexaoId={texto('conexaoId')}
        titulo={BRAYTECH.titulo}
        somenteLeitura={BRAYTECH.dados.somenteLeitura === true}
        confirmar={dialogs.confirmar}
        onErro={erro}
      />
    );
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
