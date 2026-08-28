// O autocomplete de SQL, alimentado pelo catálogo do banco (T053, spec 071).
//
// A DECISÃO do que sugerir é pura e mora em `shared/sql/codebase.ts`, testada
// sem banco e sem tela. Aqui só se traduz para o formato do Monaco e se
// registra o provedor.
//
// **Um catálogo de cada vez, num módulo.** O provedor do Monaco é global — ele
// atende qualquer modelo `sql` da página — e precisa responder SÍNCRONO. Guardar
// o catálogo aqui, e deixar quem sabe da aba ativa atualizá-lo, é o que evita
// uma ida ao servidor por tecla digitada.
import * as monaco from 'monaco-editor';
import { CODEBASE_VAZIO, sugestoes, type Codebase, type Genero } from '../../shared/sql/codebase';

let atual: Codebase = CODEBASE_VAZIO;
let registrado: monaco.IDisposable | null = null;

/** O catálogo que vale agora. `null` volta ao vazio — nunca ao anterior. */
export function definirCodebase(codebase: Codebase | null): void {
  atual = codebase ?? CODEBASE_VAZIO;
}

const ICONE: Readonly<Record<Genero, monaco.languages.CompletionItemKind>> = {
  objeto: monaco.languages.CompletionItemKind.Class,
  coluna: monaco.languages.CompletionItemKind.Field,
  funcao: monaco.languages.CompletionItemKind.Function,
  palavra: monaco.languages.CompletionItemKind.Keyword,
};

/**
 * A ordem importa, e o Monaco reordena por conta própria.
 *
 * `sortText` fixa a NOSSA ordem: coluna antes de tabela, tabela antes de
 * função, função antes de palavra-chave. Sem isto, o alfabeto do Monaco
 * misturaria tudo e a lista deixaria de responder "o que cabe aqui".
 */
function ordem(indice: number): string {
  return String(indice).padStart(5, '0');
}

export function registrarCompletarSql(): void {
  if (registrado !== null) return;
  registrado = monaco.languages.registerCompletionItemProvider('sql', {
    // O ponto dispara sozinho: `pedidos.` é o gesto mais comum de todos.
    triggerCharacters: ['.'],
    provideCompletionItems: (modelo, posicao) => {
      const antes = modelo.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: posicao.lineNumber,
        endColumn: posicao.column,
      });
      const palavra = modelo.getWordUntilPosition(posicao);
      const alcance: monaco.IRange = {
        startLineNumber: posicao.lineNumber,
        endLineNumber: posicao.lineNumber,
        startColumn: palavra.startColumn,
        endColumn: palavra.endColumn,
      };

      const lista = sugestoes(atual, antes, modelo.getValue());
      return {
        suggestions: lista.map((s, i) => ({
          label: { label: s.texto, description: s.origem === '' ? undefined : s.origem },
          kind: ICONE[s.genero],
          detail: s.detalhe,
          insertText: s.texto,
          range: alcance,
          sortText: ordem(i),
        })),
      };
    },
  });
}
