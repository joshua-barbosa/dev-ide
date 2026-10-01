// O texto do botão Ajuda do notebook (spec 113, etapa 0).
//
// O pedido: *"Adicione um botão Helper no notebook para essas coisas, pois eu
// tive que te perguntar algumas coisas como funcionavam"*. Cada seção aqui é
// uma pergunta feita de verdade — e a da lista corrige um erro meu: eu ensinei
// `IN ({{ids}})`, e o certo é `IN {{ids}}` (os parênteses já vêm).
//
// Só texto e exemplos, num arquivo só, separado da tela: quem mudar como o
// notebook funciona acha aqui o que precisa mudar junto. Os exemplos variam com
// o kernel — quem está num notebook JavaScript não precisa de pandas.
import type { Kernel } from '../../shared/notebook/modelo';

export interface Exemplo {
  readonly linguagem: 'sql' | Kernel;
  readonly codigo: string;
}

export interface SecaoDeAjuda {
  readonly titulo: string;
  readonly paragrafos: readonly string[];
  readonly exemplos: readonly Exemplo[];
}

/** Os exemplos que mudam de linguagem para linguagem. */
interface PorKernel {
  readonly comoChega: string;
  readonly usar: string;
  readonly variavel: string;
  readonly ambiente: string;
  /** sql() dentro da célula (spec 114, C): um laço de escrita. */
  readonly laco: string;
  /** sql.transacao: tudo ou nada. */
  readonly transacao: string;
  /** Guardar uma lista em JSON, para abri-la como tabela no SQL. */
  readonly json: string;
  /** O nome dessa variável JSON, no estilo da linguagem. */
  readonly nomeJson: string;
}

const POR_KERNEL: Record<Kernel, PorKernel> = {
  python: {
    comoChega: 'Com pandas no ambiente, chega como DataFrame; sem pandas, como lista de dicionários.',
    usar: "ids = list(users['id'])          # com pandas\nids = [u['id'] for u in users]   # sem pandas",
    variavel: "ids = list(users['id'])",
    laco: "for p in pedidos:\n    sql('UPDATE pedidos SET status = ? WHERE id = ? AND code = ?', ['ok', p['id'], p['code']])",
    transacao: "with sql.transacao():\n    for p in pedidos:\n        sql('UPDATE pedidos SET status = ? WHERE id = ?', ['pago', p['id']])",
    json: 'import json\nmessages_json = json.dumps(messages)',
    nomeJson: 'messages_json',
    ambiente:
      'Python: o .venv (ou venv) da pasta do notebook, subindo até a raiz do projeto; senão, o python3 do sistema. ' +
      '"Outro Python…" aceita um caminho a partir da pasta do notebook (.venv/bin/python, ../api/.venv/bin/python), ' +
      'com ~/ para a pasta do usuário, ou completo.',
  },
  javascript: {
    comoChega: 'Chega como array de objetos: um objeto por linha, as colunas como chaves.',
    usar: 'const ids = users.map((u) => u.id)\nusers.filter((u) => u.id > 1000)',
    variavel: 'const ids = users.map((u) => u.id)',
    laco: "for (const p of pedidos) {\n  await sql('UPDATE pedidos SET status = ? WHERE id = ? AND code = ?', ['ok', p.id, p.code])\n}",
    transacao: "await sql.transacao(async () => {\n  for (const p of pedidos) {\n    await sql('UPDATE pedidos SET status = ? WHERE id = ?', ['pago', p.id])\n  }\n})",
    json: 'const messagesJson = JSON.stringify(messages)',
    nomeJson: 'messagesJson',
    ambiente:
      'Node: escolha de qual projeto do workspace vêm os node_modules (um frontend e um backend lado a lado, por ' +
      'exemplo) e qual Node usar — o do editor, os do nvm ou o do PATH. A barra mostra os dois.',
  },
  typescript: {
    comoChega: 'Chega como array de objetos: um objeto por linha, as colunas como chaves.',
    usar: 'const ids: number[] = users.map((u: { id: number }) => u.id)',
    variavel: 'const ids: number[] = users.map((u: { id: number }) => u.id)',
    laco: "for (const p of pedidos) {\n  await sql('UPDATE pedidos SET status = ? WHERE id = ? AND code = ?', ['ok', p.id, p.code])\n}",
    transacao: "await sql.transacao(async () => {\n  for (const p of pedidos) {\n    await sql('UPDATE pedidos SET status = ? WHERE id = ?', ['pago', p.id])\n  }\n})",
    json: 'const messagesJson = JSON.stringify(messages)',
    nomeJson: 'messagesJson',
    ambiente:
      'Node: escolha de qual projeto do workspace vêm os node_modules e qual Node usar — o do editor, os do nvm ' +
      'ou o do PATH. Os tipos são tirados antes de rodar.',
  },
  php: {
    comoChega:
      'Chega como array associativo: um array por linha, as colunas como chaves. O nome ganha o $: "→ users" vira ' +
      '$users, e {{ids}} no SQL lê $ids.',
    usar: "$ids = array_column($users, 'id');",
    variavel: "$ids = array_column($users, 'id');",
    laco: "foreach ($pedidos as $p) {\n    sql('UPDATE pedidos SET status = ? WHERE id = ? AND code = ?', ['ok', $p['id'], $p['code']]);\n}",
    transacao: "sql_transacao(function () use ($pedidos) {\n    foreach ($pedidos as $p) {\n        sql('UPDATE pedidos SET status = ? WHERE id = ?', ['pago', $p['id']]);\n    }\n});",
    json: '$messagesJson = json_encode($messages);',
    nomeJson: 'messagesJson',
    ambiente:
      'PHP: são duas escolhas separadas. O VENDOR ("Vendor: backend" na lista, ou "Outra pasta de vendor…" — a pasta ' +
      'do projeto ou a própria vendor/) diz quais classes e pacotes carregar; o kernel roda nessa pasta, e é nela ' +
      'que o Laravel é procurado. O PHP ("Outro PHP…": o programa, ou a pasta onde ele está) diz qual php roda — ' +
      'sem escolher, o do PATH. Num projeto Laravel, o interruptor "Laravel" sobe a aplicação, como o tinker — ' +
      'desligado por padrão.',
  },
};

