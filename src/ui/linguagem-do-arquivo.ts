// Que linguagem é este arquivo — a resposta que o editor, o realce e a barra
// de status fazem a mesma pergunta.
//
// Saiu de `useWorkspace.ts` pelo Artigo IV, e ganhou com isso: é uma função
// pura, e agora dá para conferi-la sem montar um espaço de trabalho.
import { nomeParaExibir } from '../shared/caminho-local';
import { EXT_TO_LANG, NOME_TO_LANG } from '../shared/editor/languages';

export function linguagemDe(caminho: string): string {
  const nome = nomeParaExibir(caminho).toLowerCase();
  // Nome inteiro primeiro: `Dockerfile` e `Makefile` não têm extensão, e o
  // `split('.')` neles devolveria o próprio nome como se fosse uma.
  const porNome = NOME_TO_LANG[nome];
  if (porNome !== undefined) return porNome;

  if (!nome.includes('.')) return 'plain';
  // Extensão DUPLA antes da simples (T041): `.blade.php` cairia em `.php` e
  // perderia o rótulo de Blade — que é o que faz a barra de status dizer o que
  // o arquivo é. O realce continua o de PHP, que é o certo.
  const partes = nome.split('.');
  if (partes.length > 2) {
    const dupla = `.${partes.slice(-2).join('.')}`;
    const porDupla = EXT_TO_LANG[dupla];
    if (porDupla !== undefined) return porDupla;
  }
  const ext = `.${partes.pop() ?? ''}`;
  return EXT_TO_LANG[ext] ?? 'plain';
}
