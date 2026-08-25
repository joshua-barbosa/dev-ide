// Os snippets de terminal, por conexão (spec 058).
//
// Mesmo armazém e mesma disciplina do `favoritos.ts`: JSON sob a raiz de dados,
// leitura tolerante, e chaveado pelo id da conexão. Mora no servidor, e não no
// navegador, porque snippet é do trabalho e não da aba — trocar de máquina ou
// limpar o site não pode apagar os comandos que ele usa todo dia.
import { lerJsonTolerante, gravarJsonAtomico } from './arquivo-json';
import { arquivoDeDados } from './paths';
import {
  guardar,
  lerLista,
  remover,
  validarSnippet,
  type SnippetDeTerminal,
} from '../shared/terminal/snippets';

const ARQUIVO = 'snippets-de-terminal.json';

function arquivo(): string {
  return arquivoDeDados(ARQUIVO);
}

function tudo(): Record<string, readonly SnippetDeTerminal[]> {
  const bruto = lerJsonTolerante(arquivo());
  const limpo: Record<string, readonly SnippetDeTerminal[]> = {};
  for (const [id, lista] of Object.entries(bruto)) limpo[id] = lerLista(lista);
  return limpo;
}

export function lerSnippets(conexaoId: string): readonly SnippetDeTerminal[] {
  return tudo()[conexaoId] ?? [];
}

export function guardarSnippet(conexaoId: string, bruto: unknown): readonly SnippetDeTerminal[] {
  const todos = tudo();
  const lista = guardar(todos[conexaoId] ?? [], validarSnippet(bruto));
  gravarJsonAtomico(arquivo(), { ...todos, [conexaoId]: [...lista] });
  return lista;
}

export function apagarSnippet(conexaoId: string, id: string): readonly SnippetDeTerminal[] {
  const todos = tudo();
  const lista = remover(todos[conexaoId] ?? [], id);
  gravarJsonAtomico(arquivo(), { ...todos, [conexaoId]: [...lista] });
  return lista;
}
