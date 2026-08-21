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
