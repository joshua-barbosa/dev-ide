// O que esta IDE precisa da SUA máquina.
//
// A ideia é dele, e nasceu de um caso concreto: o Beautify de Python só
// funciona com o `ruff` ou o `black` instalados, e sem uma tela dizendo isso a
// pessoa fica com um item de menu apagado e nenhuma pista.
//
// > *"é bem interessante montar essa documentação dentro da IDE, porque
// > algumas coisas precisam instalar dependências, certo? Que estariam fora do
// > Electron talvez."*
//
// A observação do Electron é a parte importante: empacotar a IDE **não** leva
// junto o `git`, o `ruff` nem o `mysqldump`. Essas ferramentas são da máquina,
// e vão continuar sendo — então a lista precisa existir de qualquer jeito, e é
// melhor que ela seja verificada do que escrita num README que envelhece.
//
// Este arquivo é a LISTA, e nada mais: quem vai ao disco ver o que existe é o
// `server/ferramentas-da-maquina.ts`. A tela precisa do texto de cada linha
// mesmo quando o servidor não respondeu, e ela não pode importar do servidor.

export interface Ferramenta {
  readonly nome: string;
  /** Os executáveis que servem — o primeiro encontrado vale. */
  readonly comandos: readonly string[];
  /** O que deixa de funcionar sem ela. */
  readonly habilita: string;
  /** Como instalar, na distribuição dele. */
  readonly instalar: string;
  /**
   * `true` quando a IDE não abre sem ela.
   *
   * Só o Node é: o resto é recurso que fica indisponível, e chamar tudo de
   * obrigatório faria a tela parecer um alarme quando é um inventário.
   */
  readonly obrigatoria: boolean;
}

/**
 * A lista, escrita à mão e de propósito.
 *
 * Cada linha aqui é uma promessa que a IDE faz em algum lugar da interface. Ela
 * cresce quando um recurso novo passar a depender da máquina — e o `habilita`
 * tem de dizer QUAL recurso, não "várias coisas".
 */
export const FERRAMENTAS: readonly Ferramenta[] = [
  {
    // Não é um comando no PATH, e por isso a busca não o encontra — a tela o
    // mostra como ausente, que é o desfecho certo: quem lê fica sabendo que
    // existe um passo de `sudo` para a versão desktop, e por quê.
    nome: 'Sandbox do Chromium (só no desktop)',
    comandos: ['chrome-sandbox'],
    habilita:
      'A versão desktop (Electron) com o isolamento do Chromium ligado. O ' +
      'ajudante precisa ser de root e ter modo 4755 — no Ubuntu 23.10+ o ' +
      'AppArmor bloqueia o caminho alternativo. Sem isso a janela só abre com ' +
      '--no-sandbox, que desliga o isolamento. No navegador nada disso vale: ' +
      'quem isola é o Chrome dele.',
    instalar:
      'sudo chown root:root node_modules/electron/dist/chrome-sandbox && ' +
      'sudo chmod 4755 node_modules/electron/dist/chrome-sandbox',
    // NÃO é obrigatória: a IDE no navegador não usa nada disso, e o pacote
    // pronto (AppImage) já traz o ajudante com as permissões certas. Isto vale
    // só para quem roda a versão desktop a partir do código.
    obrigatoria: false,
  },
  {
    nome: 'Node.js',
    comandos: ['node'],
    habilita: 'A própria IDE: é ele quem roda o servidor.',
    instalar: 'https://nodejs.org — ou o gerenciador de pacotes da distribuição',
    obrigatoria: true,
  },
  {
    nome: 'Git',
    comandos: ['git'],
    habilita:
      'O que a árvore esconde pelo .gitignore, as marcas de arquivo alterado e ' +
      'a lista de arquivos rastreados na busca.',
    instalar: 'sudo apt install git',
    obrigatoria: false,
  },
  {
    nome: 'ruff (ou black)',
    comandos: ['ruff', 'black'],
    habilita: 'Beautify em arquivos .py. Sem ele o item existe e diz que falta.',
    instalar: 'pip install ruff',
    obrigatoria: false,
  },
  {
    nome: 'Python 3',
    comandos: ['python3', 'python'],
    habilita: 'Rodar blocos de Python no caderno e executar arquivos .py.',
    instalar: 'sudo apt install python3',
    obrigatoria: false,
  },
  {
    nome: 'PHP',
    comandos: ['php'],
    habilita: 'Executar arquivos .php pelo botão de rodar.',
    instalar: 'sudo apt install php-cli',
    obrigatoria: false,
  },
  {
    nome: 'xdg-open',
    comandos: ['xdg-open'],
    habilita: 'O "Abrir no gerenciador de arquivos" do menu da árvore.',
    instalar: 'sudo apt install xdg-utils',
    obrigatoria: false,
  },
];


export interface EstadoDaFerramenta extends Ferramenta {
  /** Onde ela foi encontrada, ou `null` quando não está nesta máquina. */
  readonly caminho: string | null;
}
