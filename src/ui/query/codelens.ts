// As ações que aparecem ACIMA de cada query, dentro do editor.
//
// É o `Run | +Tab | JSON` que o usuário anotou da ferramenta de referência, e o
// que torna um arquivo com cinco queries utilizável: hoje ou se roda o arquivo
// inteiro, ou se seleciona a query com o mouse.
//
// Registrado UMA vez, no módulo, e não por editor: com a tela dividida há várias
// instâncias do Monaco (spec 020), e o CodeLens é registrado por LINGUAGEM, não
// por editor — registrar N vezes daria N cópias de cada botão.
//
// Por isso o tratador mora num `let`: quem trata muda a cada renderização do
// App, e o provedor não pode ser recriado junto.
import * as monaco from 'monaco-editor';
import { quebrarEmStatements, type Statement } from '../../shared/sql/statements';

export type ModoDeExecucao = 'run' | 'tab' | 'json';

/** Quem realmente executa. O App liga o seu aqui no arranque. */
export type TratadorDeStatement = (
  modo: ModoDeExecucao,
  statement: string,
  uri: string
) => void;

let tratador: TratadorDeStatement = () => {};

export function definirTratadorDeStatement(fn: TratadorDeStatement): void {
  tratador = fn;
}

/** Avisa que a lista de statements foi cortada no teto. O App mostra. */
export type AvisoDeCorte = (uri: string, truncado: boolean) => void;

let avisar: AvisoDeCorte = () => {};

export function definirAvisoDeCorte(fn: AvisoDeCorte): void {
  avisar = fn;
}

const COMANDO = 'devIde.runStatement';

const ROTULOS: Record<ModoDeExecucao, string> = {
  run: '▷ Run',
  tab: '＋Tab',
  json: 'JSON',
};

interface Argumentos {
  readonly modo: ModoDeExecucao;
  readonly statement: string;
  readonly uri: string;
}

let registrado = false;

/**
 * Liga o CodeLens de SQL.
 *
 * Idempotente de propósito: é chamado do efeito de montagem do editor, e com a
 * tela dividida esse efeito roda uma vez por grupo.
 */
export function registrarCodeLensDeSql(): void {
  if (registrado) return;
  registrado = true;

  monaco.editor.registerCommand(COMANDO, (_acessor, args: Argumentos) => {
    tratador(args.modo, args.statement, args.uri);
  });

  monaco.languages.registerCodeLensProvider('sql', {
    provideCodeLenses: (modelo) => {
      const uri = modelo.uri.toString();
      const { statements, truncado } = quebrarEmStatements(modelo.getValue());
      avisar(uri, truncado);

      const lenses = statements.flatMap((s: Statement) =>
        (['run', 'tab', 'json'] as const).map((modo) => ({
          range: {
            startLineNumber: s.linhaInicio,
            startColumn: 1,
            endLineNumber: s.linhaInicio,
            endColumn: 1,
          },
          command: {
            id: COMANDO,
            title: ROTULOS[modo],
            arguments: [{ modo, statement: s.texto, uri } satisfies Argumentos],
          },
        }))
      );
      // `dispose` é exigido pela interface; não há nada nosso para soltar.
      return { lenses, dispose: () => {} };
    },
  });
}
