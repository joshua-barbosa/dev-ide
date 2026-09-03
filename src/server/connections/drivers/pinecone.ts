// Pinecone: índices → namespaces, e busca por proximidade na grade.
//
// A conta — a nota como primeira coluna, os metadados em ordem de aparição, a
// leitura do vetor com conferência de dimensão — mora em
// `shared/sql/pinecone-modelo.ts`, testada sem rede.
//
// **Não há host nem porta.** O Pinecone é um serviço, e a conexão é uma chave de
// API. Por isso o formulário tem um campo só de verdade, e ele é segredo.
import { Pinecone } from '@pinecone-database/pinecone';
import type { Driver, ResolvedConfig, Session, TreeNode } from '../types';
import type { ExecuteRequest, FieldSpec, QueryResult } from '../../../shared/contracts';
import {
  detalheDoIndice, gradeDaBusca, lerVetor, rotuloDoNamespace,
} from '../../../shared/sql/pinecone-modelo';

const CAMPOS: readonly FieldSpec[] = [
  {
    name: 'api_key',
    label: 'Chave de API',
    type: 'string',
    required: true,
    secret: true,
    help: 'A conexão do Pinecone é a chave: não há host nem porta.',
  },
  {
    name: 'topk',
    label: 'Quantos resultados por busca',
    type: 'number',
    default: 20,
    section: 'Avançado',
    help: 'O `topK` do Pinecone. Buscar mais custa mais, e raramente se lê além dos vinte.',
  },
];

async function connect(config: ResolvedConfig): Promise<Session> {
  const f = config.fields as Record<string, unknown>;
  const chave = typeof f.api_key === 'string' ? f.api_key.trim() : '';
  if (chave === '') throw new Error('Informe a chave de API do Pinecone.');

  const cliente = new Pinecone({ apiKey: chave });
  const topK = Number(f.topk) > 0 ? Math.trunc(Number(f.topk)) : 20;

  /** Guarda a dimensão de cada índice, para conferir o vetor antes de buscar. */
  const dimensoes = new Map<string, number>();

  return {
    kind: 'vector',

    children: async (nodePath) => {
      if (nodePath.length <= 1) {
        const { indexes } = await cliente.listIndexes();
        return (indexes ?? []).map((i): TreeNode => {
          const dimensao = i.dimension ?? 0;
          dimensoes.set(i.name, dimensao);
          return {
            id: i.name,
            label: i.name,
            icon: 'database',
            detail: detalheDoIndice({
              nome: i.name,
              dimensao,
              metrica: i.metric ?? '?',
              vetores: 0,
            }),
            hasChildren: true,
            meta: { indice: i.name, dimensao },
          };
        });
      }

      // Dentro de um índice: os namespaces, com a contagem de vetores.
      const indice = nodePath[1] ?? '';
      const estatisticas = await cliente.index(indice).describeIndexStats();
      dimensoes.set(indice, estatisticas.dimension ?? dimensoes.get(indice) ?? 0);

      const espacos = estatisticas.namespaces ?? {};
      return Object.entries(espacos).map(([nome, dados]): TreeNode => ({
        id: nome,
        label: rotuloDoNamespace(nome),
        icon: 'table',
        detail: String((dados as { recordCount?: number }).recordCount ?? 0),
        hasChildren: false,
        meta: { indice, namespace: nome },
        actions: [{ id: 'pinecone-buscar', label: 'Abrir busca' }],
      }));
    },

    execute: async (request: ExecuteRequest): Promise<QueryResult> => {
      const comeco = Date.now();
      // Primeira linha: `indice` ou `indice/namespace`. Resto: o vetor.
      const linhas = request.statement.split('\n');
      const alvo = (linhas[0] ?? '').trim();
      const corpo = linhas.slice(1).join('\n').trim();

      const barra = alvo.indexOf('/');
      const indice = barra === -1 ? alvo : alvo.slice(0, barra);
      const namespace = barra === -1 ? '' : alvo.slice(barra + 1);
      if (indice === '') {
        throw new Error(
          'A primeira linha deve ser o índice (ou `indice/namespace`). ' +
            'As linhas seguintes são o vetor, como lista JSON de números.'
        );
      }

      let dimensao = dimensoes.get(indice);
      if (dimensao === undefined) {
        const est = await cliente.index(indice).describeIndexStats();
        dimensao = est.dimension ?? 0;
        dimensoes.set(indice, dimensao);
      }

      const vetor = lerVetor(corpo, dimensao);
      if ('erro' in vetor) throw new Error(vetor.erro);

      const alvoIndice = cliente.index(indice);
      const busca = await (namespace === '' ? alvoIndice : alvoIndice.namespace(namespace)).query({
        vector: [...vetor.vetor],
        topK: request.rowLimit ?? topK,
        includeMetadata: true,
      });

      const { colunas, linhas: grade } = gradeDaBusca(
        (busca.matches ?? []).map((m) => ({
          id: m.id,
          score: m.score ?? 0,
          metadata: m.metadata as Record<string, unknown> | undefined,
        }))
      );

      return {
        columns: colunas.map((name) => ({ name, type: name === 'score' ? 'number' : 'text' })),
        rows: grade.map((l) => [...l]),
        rowCount: grade.length,
        durationMs: Date.now() - comeco,
        truncated: false,
      };
    },

    runAction: async (request) => {
      const indice = request.nodePath[1] ?? '';
      const namespace = request.nodePath[request.nodePath.length - 1] ?? '';
      const dimensao = dimensoes.get(indice) ?? 0;
      return {
        kind: 'statement',
        title: `${indice}/${rotuloDoNamespace(namespace)}`,
        // O esqueleto já traz a dimensão certa: sem isso, a primeira busca
        // sempre falha por tamanho, e a mensagem do Pinecone não diz o esperado.
        content:
          `${indice}${namespace === '' ? '' : `/${namespace}`}\n` +
          `[${Array.from({ length: Math.min(dimensao, 8) }, () => '0').join(', ')}` +
          `${dimensao > 8 ? `, … (${dimensao} números no total)` : ''}]\n`,
      };
    },

    serverInfo: async () => {
      const { indexes } = await cliente.listIndexes();
      return { version: 'Pinecone', extra: `${(indexes ?? []).length} índice(s)` };
    },

    close: async () => {
      // Não há socket a fechar: o cliente do Pinecone fala HTTP por chamada.
    },
  } as Session;
}

export const pineconeDriver: Driver = {
  type: 'pinecone',
  label: 'Pinecone',
  kind: 'vector',
  panel: 'database',
  icon: 'database',
  fields: CAMPOS,
  connect,
};
