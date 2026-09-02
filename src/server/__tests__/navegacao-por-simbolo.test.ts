// Navegar em Python e PHP, sem LSP (T040).
//
// Contra arquivos de verdade numa pasta temporária: o que se prova é que o
// índice de símbolos responde à pergunta ao contrário — "quem define este
// nome?" —, e QUE ELE ERRA nos casos que um LSP resolveria. Os limites estão
// testados de propósito: eles são a decisão, não o descuido.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  atendePorSimbolo, definicaoPorSimbolo, palavraNaPosicao, referenciasPorTexto,
} from '../navegacao-por-simbolo';

function comProjeto(arquivos: Record<string, string>, o: (pasta: string) => void): void {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nav-'));
  try {
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      const alvo = path.join(pasta, nome);
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, conteudo, 'utf8');
    }
    o(pasta);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

test('a palavra sob o cursor inclui o `$` do PHP', () => {
  // Sem ele, `$conexao` procuraria por `conexao` — que existe como outra coisa.
  assert.equal(palavraNaPosicao('  $conexao->abrir();', 1, 5), '$conexao');
  assert.equal(palavraNaPosicao('def processar_tudo():', 1, 8), 'processar_tudo');
});

test('atende Python e PHP; C# ficou de fora por decisão dele', () => {
  assert.equal(atendePorSimbolo('/a/x.py'), true);
  assert.equal(atendePorSimbolo('/a/x.php'), true);
  assert.equal(atendePorSimbolo('/a/x.cs'), false);
});

test('acha a definição de uma função Python noutro arquivo', () => {
  comProjeto(
    {
      'app.py': 'from util import processar\nprocessar()\n',
      'util.py': 'def processar():\n    return 1\n',
    },
    (pasta) => {
      const achados = definicaoPorSimbolo(pasta, path.join(pasta, 'app.py'), 'processar');
      assert.equal(achados.length, 1);
      assert.match(achados[0]?.caminho ?? '', /util\.py$/);
      assert.equal(achados[0]?.linha, 1);
    }
  );
});

test('acha a classe do PHP', () => {
  comProjeto({ 'Cliente.php': '<?php\nclass Cliente {\n  function salvar() {}\n}\n' }, (pasta) => {
    const achados = definicaoPorSimbolo(pasta, '', 'Cliente');
    assert.equal(achados.length, 1);
    assert.equal(achados[0]?.linha, 2);
  });
});

test('DUAS definições viram DUAS respostas — não se escolhe no chute', () => {
  // Escolher uma mandaria a pessoa para o arquivo errado sem nenhum sinal de
  // que houve escolha. É um limite de não ter LSP, e ele aparece na tela.
  comProjeto(
    {
      'a.py': 'def salvar():\n    pass\n',
      'b.py': 'def salvar():\n    pass\n',
    },
    (pasta) => {
      assert.equal(definicaoPorSimbolo(pasta, '', 'salvar').length, 2);
    }
  );
});

test('o arquivo ATUAL vem primeiro', () => {
  // Se o nome existe aqui e em outro lugar, o daqui é quase sempre o certo.
  comProjeto(
    {
      'aqui.py': 'def comum():\n    pass\n',
      'outro.py': 'def comum():\n    pass\n',
    },
    (pasta) => {
      const achados = definicaoPorSimbolo(pasta, path.join(pasta, 'outro.py'), 'comum');
      assert.match(achados[0]?.caminho ?? '', /outro\.py$/);
    }
  );
});

test('a comparação é EXATA — `processar` não acha `reprocessar_tudo`', () => {
  // Pular para o lugar errado é pior que não pular.
  comProjeto({ 'x.py': 'def reprocessar_tudo():\n    pass\n' }, (pasta) => {
    assert.deepEqual(definicaoPorSimbolo(pasta, '', 'processar'), []);
  });
});

test('nome curto demais não procura nada', () => {
  comProjeto({ 'x.py': 'def a():\n    pass\n' }, (pasta) => {
    assert.deepEqual(definicaoPorSimbolo(pasta, '', 'a'), []);
  });
});

test('arquivo ilegível não derruba a busca inteira', () => {
  comProjeto(
    {
      'bom.py': 'def achavel():\n    pass\n',
      'ruim.py': 'def (((( sintaxe quebrada\n',
    },
    (pasta) => {
      assert.equal(definicaoPorSimbolo(pasta, '', 'achavel').length, 1);
    }
  );
});

test('as referências acham o uso, com fronteira de palavra', () => {
  comProjeto(
    { 'a.py': 'def salvar():\n    pass\n\nsalvar()\nresalvar_tudo()\n' },
    (pasta) => {
      const usos = referenciasPorTexto(pasta, 'salvar');
      // A definição e a chamada — e NÃO o `resalvar_tudo`.
      assert.equal(usos.length, 2);
      assert.deepEqual(usos.map((u) => u.linha), [1, 4]);
    }
  );
});

test('o `$` do PHP não vira caractere especial de regex', () => {
  // Sem escapar, `$conexao` viraria "fim de linha seguido de conexao" e não
  // acharia nada.
  comProjeto({ 'a.php': '<?php\n$conexao = 1;\necho $conexao;\n' }, (pasta) => {
    assert.equal(referenciasPorTexto(pasta, '$conexao').length, 2);
  });
});

test('as referências param no teto', () => {
  const muitas = Array.from({ length: 50 }, () => 'usar()').join('\n');
  comProjeto({ 'a.py': `def usar():\n    pass\n${muitas}\n` }, (pasta) => {
    assert.equal(referenciasPorTexto(pasta, 'usar', 10).length, 10);
  });
});
