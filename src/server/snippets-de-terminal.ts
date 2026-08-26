// Os snippets de terminal, por conexão (spec 058).
//
// Mesmo armazém e mesma disciplina do `favoritos.ts`: JSON sob a raiz de dados,
// leitura tolerante, e chaveado pelo id da conexão. Mora no servidor, e não no
// navegador, porque snippet é do trabalho e não da aba — trocar de máquina ou
// limpar o site não pode apagar os comandos que ele usa todo dia.
import * as fs from 'node:fs';
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

/**
 * O caminho do arquivo, para o `{}` da barra abri-lo no editor (T085).
 *
 * Ele explicou o que o botão faz na ferramenta de referência: *"o `{}` no
 * Terminal é para editar os snippets.json daquele servidor"*. Eu tinha chutado
 * duas vezes — primeiro que era exportar o buffer, depois que era exportar os
 * snippets.
 *
 * Abre o arquivo DE VERDADE, pelo caminho, como o `config.json` faz desde a
 * spec 011: salvar é salvar, sem rota especial e sem cópia. O arquivo guarda os
 * snippets de TODAS as conexões, e a dica do botão diz isso — mostrar um
 * recorte seria um arquivo que não existe no disco.
 */
export function caminhoDosSnippets(): string {
  const caminho = arquivo();
  // Garante que existe: o arquivo só nascia com o PRIMEIRO snippet salvo, e o
  // `{}` numa IDE recém-instalada abriria o nada — a mesma classe de defeito
  // de um botão que não faz coisa nenhuma.
  if (!fs.existsSync(caminho)) gravarJsonAtomico(caminho, {});
  return caminho;
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
