// As ações de alterar estrutura, na aba `Estrutura` (spec 046).
//
// Cada ação pergunta o que falta, pede o comando ao servidor e o ABRE numa aba
// amarrada à conexão. Nada executa: quem roda é o usuário, com o `▷ Run` da
// spec 038.
//
// O que o dialeto não faz **não vira botão** — a lista vem do servidor, e a
// rota recusa de novo se algo escapar. Esconder o botão é conveniência; a
// recusa é a garantia.
import { useEffect, useState } from 'react';
import { Api } from '../api';
import type { QuickInputController } from '../useQuickInput';

export interface AcoesDeAlteracao {
  /** O que este banco sabe alterar. Vazio enquanto não chegou. */
  readonly permitidas: ReadonlySet<string>;
  readonly dialeto: string;
  /** Pergunta o que falta, gera o comando e o abre. */
  executar(tipo: string, contexto?: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface DepsDeAlteracao {
  readonly qi: QuickInputController;
  readonly connectionId: string;
  readonly nodePath: readonly string[];
  readonly database: string | null;
  /** Abre o comando gerado numa aba de query, amarrada à conexão. */
  abrirComando(id: string, titulo: string, sql: string): void;
  /** A conexão é somente-leitura: nada disto aparece. */
  readonly somenteLeitura: boolean;
}

export function useAlteracoes(deps: DepsDeAlteracao): AcoesDeAlteracao {
  const { qi, connectionId, nodePath, somenteLeitura } = deps;
  const [permitidas, setPermitidas] = useState<ReadonlySet<string>>(new Set());
  const [dialeto, setDialeto] = useState('');

  useEffect(() => {
    if (somenteLeitura || connectionId === '') return;
    Api.alterCapabilities(connectionId)
      .then((caps) => {
        setPermitidas(new Set(caps.operacoes));
        setDialeto(caps.dialeto);
      })
      // Sem capacidades a aba fica só de leitura, que é o desfecho seguro.
      .catch(() => setPermitidas(new Set()));
  }, [connectionId, somenteLeitura]);

  /** Pergunta um texto obrigatório; `null` quando o usuário desiste. */
  const pedir = async (titulo: string, placeholder: string, inicial = ''): Promise<string | null> => {
    const valor = await qi.pedir({ titulo, placeholder, valorInicial: inicial });
    return valor === null || valor.trim() === '' ? null : valor.trim();
  };

  /** Uma entre N opções fechadas. Digitar livre aqui viraria erro no banco. */
  const pedirEntre = async (titulo: string, opcoes: readonly string[]): Promise<string | null> => {
    const valor = await qi.pedir({
      titulo,
      placeholder: opcoes.join(' · '),
      opcoes: opcoes.map((o) => ({ valor: o, rotulo: o })),
    });
    return valor === null || valor === '' ? null : valor;
  };

  /**
   * As regras de integridade referencial.
   *
   * Lista fechada por dois motivos: o servidor recusa o que não estiver nela, e
   * essa é a parte da FK que entra no comando SEM aspas.
   */
  const pedirRegra = (titulo: string): Promise<string | null> =>
    pedirEntre(titulo, ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']);

  const pedirSimNao = async (titulo: string): Promise<boolean | null> => {
    const r = await qi.pedir({
      titulo,
      placeholder: 'Sim ou não',
      opcoes: [
        { valor: 'sim', rotulo: 'Sim' },
        { valor: 'nao', rotulo: 'Não' },
      ],
    });
    return r === null ? null : r === 'sim';
  };

  /** Monta a operação perguntando só o que aquele tipo precisa. */
  const montarOperacao = async (
    tipo: string,
    ctx: Readonly<Record<string, unknown>>
  ): Promise<Record<string, unknown> | null> => {
    const coluna = typeof ctx.coluna === 'string' ? ctx.coluna : '';

    if (tipo === 'renomear-tabela') {
      const novo = await pedir('Renomear a tabela', 'Novo nome', String(ctx.nome ?? ''));
      return novo === null ? null : { tipo, novo };
    }
    if (tipo === 'comentario-tabela') {
      // Vazio é resposta aqui: apagar o comentário é uma intenção legítima.
      const texto = await qi.pedir({
        titulo: 'Comentário da tabela',
        placeholder: 'Texto do comentário',
        valorInicial: String(ctx.comentario ?? ''),
        permiteVazio: true,
      });
      return texto === null ? null : { tipo, texto };
    }
    if (tipo === 'renomear-coluna') {
      const novo = await pedir(`Renomear a coluna "${coluna}"`, 'Novo nome', coluna);
      return novo === null ? null : { tipo, coluna, novo };
    }
    if (tipo === 'apagar-coluna') return { tipo, coluna };
    if (tipo === 'apagar-indice' || tipo === 'apagar-chave-estrangeira') {
      return { tipo, nome: String(ctx.nome ?? '') };
    }
    if (tipo === 'acrescentar-coluna' || tipo === 'alterar-coluna') {
      const nome = tipo === 'alterar-coluna'
        ? coluna
        : await pedir('Nome da coluna nova', 'ex.: criado_em');
      if (nome === null) return null;
      const tipoSql = await pedir(
        `Tipo de "${nome}"`,
        'ex.: varchar(255), int, timestamp',
        String(ctx.tipoAtual ?? '')
      );
      if (tipoSql === null) return null;
      const obrigatoria = await pedirSimNao(`"${nome}" é obrigatória (NOT NULL)?`);
      if (obrigatoria === null) return null;
      const padrao = await qi.pedir({
        titulo: `Valor padrão de "${nome}"`,
        placeholder: 'vazio = sem DEFAULT',
        permiteVazio: true,
      });
      if (padrao === null) return null;
      return {
        tipo,
        coluna: nome,
        tipoSql,
        obrigatoria,
        padrao: padrao.trim() === '' ? null : padrao,
      };
    }
    // ---- Spec 069: chave estrangeira, checagem, gatilho e colação ----
    if (tipo === 'criar-chave-estrangeira') {
      const nome = await pedir('Nome da chave estrangeira', 'ex.: fk_turma');
      if (nome === null) return null;
      const coluna = await pedir('Coluna desta tabela', 'ex.: turma_id');
      if (coluna === null) return null;
      const tabelaRef = await pedir('Tabela referenciada', 'ex.: turmas');
      if (tabelaRef === null) return null;
      const colunaRef = await pedir('Coluna referenciada', 'ex.: id');
      if (colunaRef === null) return null;
      const aoAtualizar = await pedirRegra('Ao ATUALIZAR o pai');
      if (aoAtualizar === null) return null;
      const aoApagar = await pedirRegra('Ao APAGAR o pai');
      if (aoApagar === null) return null;
      return { tipo, nome, coluna, tabelaRef, colunaRef, aoAtualizar, aoApagar };
    }
    if (tipo === 'criar-checagem') {
      const nome = await pedir('Nome da checagem', 'ex.: ck_idade');
      if (nome === null) return null;
      const expressao = await pedir('Expressão', 'ex.: idade >= 0');
      if (expressao === null) return null;
      return { tipo, nome, expressao };
    }
    if (tipo === 'criar-gatilho') {
      const nome = await pedir('Nome do gatilho', 'ex.: tg_audita');
      if (nome === null) return null;
      const momento = await pedirEntre('Quando', ['BEFORE', 'AFTER']);
      if (momento === null) return null;
      const evento = await pedirEntre('Em qual escrita', ['INSERT', 'UPDATE', 'DELETE']);
      if (evento === null) return null;
      // No PostgreSQL o gatilho CHAMA uma função; nos outros ele traz o corpo.
      // A pergunta muda com o dialeto porque a resposta é outra coisa.
      const corpo =
        dialeto === 'PostgreSQL'
          ? await pedir('Função que o gatilho chama', 'ex.: fn_audita')
          : await pedir('Corpo (um comando)', 'ex.: SET NEW.nome = TRIM(NEW.nome);');
      if (corpo === null) return null;
      return { tipo, nome, momento, evento, corpo };
    }
    if (tipo === 'colacao-tabela') {
      const conjunto = await pedir('Conjunto de caracteres', 'ex.: utf8mb4');
      if (conjunto === null) return null;
      const colacao = await pedir(
        'Colação',
        'ex.: utf8mb4_unicode_ci',
        String(ctx.colacao ?? '')
      );
      if (colacao === null) return null;
      return { tipo, conjunto, colacao };
    }
    if (tipo === 'colacao-coluna') {
      const coluna = await pedir('Coluna', 'a coluna de texto a converter');
      if (coluna === null) return null;
      const tipoSql = await pedir('Tipo da coluna', 'ex.: text, varchar(255)');
      if (tipoSql === null) return null;
      const colacao = await pedir('Colação', 'ex.: pt_BR.utf8, C');
      if (colacao === null) return null;
      return { tipo, coluna, tipoSql, colacao };
    }
    if (tipo === 'criar-indice') {
      const nome = await pedir('Nome do índice', 'ex.: idx_nome');
      if (nome === null) return null;
      const colunas = await pedir('Colunas do índice', 'separadas por vírgula');
      if (colunas === null) return null;
      const unico = await pedirSimNao('O índice é único?');
      if (unico === null) return null;
      return {
        tipo,
        nome,
        colunas: colunas.split(',').map((c) => c.trim()).filter((c) => c !== ''),
        unico,
      };
    }
    return null;
  };

  return {
    permitidas,
    dialeto,
    executar: async (tipo, contexto = {}) => {
      const operacao = await montarOperacao(tipo, contexto);
      if (operacao === null) return;
      const r = await Api.alterStructure(connectionId, { nodePath, operacao });
      // Id com o tipo e o alvo: pedir a mesma alteração duas vezes reaproveita
      // a aba, em vez de encher a barra.
      deps.abrirComando(
        `alter:${connectionId}:${tipo}:${r.titulo}`,
        `${r.titulo}.sql`,
        r.sql
      );
    },
  };
}
