// Execução: SQL no banco e código no runtime.
//
// O despacho é por contexto e mora aqui, num lugar só: aba SQL vai para o banco,
// o resto vai para o runner. Ter isso espalhado pelos gatilhos foi o que fez
// "▶ arquivo" mandar SQL para o Node na versão anterior.
import { useCallback, useRef, useState } from 'react';
import type { QueryResult } from '../shared/contracts';
import { Api } from './api';
import type { Workspace } from './useWorkspace';

export type ModoExecucao = 'file' | 'block' | 'function';

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
  /** Encerra a execução em andamento, se houver. */
  parar(): Promise<void>;
  limparSaida(): void;
}

/**
 * Avisa que algo deu errado, para a aba `Problems`.
 *
 * Injetado em vez de importado para o gancho continuar testável e para não
 * amarrar execução a painel — quem decide o que fazer com o problema é o App.
 */
export type AoFalharExecucao = (mensagem: string) => void;

export function useExecution(ws: Workspace, aoFalhar: AoFalharExecucao = () => {}): Execution {
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

  const executarSql = useCallback(async () => {
    const aba = ws.active;
    const editor = ws.editorRef.current;
    if (aba === null || editor === null) return;

    const meta = aba.meta as { connectionId?: string };
    const connectionId = meta.connectionId ?? conexaoAtiva.current;
    if (connectionId === null || connectionId === undefined) {
      escrever('Nenhuma conexão ativa. Abra uma conexão no painel Database.\n', true);
      return;
    }

    // Havendo seleção, executa só ela — é como se depura uma query longa.
    const statement = (editor.getSelection() || editor.getValue()).trim();
    if (statement === '') return;

    const gridId = `grid:${connectionId}`;
    ws.store.open({ id: gridId, type: 'grid', title: 'Resultado', meta: {} });
    atualizarGrade(gridId, { resultado: null, erro: null, carregando: true, rotulo: aba.title });

    try {
      const resultado = await Api.execute(connectionId, { statement, rowLimit: 500 });
      atualizarGrade(gridId, { resultado, erro: null, carregando: false, rotulo: aba.title });
      setStatus({ texto: `${resultado.rowCount} linha(s) · ${resultado.durationMs}ms`, erro: false });
    } catch (e) {
      const msg = (e as Error).message;
      atualizarGrade(gridId, { resultado: null, erro: msg, carregando: false, rotulo: aba.title });
      setStatus({ texto: 'erro', erro: true });
      aoFalhar(msg);
    }
  }, [aoFalhar, atualizarGrade, escrever, ws]);

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
    [aoFalhar, escrever, ws]
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
    definirConexaoAtiva: (id: string | null) => {
      conexaoAtiva.current = id;
      setConexaoVisivel(id);
    },
    executar,
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
