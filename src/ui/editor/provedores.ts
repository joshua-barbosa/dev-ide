// Ligar a inteligência de código ao Monaco (T037, T039, T114).
//
// **Este arquivo é o que faz o `Ctrl+clique` e o *peek* existirem** — e sem
// escrever nenhum dos dois. O Monaco já tem os dois gestos prontos; o que
// faltava era alguém responder à pergunta "onde isto está definido?".
// Registrando um `DefinitionProvider`, ganhamos de uma vez:
//
// - `Ctrl+clique` sobre o nome;
// - `Alt+F12` (peek), com a janelinha embutida;
// - o sublinhado ao passar o mouse com `Ctrl` pressionado;
// - `Ctrl+Shift+F12` para as referências.
//
// Era o que a spec 032 não tinha: lá o F12 foi DEVOLVIDO à IDE por um atalho,
// porque não havia provedor. Agora há — e o atalho antigo continua, porque quem
// aprendeu a apertar F12 não deve descobrir que ele mudou.
import type * as monacoNS from 'monaco-editor';
import { Api } from '../api';
import { palavraAntesDoCursor, palavrasDoTexto } from '../../shared/completar-palavras';

/** O que os provedores precisam saber, e que só o `App` sabe. */
export interface ContextoDeLinguagem {
  /** A pasta aberta. Vazia = sem projeto, e o serviço não tem onde procurar. */
  pastaAtual(): string;
  /** O caminho do arquivo de um modelo do Monaco, ou `null`. */
  caminhoDoModelo(uri: string): string | null;
}

/** As linguagens do Monaco em que o serviço do servidor responde. */
const COM_SERVICO = ['typescript', 'javascript', 'python', 'php'];

/** Onde o completar por palavras vale — ou seja, em tudo. */
const TODAS = [
  'typescript', 'javascript', 'python', 'php', 'sql', 'html', 'css', 'markdown',
  'yaml', 'shell', 'xml', 'json', 'plaintext',
];

let registrado = false;

/**
 * Registra os provedores UMA VEZ.
 *
 * O Monaco é global: registrar duas vezes daria duas respostas para cada
 * pergunta, e a lista de sugestões viria dobrada. A guarda é de módulo porque o
 * registro também é.
 */
export function registrarProvedores(
  monaco: typeof monacoNS,
  ctx: ContextoDeLinguagem
): void {
  if (registrado) return;
  registrado = true;

  const perguntaDe = (
    modelo: monacoNS.editor.ITextModel,
    posicao: monacoNS.IPosition
  ): { pasta: string; caminho: string; linha: number; coluna: number; conteudo: string } | null => {
    const pasta = ctx.pastaAtual();
    const caminho = ctx.caminhoDoModelo(modelo.uri.toString());
    if (pasta === '' || caminho === null) return null;
    return {
      pasta,
      caminho,
      linha: posicao.lineNumber,
      coluna: posicao.column,
      // O texto da TELA, e não o do disco: navegar não pode exigir salvar
      // antes, e uma função escrita há dois segundos ainda não está gravada.
      conteudo: modelo.getValue(),
    };
  };

  // ---- Ir para a definição: Ctrl+clique e peek (T039) ----------------------
  monaco.languages.registerDefinitionProvider(COM_SERVICO, {
    provideDefinition: async (modelo, posicao) => {
      const p = perguntaDe(modelo, posicao);
      if (p === null) return null;
      const { alvos } = await Api.definition(p);
      return alvos.map((a) => ({
        uri: monaco.Uri.file(a.caminho),
        range: new monaco.Range(a.linha, a.coluna, a.linha, a.coluna + 1),
      }));
    },
  });

  monaco.languages.registerReferenceProvider(COM_SERVICO, {
    provideReferences: async (modelo, posicao) => {
      const p = perguntaDe(modelo, posicao);
      if (p === null) return [];
      const { alvos } = await Api.references(p);
      return alvos.map((a) => ({
        uri: monaco.Uri.file(a.caminho),
        range: new monaco.Range(a.linha, a.coluna, a.linha, a.coluna + 1),
      }));
    },
  });

  // ---- Completar (T114) ---------------------------------------------------
  //
  // Duas fontes, e elas NÃO se somam por acaso: onde o serviço responde, o que
  // ele diz é melhor — ele sabe o tipo. As palavras do arquivo entram como
  // complemento, e por isso vêm com prioridade menor na ordenação do Monaco.
  monaco.languages.registerCompletionItemProvider(TODAS, {
    provideCompletionItems: async (modelo, posicao) => {
      const linha = modelo.getLineContent(posicao.lineNumber);
      const prefixo = palavraAntesDoCursor(linha, posicao.column);
      const alcance = new monaco.Range(
        posicao.lineNumber,
        posicao.column - prefixo.length,
        posicao.lineNumber,
        posicao.column
      );

      const sugestoes: monacoNS.languages.CompletionItem[] = [];
      const p = perguntaDe(modelo, posicao);

      if (p !== null && COM_SERVICO.includes(modelo.getLanguageId())) {
        try {
          const r = await Api.completar(p);
          for (const s of r.sugestoes) {
            sugestoes.push({
              label: s.texto,
              kind: tipoDoMonaco(monaco, s.tipo),
              insertText: s.texto,
              range: alcance,
              // `0` ordena antes de `1`: o que o serviço sabe vem primeiro.
              sortText: `0${s.texto}`,
              ...(s.detalhe === undefined ? {} : { detail: s.detalhe }),
            });
          }
        } catch {
          // Sem serviço — projeto grande demais, arquivo fora da raiz — sobram
          // as palavras. Uma lista menor é melhor que um erro no meio da
          // digitação.
        }
      }

      const jaTem = new Set(sugestoes.map((s) => String(s.label)));
      for (const palavra of palavrasDoTexto(modelo.getValue(), prefixo)) {
        if (jaTem.has(palavra.texto)) continue;
        sugestoes.push({
          label: palavra.texto,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: palavra.texto,
          range: alcance,
          sortText: `1${palavra.texto}`,
          detail: 'do arquivo',
        });
      }

      return { suggestions: sugestoes };
    },
  });
}

