// MongoDB: bancos → coleções → documentos, na mesma árvore e na mesma grade.
//
// A parte que erra — achatar documentos em colunas, montar a URI, ler o filtro —
// mora em `shared/sql/mongo-modelo.ts` e é testada sem servidor. Aqui fica o que
// precisa do Mongo.
//
// **Somente-leitura é DECLARADO, e não fingido.** O Mongo não tem sessão
// somente-leitura: quem impõe isso é o papel do usuário no servidor (`read` em
// vez de `readWrite`). A IDE recusa as operações de escrita que ela própria
// oferece, e diz que a garantia de verdade está no papel — a mesma honestidade
// do SQL Server.
import { MongoClient } from 'mongodb';
import type { Driver, ResolvedConfig, Session, TreeNode } from '../types';
import type { ExecuteRequest, FieldSpec, QueryResult } from '../../../shared/contracts';
import {
  AMOSTRA_PARA_COLUNAS, colunasDaAmostra, lerFiltro, linhasDosDocumentos, uriDoMongo,
} from '../../../shared/sql/mongo-modelo';

export const PORTA_PADRAO = 27017;

const CAMPOS: readonly FieldSpec[] = [
  {
    name: 'modo',
    label: 'Como conectar',
    type: 'select',
    default: 'campos',
    options: [
      { value: 'campos', label: 'Host, porta, usuário e senha' },
      { value: 'uri', label: 'URI (mongodb:// ou mongodb+srv://)' },
    ],
  },
  {
    name: 'uri',
    label: 'URI',
    type: 'string',
    secret: true,
    placeholder: 'mongodb+srv://usuario:senha@cluster.mongodb.net/',
    showIf: { campo: 'modo', valores: ['uri'] },
    help: 'Vai cifrada para o cofre: ela carrega a senha dentro.',
  },
  { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1',
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'port', label: 'Porta', type: 'number', default: PORTA_PADRAO,
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'username', label: 'Usuário', type: 'string',
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'password', label: 'Senha', type: 'string', secret: true,
    showIf: { campo: 'modo', valores: ['campos'] } },
  {
    name: 'auth_source',
    label: 'Banco de autenticação',
    type: 'string',
    placeholder: 'admin',
    showIf: { campo: 'modo', valores: ['campos'] },
    help:
      'Onde o USUÁRIO existe, que quase nunca é o banco que se quer ler. Sem ele, ' +
      'o Mongo falha com "authentication failed" e faz parecer que a senha está errada.',
  },
  { name: 'database', label: 'Banco principal', type: 'string',
    help: 'Vai para o topo da árvore. Vazio lista todos os que o usuário enxerga.' },
  { name: 'replica_set', label: 'Replica set', type: 'string', section: 'Avançado',
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'tls', label: 'Usar TLS', type: 'boolean', default: false, section: 'Avançado',
    showIf: { campo: 'modo', valores: ['campos'] } },
  {
    name: 'direct',
    label: 'Conexão direta (sem descobrir réplicas)',
    type: 'boolean',
    default: false,
    section: 'Avançado',
    help:
      'Falar SÓ com este servidor. Ligue quando o endereço for túnel ou balanceador: ' +
      'os nomes que o replica set anuncia são internos e não são alcançáveis daqui.',
  },
];