export function secoesDeAjuda(kernel: Kernel): readonly SecaoDeAjuda[] {
  const k = POR_KERNEL[kernel];
  return [
    {
      titulo: 'Como o notebook roda',
      paragrafos: [
        'O kernel é um processo vivo: o que uma célula cria (variáveis, imports, funções) continua existindo para ' +
          'as próximas, até reiniciar o kernel.',
        'Vale a ordem em que as células RODARAM, não a ordem na tela. Depois de reiniciar, use "Rodar tudo".',
        'O número ao lado da célula, como [3], conta execuções, não células: rodar a mesma célula duas vezes já ' +
          'leva o contador adiante. [*] quer dizer que ela está rodando.',
        'Ctrl+Enter roda a célula em foco. "Rodar tudo" para no primeiro erro. "Parar" interrompe a célula, sem ' +
          'perder as variáveis.',
      ],
      exemplos: [],
    },
    {
      titulo: 'Várias linguagens no mesmo notebook',
      paragrafos: [
        'Cada célula de código escolhe a sua linguagem no seletor ao lado de SQL/Markdown. Cada linguagem tem o seu ' +
          'kernel vivo (JavaScript e TypeScript dividem o mesmo Node), com um indicador na barra de cima.',
        'Os DADOS descem em cascata: ao trocar de linguagem, o que as outras mudaram chega antes de a célula rodar — ' +
          'inclusive alterações por dentro, como pedidos[0].total = 5. Vale a mudança mais recente, na ordem em que ' +
          'as células rodaram.',
        'Passam números, textos, listas, objetos e tabelas (no Python, uma lista de objetos vira DataFrame). Não ' +
          'passam funções, classes, imports e conexões: um import do Python não existe no Node, e vice-versa — mas ' +
          'continua valendo para as células da MESMA linguagem.',
        'Na viagem, uma data vira texto ISO, NaN vira null e 50.0 pode chegar como 50. Uma tabela muito grande leva ' +
          'alguns segundos para atravessar.',
        'O resultado de um SQL chega em TODAS as linguagens do notebook. "Reiniciar kernel" pergunta qual, quando há ' +
          'mais de um.',
      ],
      exemplos: [
        { linguagem: 'javascript', codigo: 'pedidos.forEach((p) => { p.desconto = p.total * 0.1 })' },
        { linguagem: 'python', codigo: "pedidos['liquido'] = pedidos.total - pedidos.desconto   # com pandas" },
      ],
    },
    {
      titulo: 'De onde vem o kernel',
      paragrafos: ['Clique no indicador ao lado do nome do kernel (a bolinha) para escolher. Trocar reinicia o kernel.', k.ambiente],
      exemplos: [],
    },
    {
      titulo: 'Resultado do SQL vira variável',
      paragrafos: [
        'Na célula SQL, o campo "→ nome" dá o nome da variável. Ao rodar, o resultado inteiro (sem o teto da grade) ' +
          'chega ao kernel com esse nome.',
        k.comoChega,
        'A conexão é a do notebook (barra de cima), ou a da própria célula, se ela tiver outra.',
      ],
      exemplos: [
        { linguagem: 'sql', codigo: '-- com "→ users" no campo do nome\nSELECT id, nome FROM clientes WHERE ativo = 1' },
        { linguagem: kernel, codigo: k.usar },
      ],
    },
    {
      titulo: 'Variável do kernel dentro do SQL: {{nome}}',
      paragrafos: [
        '{{nome}} numa célula SQL usa uma variável do kernel. Vai SEMPRE como parâmetro da consulta ($1 no ' +
          'Postgres, ? no MySQL e no SQLite, @p1 no SQL Server), nunca colado no texto: aspas, acentos e tentativas ' +
          'de injeção não quebram nada — o banco compara o valor como VALOR.',
        'De qual linguagem: do valor mais recente, venha de onde vier. Se o Python mudou ids por último, é o ids do ' +
          'Python que vai, mesmo que o JavaScript também tenha um.',
        'O que cada valor vira: número, texto e booleano vão como são (no SQLite, booleano vira 1/0). Data vira ' +
          'texto ISO (2026-10-01T…). null/None/undefined vira NULL. Um objeto (dicionário) vai como UM texto JSON.',
        'Lista (array, list, tuple, set, uma coluna de DataFrame, Series) vira a lista do IN, já com os ' +
          'parênteses: escreva IN {{ids}}, e não IN ({{ids}}). Lista vazia vira (NULL), que não casa nada — o ' +
          'resultado vem vazio, sem erro.',
        'Um DataFrame de VÁRIAS colunas não vira lista sozinho: escolha a coluna antes (ids = list(df["id"])), use ' +
          'os pares abaixo, ou guarde a tabela em JSON (seção "Uma lista como TABELA no SQL").',
        'PARES de uma lista de objetos: {{pedidos(id, code)}} vira ((id1, code1), (id2, code2), …) para um ' +
          'WHERE (id, code) IN … — cada linha casa só com o id E o code juntos. Serve para UPDATE e DELETE também. ' +
          'Com uma coluna só, {{pedidos(id)}} vira a lista simples. Campo que falta num item vira NULL. Vale para ' +
          'arrays de objetos, listas de dicionários e DataFrames. O SQL Server não aceita pares no IN: lá, use sql() ' +
          'num laço ou a receita do JSON.',
        'Cada item da lista é um parâmetro, e cada banco tem um teto: SQL Server 2.100, SQLite 32.766, Postgres e ' +
          'MySQL 65.535. Para listas maiores, a receita do JSON manda tudo num parâmetro só.',
        'Dentro de aspas ou comentário, {{nome}} é só texto. Depois de FROM ou JOIN, {{nome}} vira uma TABELA — ' +
          'veja "Uma lista como TABELA no SQL".',
        'Se o kernel não tem a variável, nada roda: o erro diz qual falta. Rode antes a célula que a cria.',
      ],
      exemplos: [
        { linguagem: kernel, codigo: k.variavel },
        { linguagem: 'sql', codigo: 'SELECT * FROM pedidos WHERE cliente_id IN {{ids}}' },
        { linguagem: 'sql', codigo: "SELECT * FROM clientes WHERE nome = {{nome}}   -- O'Brien passa inteiro, sem quebrar" },
        { linguagem: 'sql', codigo: 'SELECT * FROM pedidos WHERE criado_em >= {{desde}} AND total > {{minimo}}' },
        { linguagem: 'sql', codigo: "UPDATE pedidos SET status = 'ok' WHERE (id, code) IN {{pedidos(id, code)}}" },
      ],
    },
    {
      titulo: 'Para cada item (célula SQL)',
      paragrafos: [
        'No campo "para cada…" da célula SQL, escreva o nome de uma lista do kernel. O comando roda uma vez por ' +
          'item: {{item}} é o item da vez, {{item.id}} um campo dele. Os outros {{ }} continuam valendo.',
        'Um SELECT por item vira UMA tabela, com a coluna item (1, 2, 3…) na frente — e, com → nome, uma variável. ' +
          'Numa escrita, a célula diz quantos itens rodaram e quantas linhas foram afetadas (quando o banco conta).',
        'Cada item vale sozinho, confirmado na hora. Se um falha, a célula para ali e diz qual: os anteriores já ' +
          'valeram, os seguintes não rodaram. "Parar" para entre um item e outro. Para tudo-ou-nada, use ' +
          'sql.transacao numa célula de código.',
        'Para filtrar por uma lista, IN {{ids}} numa execução só é bem mais rápido; o "para cada" é para o que ' +
          'precisa rodar item a item (uma função, um procedimento, um UPDATE diferente por item).',
      ],
      exemplos: [
        { linguagem: 'sql', codigo: '-- para cada: ids\nSELECT ModoBusca({{item}}, 1) AS resultado' },
        { linguagem: 'sql', codigo: '-- para cada: pedidos\nUPDATE pedidos SET status = {{item.status}} WHERE id = {{item.id}}' },
      ],
    },
    {
      titulo: 'SQL dentro do código: sql()',
      paragrafos: [
        'sql(texto, [valores]) roda um comando pela conexão do notebook (barra de cima). Os valores entram SEMPRE ' +
          'por ? — em qualquer banco —, nunca colados no texto.',
        'Um SELECT devolve as linhas (no Python com pandas, um DataFrame). Uma escrita devolve { linhasAfetadas }: ' +
          'MySQL e SQLite contam; Postgres e SQL Server não informam, e aí vem null — não 0.',
        'Cada sql() vale sozinho, confirmado na hora. Um erro vira exceção normal: sem try/catch, a célula para ali; ' +
          'com try/catch, você decide. A trava de somente-leitura da conexão continua valendo.',
      ],
      exemplos: [{ linguagem: kernel, codigo: k.laco }],
    },
    {
      titulo: 'Tudo ou nada: sql.transacao',
      paragrafos: [
        'Num laço de 500 UPDATEs, se o 237º falhar, os 236 primeiros já ficaram gravados. Dentro de ' +
          'sql.transacao, o motor separa uma conexão só para o bloco (BEGIN): terminou sem erro, confirma tudo ' +
          '(COMMIT); deu erro — num sql() ou no seu código —, desfaz tudo (ROLLBACK) e o erro segue adiante. ' +
          'Parar a célula no meio também desfaz.',
        'Enquanto o bloco roda, as linhas alteradas ficam travadas no banco: mantenha-o curto. No MySQL, CREATE, ' +
          'ALTER e DROP confirmam sozinhos mesmo dentro da transação (regra do MySQL). Um bloco dentro de outro faz ' +
          'parte da mesma transação.',
      ],
      exemplos: [{ linguagem: kernel, codigo: k.transacao }],
    },
    {
      titulo: 'Uma lista como TABELA no SQL',
      paragrafos: [
        'Depois de FROM ou JOIN, {{lista}} vira uma tabela: select * from {{messages}} m. Dá para filtrar, agrupar e ' +
          'cruzar com as tabelas do banco (join users u on u.id = m.id). Sem apelido, a tabela ganha o nome da ' +
          'variável.',
        'As colunas e os tipos saem da lista: número inteiro, decimal, booleano, texto; objeto dentro do item vira ' +
          'JSON; coluna com valores misturados vira texto. Uma lista de valores simples vira a coluna "valor". Lista ' +
          'vazia não dá para usar (sem itens, não há colunas).',
        'Por baixo, o motor usa a função JSON do próprio banco (json_to_recordset no Postgres, JSON_TABLE no ' +
          'MySQL 8+, OPENJSON no SQL Server, json_each no SQLite), e a lista vai num parâmetro só — o teto de ' +
          'parâmetros não se aplica, mas centenas de milhares de linhas pesam.',
        'Se quiser escolher você mesmo os tipos, a receita manual continua valendo: guarde a lista em JSON e abra ' +
          'com a função do banco.',
      ],
      exemplos: [
        { linguagem: 'sql', codigo: 'select m.id, m.message, u.email\nfrom {{messages}} m\njoin users u on u.id = m.id' },
        { linguagem: kernel, codigo: k.json },
        { linguagem: 'sql', codigo: `-- Postgres, manual\nselect * from json_to_recordset({{${k.nomeJson}}}::json) as m(id int, message text)` },
        {
          linguagem: 'sql',
          codigo: `-- MySQL 8+, manual\nselect * from json_table({{${k.nomeJson}}}, '$[*]'\n  columns (id int path '$.id', message text path '$.message')) as m`,
        },
        {
          linguagem: 'sql',
          codigo: `-- SQL Server, manual\nselect * from openjson({{${k.nomeJson}}})\n  with (id int '$.id', message nvarchar(max) '$.message') as m`,
        },
        {
          linguagem: 'sql',
          codigo: `-- SQLite, manual\nselect json_extract(value, '$.id') as id, json_extract(value, '$.message') as message\nfrom json_each({{${k.nomeJson}}})`,
        },
      ],
    },
    {
      titulo: 'O que aparece embaixo da célula',
      paragrafos: [
        'O que a célula imprime e o valor da ÚLTIMA expressão. Uma lista de objetos (ou um DataFrame) aparece como ' +
          'tabela.',
        'Uma lista só de undefined — o resto de um map que só imprime, como ids.map((i) => console.log(i)) — não ' +
          'aparece. Para não mostrar nada, termine com uma atribuição.',
        'Gráficos (matplotlib) e imagens aparecem embaixo da célula. As saídas ficam salvas no arquivo; "Limpar ' +
          'saídas" apaga todas.',
      ],
      exemplos: [],
    },
    {
      titulo: 'Markdown',
      paragrafos: ['A célula Markdown aparece formatada. Dois cliques editam; Ctrl+Enter conclui.'],
      exemplos: [],
    },
  ];
}
