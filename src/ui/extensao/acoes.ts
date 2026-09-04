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

/** Pergunta um texto usando a caixa NATIVA do editor. */
export function pedirTexto(o: {
  titulo: string;
  placeholder?: string;
  valorInicial?: string;
}): Promise<string | null> {
  return chamarHost<string | null>('pedirTexto', o);
}

/** Escreve no canal de saída do VS Code — o par do painel `Output` da IDE. */
export function escreverNaSaida(texto: string, erro: boolean): void {
  void chamarHost('escreverNaSaida', { texto, erro });
}

export function mostrarSaida(): void {
  void chamarHost('mostrarSaida');
}

/**
 * O diagrama ER, aberto como Markdown com o bloco Mermaid.
 *
 * O VS Code desenha Mermaid na pré-visualização de Markdown desde a 1.87, então
 * o diagrama sai desenhado sem a extensão carregar biblioteca nenhuma — e o
 * texto continua atrás, para ele poder gravar no repositório como documentação.
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
  await chamarHost('abrirMarkdown', {
    titulo: `${rotulo}.md`,
    conteudo: documentoDoDiagrama(diagrama),
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