async function connect(config: ResolvedConfig): Promise<Session> {
  const lido = uriDoMongo(config.fields as Record<string, unknown>);
  if ('erro' in lido) throw new Error(lido.erro);

  const cliente = new MongoClient(lido.destino.uri, {
    // Falhar RÁPIDO: o padrão espera 30 s procurando servidor, e a IDE ficaria
    // dizendo "conectando…" sem nada na tela.
    serverSelectionTimeoutMS: 10_000,
    // Uma consulta que não volta não pode esperar para sempre — ver
    // `shared/prazo.ts`. Este é o limite do próprio driver, abaixo do da rota.
    socketTimeoutMS: 45_000,
    ...(lido.destino.direto ? { directConnection: true } : {}),
  });
  await cliente.connect();

  const bancoPadrao = lido.destino.banco;

  const executar = async (request: ExecuteRequest): Promise<QueryResult> => {
    const comeco = Date.now();
    // O "statement" aqui é `banco.colecao` na primeira linha e o filtro JSON no
    // resto — o formato que todo cliente de Mongo usa, e que cabe num editor de
    // texto sem inventar uma linguagem nova.
    const linhas = request.statement.split('\n');
    const alvo = (linhas[0] ?? '').trim();
    const filtroTexto = linhas.slice(1).join('\n');

    const [banco, colecao] = alvo.includes('.')
      ? [alvo.slice(0, alvo.indexOf('.')), alvo.slice(alvo.indexOf('.') + 1)]
      : [bancoPadrao, alvo];
    if (banco === '' || colecao === '') {
      throw new Error(
        'A primeira linha deve ser `banco.colecao` (ou só `colecao`, com um banco ' +
          'principal definido). As linhas seguintes são o filtro JSON.'
      );
    }

    const filtro = lerFiltro(filtroTexto);
    if ('erro' in filtro) throw new Error(filtro.erro);

    const limite = request.rowLimit ?? 500;
    const docs = await cliente
      .db(banco)
      .collection(colecao)
      .find(filtro.filtro)
      .limit(limite + 1)
      .toArray();

    const cortado = docs.length > limite;
    const mostrados = cortado ? docs.slice(0, limite) : docs;
    const colunas = colunasDaAmostra(mostrados as Record<string, unknown>[]);

    return {
      columns: colunas.map((name) => ({ name, type: 'json' })),
      rows: linhasDosDocumentos(mostrados as Record<string, unknown>[], colunas).map((l) => [...l]),
      rowCount: mostrados.length,
      durationMs: Date.now() - comeco,
      truncated: cortado,
    };
  };

  return {
    kind: 'document',

    children: async (nodePath) => {
      // Raiz: os bancos. Um nível abaixo: as coleções daquele banco.
      if (nodePath.length <= 1) {
        const { databases } = await cliente.db().admin().listDatabases();
        const nomes = databases.map((d) => d.name);
        const ordenados = bancoPadrao === '' ? nomes : [
          ...nomes.filter((n) => n === bancoPadrao),
          ...nomes.filter((n) => n !== bancoPadrao),
        ];
        return ordenados.map((nome): TreeNode => ({
          id: nome,
          label: nome,
          icon: 'database',
          hasChildren: true,
          meta: { database: nome },
        }));
      }

      const banco = nodePath[1] ?? '';
      const colecoes = await cliente.db(banco).listCollections().toArray();
      return colecoes.map((c): TreeNode => ({
        id: c.name,
        label: c.name,
        icon: 'table',
        hasChildren: false,
        meta: { database: banco, object: c.name },
        actions: [{ id: 'mongo-find', label: 'Abrir consulta' }],
      }));
    },

    execute: executar,

    runAction: async (request) => {
      const banco = request.nodePath[1] ?? bancoPadrao;
      const colecao = request.nodePath[request.nodePath.length - 1] ?? '';
      return {
        kind: 'statement',
        title: colecao,
        // A consulta que abre já vem com o formato explicado por um comentário
        // — sem isso, uma aba em branco não diz o que escrever.
        content: `${banco}.${colecao}\n{}\n`,
      };
    },

    /**
     * Interrompe a consulta em andamento.
     *
     * O driver do Mongo não cancela uma operação já enviada; o que ele tem é
     * `close(true)`, que derruba os sockets e faz as operações em voo falharem.
     * A consulta pode continuar rodando NO SERVIDOR até terminar — e é honesto
     * dizer isso: o que o botão garante é que a IDE para de esperar.
     *
     * `connect()` em seguida devolve a sessão ao ar.
     */
    cancelQuery: async () => {
      await cliente.close(true);
      await cliente.connect();
    },

    serverInfo: async () => {
      const info = (await cliente.db().admin().serverInfo()) as { version?: string };
      return {
        version: info.version ?? '?',
        extra: `amostra de ${AMOSTRA_PARA_COLUNAS} documentos define as colunas`,
      };
    },

    close: async () => {
      await cliente.close();
    },
  } as Session;
}

export const mongodbDriver: Driver = {
  type: 'mongodb',
  label: 'MongoDB',
  kind: 'document',
  panel: 'database',
  icon: 'devicon:mongodb',
  defaultPort: PORTA_PADRAO,
  fields: CAMPOS,
  connect,
};
