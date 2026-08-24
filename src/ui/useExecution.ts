// Execução: SQL no banco e código no runtime.
//
// O despacho é por contexto e mora aqui, num lugar só: aba SQL vai para o banco,
// o resto vai para o runner. Ter isso espalhado pelos gatilhos foi o que fez
// "▶ arquivo" mandar SQL para o Node na versão anterior.
import { useCallback, useRef, useState } from 'react';
import type { QueryResult } from '../shared/contracts';
import type { Vinculo } from '../shared/sql/vinculo';
import { Api } from './api';
import type { Workspace } from './useWorkspace';

export type ModoExecucao = 'file' | 'block' | 'function';

/** De onde o resultado de um statement vai aparecer. */
export type ModoDeStatement = 'run' | 'tab' | 'json';

export interface EstadoGrade {
  readonly resultado: QueryResult | null;
  readonly erro: string | null;
  readonly carregando: boolean;
  readonly rotulo?: string;
}

export interface LinhaSaida {
  readonly texto: string;
  readonly erro: boolean;
}

export interface Execution {
  readonly grades: ReadonlyMap<string, EstadoGrade>;
  readonly saida: readonly LinhaSaida[];
  readonly status: { readonly texto: string; readonly erro: boolean };
  /** Conexão contra a qual uma aba SQL sem vínculo será executada. */
  readonly conexaoAtiva: string | null;
  /** Há código rodando agora — é o que habilita o `Stop`. */
  readonly executando: boolean;
  definirConexaoAtiva(id: string | null): void;
  executar(modo: ModoExecucao, linguagem: string): Promise<void>;
  /**
   * Roda um texto avulso no runner, sem arquivo e sem editor (spec 051).
   *
   * É como o bloco de um caderno chega ao runner: ele tem código, mas não tem
   * Monaco — e `executar` começa lendo `ws.editorRef`.
   */
  executarTexto(linguagem: string, codigo: string): Promise<void>;
  /**
   * Executa UM statement, vindo do `Run | +Tab | JSON` do editor (spec 038).
   *
   * `modo` decide onde o resultado cai: `run` repinta a aba daquele arquivo,
   * `tab` abre uma nova ao lado, `json` abre o texto numa aba sem título.
   */
  executarStatement(
    modo: ModoDeStatement,
    statement: string,
    caminho: string | null,
    titulo: string,
    /**
     * O vínculo que a ABA já traz, para aba que não é arquivo.
     *
     * Uma aba nascida de um nó da árvore (dois cliques numa tabela, `Ver DDL`,
     * `Criar em Tables`) já sabe conexão e database, e não tem caminho — o
     * vínculo por caminho não a alcança. Sem isto ela passava a PERGUNTAR o que
     * já sabia; foi assim que a spec 038 quebrou um teste da spec 009.
     */
    daAba?: Vinculo | null
    /**
     * Devolve se deu certo.
     *
     * O erro continua sendo tratado aqui — vira aba de resultado e entra na aba
     * `Problems` —, mas quem chama precisa PODER saber. O `Run All` do caderno
     * (spec 048) para no primeiro erro, e sem este retorno ele seguia em frente
     * produzindo resultados que não queriam dizer nada.
     */
  ): Promise<boolean>;
  /** Encerra a execução em andamento, se houver. */
  parar(): Promise<void>;
  limparSaida(): void;
}

/**
 * O resultado como o usuário espera ver em JSON: uma lista de OBJETOS.
 *
 * A grade guarda linhas como vetores, com as colunas à parte — bom para desenhar
 * tabela, ilegível como JSON. Aqui as duas metades se juntam.
 */
function paraObjetos(r: QueryResult): Record<string, unknown>[] {
  return r.rows.map((linha) => {
    const objeto: Record<string, unknown> = {};
    r.columns.forEach((coluna, i) => {
      objeto[coluna.name] = linha[i] ?? null;
    });
    return objeto;
  });
}

/**
 * Avisa que algo deu errado, para a aba `Problems`.
 *
 * Injetado em vez de importado para o gancho continuar testável e para não
 * amarrar execução a painel — quem decide o que fazer com o problema é o App.
 */
export type AoFalharExecucao = (mensagem: string) => void;

/**
 * Como descobrir contra quem um arquivo roda (spec 038).
 *
 * Injetado, e não importado, pelo mesmo motivo do `aoFalhar`: o gancho continua
 * testável, e quem sabe perguntar ao usuário é o App.
 */
export interface DepsDeVinculoNaExecucao {
  vinculoDe(caminho: string | null): Vinculo | null;
  garantir(caminho: string | null): Promise<Vinculo | null>;
}

