// As ações do painel dentro do VS Code.
//
// Elas existiam como `aindaNao(...)` — um item de menu que abre um aviso
// dizendo "use a IDE". Ele chamou isso de preguiça, e estava certo: **as rotas
// já existiam**, e eu tinha acabado de provar que os componentes da IDE rodam
// aqui dentro. O que faltava era ligar.
//
// A regra de divisão: o que é DADO fala com o motor pelas rotas de sempre; o
// que é JANELA (pedir um texto, abrir um editor, escrever numa saída) pede ao
// host, porque o VS Code já tem isso e reimplementar daria um diálogo estranho
// no meio de um editor que tem o dele.
import { Api } from '../api';
import { documentoDoDiagrama } from '../../shared/sql/diagrama-er';
import type { Vinculo } from '../../shared/sql/vinculo';
import { chamarHost, pedirAoHost } from './ponte';
import { CAMPOS_DO_FILTRO } from '../../shared/tree/campos-do-filtro';
import { achatarConexoes } from '../../shared/connections/achatar';
import { FILTRO_VAZIO, type FiltroDaArvore } from '../../shared/tree/filtro-da-arvore';

/** Pergunta um texto usando a caixa NATIVA do editor. */
export function pedirTexto(o: {
  titulo: string;
  placeholder?: string;
  valorInicial?: string;
}): Promise<string | null> {
  return chamarHost<string | null>('pedirTexto', o);
}

/** Pergunta uma senha na caixa nativa: não fica no DOM nem em captura de tela. */
export function pedirSenha(titulo: string, prompt?: string): Promise<string | null> {
  return chamarHost<string | null>('pedirSenha', {
    titulo,
    ...(prompt === undefined ? {} : { prompt }),
  });
}

/** Um sim/não pela lista nativa — usado onde a IDE tem uma caixa de marcar. */
export async function escolherSimNao(titulo: string): Promise<boolean> {
  const r = await chamarHost<string | null>('escolher', {
    titulo,
    opcoes: [
      { valor: 'sim', rotulo: 'Sim' },
      { valor: 'nao', rotulo: 'Não' },
    ],
  });
  return r === 'sim';
}

/**
 * O filtro da árvore, pedido na caixa NATIVA e em passos.
 *
 * Uma lista com os campos, o valor de cada um à direita, e as linhas `Aplicar`
 * e `Limpar` no fim. Escolher um campo abre a caixa de texto; Esc volta.
 *
 * Ele viu isto como uma aba inteira do editor com um cartãozinho no meio e
 * perguntou se precisava de uma página só para aquilo. Não precisa.
 */
export async function filtroEmPassos(
  rotulo: string,
  criterios: readonly string[],
  atual: unknown
): Promise<FiltroDaArvore | null> {
  const campos = CAMPOS_DO_FILTRO.filter((c) => criterios.includes(c.criterio));
  const r = await chamarHost<Record<string, string> | null>('filtroEmPassos', {
    titulo: `Filtrar ${rotulo}`,
    campos: campos.map((c) => ({ chave: c.chave, rotulo: c.rotulo, dica: c.dica })),
    atual: atual ?? {},
  });
  if (r === null) return null;
  return { ...FILTRO_VAZIO, ...r };
}

/** Escreve no canal de saída do VS Code — o par do painel `Output` da IDE. */
export function escreverNaSaida(texto: string, erro: boolean): void {
  void chamarHost('escreverNaSaida', { texto, erro });
}

export function mostrarSaida(): void {
  void chamarHost('mostrarSaida');
}

/**
 * O diagrama ER, DESENHADO, numa aba própria.
 *
 * Eu tinha aberto isto como markdown e chamado a pré-visualização do editor,
 * afirmando num comentário que ela desenha Mermaid nativamente. Não desenha —
 * isso vem de extensão de terceiro, e o que ele viu foi o `erDiagram` cru.
 * Agora quem desenha é o `MarkdownPreview` da IDE, que traz o Mermaid junto.
 */
export async function abrirDiagramaEr(
  id: string,
  caminho: readonly string[],
  rotulo: string
): Promise<void> {
  // `documentoDoDiagrama` é o MESMO que a IDE usa: o markdown com o bloco
  // Mermaid e a legenda. Gerar outro aqui daria dois diagramas diferentes para
  // o mesmo banco.
  const diagrama = await Api.erDiagram(id, caminho);
  pedirAoHost({
    tipo: 'abrirDiagrama',
    titulo: `Diagrama ER — ${rotulo}`,
    markdown: documentoDoDiagrama(diagrama),
  });
}

