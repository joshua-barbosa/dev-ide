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
}

const POR_KERNEL: Record<Kernel, PorKernel> = {
  python: {
    comoChega: 'Com pandas no ambiente, chega como DataFrame; sem pandas, como lista de dicionários.',
    usar: "ids = list(users['id'])          # com pandas\nids = [u['id'] for u in users]   # sem pandas",
    variavel: "ids = list(users['id'])",
    ambiente:
      'Python: o .venv (ou venv) da pasta do notebook, subindo até a raiz do projeto; senão, o python3 do sistema. ' +
      '"Outro Python…" aceita qualquer caminho.',
  },
  javascript: {
    comoChega: 'Chega como array de objetos: um objeto por linha, as colunas como chaves.',
    usar: 'const ids = users.map((u) => u.id)\nusers.filter((u) => u.id > 1000)',
    variavel: 'const ids = users.map((u) => u.id)',
    ambiente:
      'Node: escolha de qual projeto do workspace vêm os node_modules (um frontend e um backend lado a lado, por ' +
      'exemplo) e qual Node usar — o do editor, os do nvm ou o do PATH. A barra mostra os dois.',
  },
  typescript: {
    comoChega: 'Chega como array de objetos: um objeto por linha, as colunas como chaves.',
    usar: 'const ids: number[] = users.map((u: { id: number }) => u.id)',
    variavel: 'const ids: number[] = users.map((u: { id: number }) => u.id)',
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
    ambiente:
      'PHP: o php do PATH, com o vendor/autoload.php do projeto (Composer e as classes dele). Num projeto Laravel, ' +
      'o interruptor "Laravel" sobe a aplicação, como o tinker — desligado por padrão.',
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
      titulo: 'Variável do kernel dentro do SQL',
      paragrafos: [
        '{{nome}} numa célula SQL usa uma variável do kernel. Vai SEMPRE como parâmetro da consulta, nunca colado ' +
          'no texto: aspas e tentativas de injeção não quebram nada.',
        'Uma lista já vem com os parênteses: escreva IN {{ids}}, e não IN ({{ids}}). Lista vazia vira (NULL), que ' +
          'não casa nada.',
        'Dentro de aspas ou comentário, {{nome}} é só texto.',
      ],
      exemplos: [
        { linguagem: kernel, codigo: k.variavel },
        { linguagem: 'sql', codigo: 'SELECT * FROM pedidos WHERE cliente_id IN {{ids}}' },
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
