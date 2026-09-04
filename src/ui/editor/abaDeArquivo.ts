// Que ABA um arquivo do disco vira.
//
// Saiu do `useWorkspace` quando ele passou do teto de 800 linhas do Artigo IV,
// e o corte é o natural: aqui está a decisão "este caminho vira qual tipo de
// aba, com qual conteúdo", e lá ficou o que é do React — foco, grupo, salvar.
//
// Puro no que dá: a única coisa que ele faz além de decidir é buscar o texto,
// e mesmo isso entra por parâmetro, para o teste não precisar de servidor.
import { nomeParaExibir } from '../../shared/caminho-local';
import { iconeDeArquivo } from '../../shared/editor/arquivos';
import { ehBinario, visualizadorDe } from '../../shared/editor/visualizadores';
import type { TabInput } from '../../shared/tabs';

/** Lê o texto de um arquivo. Injetado para o teste não precisar de rede. */
export type LeitorDeArquivo = (caminho: string) => Promise<{
  readonly path: string;
  readonly content: string;
}>;

export interface MontagemDeAba {
  readonly aba: TabInput;
  /**
   * Foi preciso ler o disco?
   *
   * Imagem e PDF não são lidos: quem busca os bytes é o `<img>`/`<iframe>`,
   * pela rota de bytes. Quem chama usa isto para saber se vale salvar a aba
   * corrente antes — e a resposta é sempre sim, mas o campo diz por quê.
   */
  readonly leu: boolean;
}

/**
 * Monta a aba de um arquivo do disco.
 *
 * Imagem e PDF NÃO passam pelo leitor: ele devolve texto, e decodificar bytes
 * como UTF-8 os corrompe em silêncio — o arquivo abre, e o que aparece é lixo.
 */
export async function montarAbaDeArquivo(
  caminho: string,
  ler: LeitorDeArquivo,
  linguagemDe: (caminho: string) => string
): Promise<MontagemDeAba> {
  const tipo = visualizadorDe(caminho);

  if (ehBinario(tipo)) {
    return {
      leu: false,
      aba: {
        id: `file:${caminho}`,
        type: 'visualizador',
        title: nomeParaExibir(caminho),
        icon: iconeDeArquivo(caminho, 'plain'),
        meta: { path: caminho, content: '', language: 'plain', view: null, visualizador: tipo },
      },
    };
  }

  const dados = await ler(caminho);
  const language = linguagemDe(dados.path);

  // `.sqlbook` é um CADERNO (spec 048), e não texto para o Monaco: a aba é de
  // outro tipo, o conteúdo é JSON, e quem o edita são os blocos. O
  // `meta.content` continua sendo a verdade — é o que faz `Ctrl+S` gravar sem
  // caminho especial.
  const ehCaderno = dados.path.toLowerCase().endsWith('.sqlbook');

  return {
    leu: true,
    aba: {
      id: `file:${dados.path}`,
      type: ehCaderno
        ? 'caderno'
        : tipo === 'csv'
          ? 'visualizador'
          : language === 'sql'
            ? 'sql'
            : 'editor',
      title: nomeParaExibir(dados.path),
      icon: ehCaderno ? 'lucide:notebook-pen' : iconeDeArquivo(dados.path, language),
      meta: {
        path: dados.path,
        content: dados.content,
        // A versão EM DISCO em que esta aba se baseia (T047).
        //
        // Diferente de `content`, que acompanha o que está sendo digitado. É
        // com ela que o vigia compara: se o arquivo foi reescrito com os mesmos
        // bytes — um formatador, um `git checkout` de ida e volta, o `touch` de
        // um build —, não há nada de ninguém para perder, e avisar seria alarme
        // falso.
        emDisco: dados.content,
        language,
        view: null,
        // O CSV é TEXTO e continua sendo lido normalmente — o `meta.content`
        // segue a verdade, e por isso `Ctrl+S` continua funcionando nele.
        ...(tipo === 'csv' ? { visualizador: tipo } : {}),
      },
    },
  };
}