/**
 * Cria um arquivo na pasta `Query`, perguntando O QUÊ antes do nome.
 *
 * A ordem é a mesma da IDE (spec 049) e o motivo também: um `+` que não diz o
 * que acrescenta só serve para quem já sabe.
 */
export async function novaQuery(vinculo: Vinculo, tipo?: 'sql' | 'sqlbook'): Promise<void> {
  const escolhido =
    tipo ??
    (await chamarHost<'sql' | 'sqlbook' | null>('escolher', {
      titulo: 'O que criar nesta conexão?',
      opcoes: [
        { valor: 'sql', rotulo: 'Query SQL', detalhe: 'Um arquivo .sql' },
        { valor: 'sqlbook', rotulo: 'Caderno', detalhe: 'Um .sqlbook, com blocos' },
      ],
    }));
  if (escolhido === null || escolhido === undefined) return;

  const nome = await pedirTexto({
    titulo: 'Nome do arquivo',
    valorInicial: escolhido === 'sqlbook' ? 'consulta.sqlbook' : 'consulta.sql',
  });
  if (nome === null || nome.trim() === '') return;

  const criado = await Api.createQuery(vinculo, nome.trim());
  pedirAoHost({ tipo: 'abrirArquivo', caminho: criado.caminho });
}

export async function renomearQuery(vinculo: Vinculo, nomeAtual: string): Promise<boolean> {
  const novo = await pedirTexto({ titulo: 'Novo nome', valorInicial: nomeAtual });
  if (novo === null || novo.trim() === '' || novo.trim() === nomeAtual) return false;
  await Api.renameQuery(vinculo, nomeAtual, novo.trim());
  return true;
}

/** Baixa um arquivo remoto para a máquina, escolhendo onde pelo diálogo nativo. */
export async function baixarRemoto(conexaoId: string, caminho: string): Promise<void> {
  await chamarHost('baixarRemoto', { conexaoId, caminho });
}

/**
 * Escolhe conexão e database pelas caixas NATIVAS — o "trocar vínculo".
 *
 * É a mesma pergunta em dois degraus que o `useVinculo` da IDE faz, e pela
 * mesma razão: a lista de databases vem do DRIVER, viva, e não de um cache
 * nosso que ficaria velho no dia em que ele criasse um banco.
 *
 * Onde a IDE abre a entrada rápida dela, aqui abre a do editor. O caderno é
 * uma aba do editor: uma caixa de diálogo desenhada por nós no meio dela seria
 * a única coisa da janela que não se parece com a janela.
 */
export async function escolherVinculo(atual: Vinculo | null): Promise<Vinculo | null> {
  const conexoes = achatarConexoes((await Api.connections()).tree);
  if (conexoes.length === 0) {
    throw new Error('Nenhuma conexão cadastrada. Crie uma no painel do Braytech.');
  }

  const escolhida = await chamarHost<string | null>('escolher', {
    titulo: 'Executar contra qual conexão?',
    opcoes: conexoes.map((c) => ({
      valor: c.id,
      rotulo: c.label,
      detalhe: c.group === '' ? c.type : `${c.group} · ${c.type}`,
    })),
  });
  if (escolhida === null) return null;

  const nos = await Api.children(escolhida, ['server']);
  const bancos = nos.filter((n) => typeof n.meta?.database === 'string');
  if (bancos.length === 0) throw new Error('Esta conexão não expôs nenhum database.');

  // Um só: perguntar seria um diálogo com uma opção. O SQLite cai aqui.
  if (bancos.length === 1) {
    return { connectionId: escolhida, database: String(bancos[0]?.meta?.database) };
  }

  const banco = await chamarHost<string | null>('escolher', {
    titulo: 'Em qual database?',
    opcoes: bancos.map((n) => ({
      valor: String(n.meta?.database),
      rotulo: n.label,
      ...(n.detail === undefined ? {} : { detalhe: n.detail }),
    })),
  });
  if (banco === null) return null;
  // `atual` só serve para não gravar de novo o que já estava valendo.
  const novo = { connectionId: escolhida, database: banco };
  return atual !== null && atual.connectionId === novo.connectionId && atual.database === novo.database
    ? atual
    : novo;
}