/**
 * O ícone que o Monaco mostra, a partir do que o TypeScript chama a coisa.
 *
 * A lista é curta porque o resto cai em `Text`, que é honesto: um ícone errado
 * diria que um tipo é uma função, e o ícone é justamente o que se lê de relance.
 */
export function tipoDoMonaco(
  monaco: typeof monacoNS,
  tipo: string
): monacoNS.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (tipo) {
    case 'function':
    case 'local function':
      return K.Function;
    case 'method':
      return K.Method;
    case 'property':
      return K.Property;
    case 'class':
      return K.Class;
    case 'interface':
      return K.Interface;
    case 'enum':
      return K.Enum;
    case 'module':
      return K.Module;
    case 'keyword':
      return K.Keyword;
    case 'var':
    case 'let':
    case 'const':
    case 'parameter':
    case 'local var':
      return K.Variable;
    default:
      return K.Text;
  }
}

/**
 * Reflete os diagnósticos do servidor nos rabiscos vermelhos do Monaco (T037).
 *
 * Separado do registro porque roda POR ARQUIVO e a cada mudança, e não uma vez
 * na vida.
 */
export async function marcarDiagnosticos(
  monaco: typeof monacoNS,
  modelo: monacoNS.editor.ITextModel,
  pergunta: { pasta: string; caminho: string; conteudo: string }
): Promise<void> {
  let problemas: Awaited<ReturnType<typeof Api.diagnosticos>>['problemas'];
  try {
    problemas = (await Api.diagnosticos({ ...pergunta, linha: 1, coluna: 1 })).problemas;
  } catch {
    // Falhar aqui não pode encher a tela de erro: o arquivo continua editável,
    // e a marcação volta na próxima mudança.
    return;
  }
  // O modelo pode ter sido descartado enquanto a resposta vinha — trocar de aba
  // é o caso comum.
  if (modelo.isDisposed()) return;

  monaco.editor.setModelMarkers(
    modelo,
    'dev-ide',
    problemas.map((p) => ({
      startLineNumber: p.linha,
      startColumn: p.coluna,
      endLineNumber: p.linhaFim,
      endColumn: p.colunaFim,
      message: p.codigo === 0 ? p.mensagem : `${p.mensagem} (TS${p.codigo})`,
      severity:
        p.severidade === 'erro'
          ? monaco.MarkerSeverity.Error
          : p.severidade === 'aviso'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
    }))
  );
}
