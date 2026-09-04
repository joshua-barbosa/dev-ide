// O arquivo de opções que leva a senha ao cliente do MySQL.
//
// O defeito que motivou isto: o arquivo era escrito sem aspas, e num option
// file do MySQL o `#` começa um COMENTÁRIO e `\n`, `\t`, `\s` e `\b` são
// ESCAPES. Uma senha com `#` chegava cortada, e o cliente respondia "Access
// denied" — enquanto a árvore, que recebe a senha pelo protocolo e não por
// arquivo, abria normalmente. O sintoma aponta para permissão do banco; a
// causa é o arquivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_MYSQL } from '../terminal/clientes/mysql';

/** Senhas inventadas, cada uma com o caractere que quebrava o formato. */
const CASOS = [
  'sem-nada-especial',
  'com#cerquilha',
  'com\\nbarra-ene',
  'com espaco',
  'com"aspas',
  "com'apostrofo",
  'com\\barra',
  '#comeca-com-cerquilha',
];

test('a senha entra entre aspas, e a barra e a aspa saem escapadas', () => {
  const linha = CLI_MYSQL.montarCredencial('a\\b"c');
  assert.match(linha, /^\[client\]\npassword="a\\\\b\\"c"\n$/);
});

/**
 * A prova que vale: o CLIENTE DE VERDADE lendo o arquivo.
 *
 * `--print-defaults` mascara `password`, então o mesmo valor é escrito também
 * numa chave que ele imprime. O que se testa é o PARSER do option file, que é
 * o mesmo para as duas chaves.
 *
 * Pula sem o binário, como os testes de driver que dependem de servidor: a
 * suíte não pode ficar vermelha numa máquina sem cliente de MySQL.
 */
test('o cliente de verdade lê a senha INTEIRA de volta', (t) => {
  let mysql: string;
  try {
    mysql = execFileSync('sh', ['-c', 'command -v mysql']).toString().trim();
  } catch {
    t.skip('sem cliente mysql nesta máquina');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-cnf-'));
  try {
    for (const senha of CASOS) {
      // O `montarCredencial` do driver, com a chave trocada por uma que o
      // `--print-defaults` não esconde.
      const arquivo = path.join(dir, 'teste.cnf');
      fs.writeFileSync(arquivo, CLI_MYSQL.montarCredencial(senha).replace('password=', 'user='), {
        mode: 0o600,
      });
      const saida = execFileSync(mysql, [`--defaults-extra-file=${arquivo}`, '--print-defaults'])
        .toString();
      const lido = /--user=([\s\S]*?)\s*$/m.exec(saida)?.[1] ?? '';
      assert.equal(lido, senha, `a senha ${JSON.stringify(senha)} não voltou inteira`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