export function useExecution(
  ws: Workspace,
  aoFalhar: AoFalharExecucao = () => {},
  vinculos: DepsDeVinculoNaExecucao = { vinculoDe: () => null, garantir: async () => null }
): Execution {
  const [grades, setGrades] = useState<ReadonlyMap<string, EstadoGrade>>(new Map());
  const [saida, setSaida] = useState<readonly LinhaSaida[]>([]);
  const [status, setStatus] = useState({ texto: '', erro: false });
  const conexaoAtiva = useRef<string | null>(null);
  // Espelho em estado: o ref não provoca render, e o menu precisa saber
  // agora se há conexão para desconectar.
  const [conexaoVisivel, setConexaoVisivel] = useState<string | null>(null);
  // O id vive num ref porque `parar()` precisa dele SEM depender de re-render,
  // e num estado espelhado porque o menu precisa saber agora se há o que parar.
  const execucaoAtual = useRef<string | null>(null);
  const [executando, setExecutando] = useState(false);

  const escrever = useCallback((texto: string, erro: boolean) => {
    setSaida((atual) => [...atual, { texto, erro }]);
  }, []);

  const atualizarGrade = useCallback((id: string, estado: EstadoGrade) => {
    setGrades((atual) => new Map(atual).set(id, estado));
  }, []);



  /**
   * Onde o resultado de um arquivo mora.
   *
   * Era `grid:<conexão>` — uma aba por CONEXÃO, o que fazia duas queries do
   * mesmo banco brigarem pela mesma. Por ARQUIVO, `Run` tem onde repintar e
   * `+Tab` tem de onde se distinguir. O contador é global de propósito: o que
   * ele precisa garantir é um id novo, não uma sequência bonita.
   */
  const proximaAba = useRef(0);

  const executarStatement = useCallback(
    async (
      modo: ModoDeStatement,
      statement: string,
      caminho: string | null,
      titulo: string,
      daAba: Vinculo | null = null
    ): Promise<boolean> => {
      const texto = statement.trim();
      if (texto === '') return true;

      // Perguntar ANTES de abrir a aba: desistir da escolha não pode deixar uma
      // aba de resultado vazia para trás (AC-18).
      let vinculo: Vinculo | null;
      try {
        // O da aba tem precedência sobre perguntar, e menos que o do caminho:
        // um arquivo salvo manda mais que a memória de como a aba nasceu.
        vinculo = vinculos.vinculoDe(caminho) ?? daAba ?? (await vinculos.garantir(caminho));
      } catch (e) {
        const msg = (e as Error).message;
        setStatus({ texto: 'erro', erro: true });
        aoFalhar(msg);
        return false;
      }
      if (vinculo === null) return false;

      const base = `grid:${caminho ?? titulo}`;
      const gridId = modo === 'tab' ? `${base}#${(proximaAba.current += 1)}` : base;
      const rotulo = `${titulo} · ${vinculo.database}`;

      if (modo !== 'json') {
        ws.store.open({ id: gridId, type: 'grid', title: 'Resultado', meta: {} });
        atualizarGrade(gridId, { resultado: null, erro: null, carregando: true, rotulo });
      }

      try {
        const resultado = await Api.execute(vinculo.connectionId, {
          statement: texto,
          database: vinculo.database,
          rowLimit: 500,
        });
        if (modo === 'json') {
          ws.abrirSemTitulo(JSON.stringify(paraObjetos(resultado), null, 2), 'json');
        } else {
          atualizarGrade(gridId, { resultado, erro: null, carregando: false, rotulo });
        }
        setStatus({
          texto: `${resultado.rowCount} linha(s) · ${resultado.durationMs}ms`,
          erro: false,
        });
        return true;
      } catch (e) {
        const msg = (e as Error).message;
        if (modo !== 'json') {
          atualizarGrade(gridId, { resultado: null, erro: msg, carregando: false, rotulo });
        }
        setStatus({ texto: 'erro', erro: true });
        aoFalhar(msg);
        return false;
      }
    },
    [aoFalhar, atualizarGrade, vinculos, ws]
  );

  /**
   * O `Ctrl+Enter` de sempre, agora obedecendo ao vínculo do arquivo (spec 038).
   *
   * Antes ele caía na `conexaoAtiva` — a conexão que estava aberta na árvore —,
   * e era assim que uma query rodava no banco errado sem dar erro. Agora é o
   * MESMO caminho do `Run` do CodeLens: dois caminhos que discordassem sobre
   * onde a query roda seriam pior que nenhum.
   */
  const executarSql = useCallback(async () => {
    const aba = ws.active;
    const editor = ws.editorRef.current;
    if (aba === null || editor === null) return;

    // Havendo seleção, executa só ela — é como se depura uma query longa (AC-17).
    const statement = (editor.getSelection() || editor.getValue()).trim();
    if (statement === '') return;

    const meta = aba.meta as { path?: string | null; connectionId?: string; database?: string };
    const daAba =
      typeof meta.connectionId === 'string' && typeof meta.database === 'string'
        ? { connectionId: meta.connectionId, database: meta.database }
        : null;
    await executarStatement('run', statement, meta.path ?? null, aba.title, daAba);
  }, [executarStatement, ws]);

  /**
   * Manda um pedido ao runner e derrama o resultado no painel.
   *
   * Separado de `executarCodigo` na spec 051: o bloco de um caderno tem código,
   * mas NÃO tem editor Monaco — e `executarCodigo` começa por `ws.editorRef`.
   * Sem este corte, rodar um bloco exigiria um editor invisível só para ter de
   * onde ler o texto.
   */
  const despachar = useCallback(
    async (payload: Record<string, unknown>) => {
      // O id é gerado AQUI, e não no servidor: a resposta de `/api/run` só chega
      // no fim, e um id vindo dela não daria como parar antes disso.
      const runId = crypto.randomUUID();
      payload.runId = runId;
      execucaoAtual.current = runId;
      setExecutando(true);

      setStatus({ texto: 'executando…', erro: false });
      try {
        const r = await Api.run(payload);
        if (r.stdout !== '') escrever(r.stdout, false);
        if (r.stderr !== '') escrever(r.stderr, true);
        if (r.stdout === '' && r.stderr === '') escrever('(sem saída)\n', false);
        const ok = r.exitCode === 0 && !r.timedOut && !r.cancelled;
        // Três desfechos, não dois: cancelado e tempo esgotado viram os dois
        // `exitCode: null` (morte por sinal) e seriam indistinguíveis na tela.
        const texto = r.cancelled
          ? 'cancelado'
          : r.timedOut
            ? 'tempo esgotado (15s)'
            : `exit ${r.exitCode} · ${r.durationMs}ms`;
        setStatus({ texto, erro: !ok });
        // Cancelado NÃO é problema: o usuário pediu para parar.
        if (!ok && !r.cancelled) {
          aoFalhar(
            r.timedOut
              ? 'A execução passou de 15 s e foi interrompida.'
              : (r.stderr.trim() || `A execução terminou com código ${r.exitCode}.`)
          );
        }
      } catch (e) {
        escrever(`${(e as Error).message}\n`, true);
        setStatus({ texto: 'erro', erro: true });
        aoFalhar((e as Error).message);
      } finally {
        execucaoAtual.current = null;
        setExecutando(false);
      }
    },
    [aoFalhar, escrever]
  );

  const executarCodigo = useCallback(
    async (modo: ModoExecucao, linguagem: string, funcao?: string, args?: unknown[]) => {
      const aba = ws.active;
      const editor = ws.editorRef.current;
      if (editor === null) return;

      const meta = (aba?.meta ?? {}) as { path?: string | null };
      const caminho = meta.path ?? null;
      const sujo = aba?.dirty === true;

      const payload: Record<string, unknown> = {
        mode: modo,
        language: linguagem,
        filePath: caminho ?? undefined,
      };

      if (modo === 'file' && (sujo || caminho === null)) {
        // Sem salvar, executa o conteúdo do editor em vez do arquivo em disco.
        payload.mode = 'block';
        payload.code = editor.getValue();
      } else if (modo === 'block') {
        payload.code = editor.getSelection() || editor.getValue();
      } else if (modo === 'function') {
        if (funcao === undefined || funcao === '') {
          escrever('Nenhuma função detectada no arquivo atual.\n', true);
          return;
        }
        if (caminho === null || sujo) {
          escrever('Salve o arquivo antes de executar uma função (Ctrl+S).\n', true);
          return;
        }
        payload.functionName = funcao;
        if (args !== undefined) payload.args = args;
      }

      await despachar(payload);
    },
    [despachar, ws]
  );

  /**
   * Roda um texto avulso, sem arquivo e sem editor (spec 051, AC-7).
   *
   * É como o bloco de um caderno chega ao runner. `mode: 'block'` porque é
   * exatamente isso: um pedaço de código solto, não um arquivo em disco.
   */
  const executarTexto = useCallback(
    async (linguagem: string, codigo: string) => {
      if (codigo.trim() === '') return;
      if (linguagem === 'python') {
        escrever('Execução de Python ainda não é suportada — o runner usa Node.js.\n', true);
        return;
      }
      await despachar({ mode: 'block', language: linguagem, code: codigo });
    },
    [despachar, escrever]
  );

  const executar = useCallback(
    async (modo: ModoExecucao, linguagem: string) => {
      // O despacho por contexto: é aqui, e só aqui.
      if (ws.active?.type === 'sql') {
        await executarSql();
        return;
      }
      if (linguagem === 'python') {
        escrever('Execução de Python ainda não é suportada — o runner usa Node.js.\n', true);
        return;
      }
      await executarCodigo(modo, linguagem);
    },
    [escrever, executarCodigo, executarSql, ws]
  );

  return {
    grades,
    saida,
    status,
    conexaoAtiva: conexaoVisivel,
    executando,
    executarTexto,
    definirConexaoAtiva: (id: string | null) => {
      conexaoAtiva.current = id;
      setConexaoVisivel(id);
    },
    executar,
    executarStatement,
    parar: async () => {
      const id = execucaoAtual.current;
      if (id === null) return;
      // O `parou: false` do servidor não é tratado como erro: a execução pode
      // ter acabado entre o clique e a chamada.
      await Api.stopRun(id);
    },
    limparSaida: () => {
      setSaida([]);
      setStatus({ texto: '', erro: false });
    },
  };
}
