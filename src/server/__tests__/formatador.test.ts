// Beautify e Minify chamando as bibliotecas de verdade.
//
// Sem mock: o que este teste guarda é justamente a ligação com a biblioteca —
// parser errado, plugin que não resolve, opção que mudou de nome. Um mock
// passaria por cima de tudo isso e continuaria verde.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capacidades, formatar, formatadorDePython } from '../formatador';

test('JavaScript: formata e depois cabe numa linha', async () => {
  const feio = 'const a={x:1,y:2};function f(  ){return a}';
  const bonito = await formatar(feio, 'javascript', 'beautify');
  assert.ok(bonito.includes('\n'), 'o beautify quebra linha');
  assert.match(bonito, /const a = \{/);

  const uma = await formatar(bonito, 'javascript', 'minify');
  assert.equal(uma.trim().includes('\n'), false, 'o minify põe tudo numa linha');
  assert.match(uma, /function f\(\)/, 'os nomes ficam: isto não é um build');
});

test('TypeScript formata, e o minify recusa DIZENDO o motivo', async () => {
  const bonito = await formatar('const a:number=1', 'typescript', 'beautify');
  assert.match(bonito, /const a: number = 1/);

  await assert.rejects(
    () => formatar('const a:number=1', 'typescript', 'minify'),
    /tipos/
  );
});

test('JSON: formata com a indentação dele, e minifica numa linha', async () => {
  const bonito = await formatar('{"a":1,"b":[1,2]}', 'json', 'beautify', { tabSize: 4 });
  assert.match(bonito, /\n {4}"a": 1/, 'respeita o editor.tabSize');
  assert.equal(await formatar(bonito, 'json', 'minify'), '{"a":1,"b":[1,2]}');
});

test('JSON quebrado diz ONDE quebrou', async () => {
  await assert.rejects(() => formatar('{"a":}', 'json', 'minify'), /position|posição|JSON/i);
});

test('CSS: formata e minifica', async () => {
  const bonito = await formatar('a{color:red;background:blue}', 'css', 'beautify');
  assert.match(bonito, /color: red;/);
  const uma = await formatar(bonito, 'css', 'minify');
  assert.equal(uma.includes('\n'), false);
});

test('HTML: formata e colapsa', async () => {
  const bonito = await formatar('<div><p>oi</p></div>', 'html', 'beautify');
  assert.ok(bonito.includes('\n'));
  const uma = await formatar(bonito, 'html', 'minify');
  assert.equal(uma.trim().includes('\n'), false);
});

test('SQL: formata com o dialeto e volta para uma linha', async () => {
  const bonito = await formatar('select a,b from t where x=1', 'sql', 'beautify', {
    tabSize: 2,
    dialeto: 'postgres',
  });
  assert.match(bonito, /SELECT/, 'palavra reservada em maiúscula');
  assert.ok(bonito.includes('\n'));
  assert.equal(
    (await formatar(bonito, 'sql', 'minify')).includes('\n'),
    false
  );
});

test('XML: indenta e colapsa', async () => {
  const bonito = await formatar('<a><b>x</b></a>', 'xml', 'beautify');
  assert.ok(bonito.includes('\n'));
  assert.equal((await formatar(bonito, 'xml', 'minify')).includes('\n'), false);
});

test('YAML formata; minify recusa porque a indentação é a sintaxe', async () => {
  const bonito = await formatar('a:   1\nb:  [1,2]', 'yaml', 'beautify');
  assert.match(bonito, /a: 1/);
  await assert.rejects(() => formatar('a: 1', 'yaml', 'minify'), /sintaxe/);
});

test('Dockerfile formata', async () => {
  const bonito = await formatar('FROM node:22\n   RUN npm ci', 'dockerfile', 'beautify');
  assert.match(bonito, /^FROM node:22/m);
  assert.match(bonito, /^RUN npm ci/m, 'a indentação sobrando some');
});

test('Markdown formata', async () => {
  const bonito = await formatar('#   Título\n\ntexto', 'markdown', 'beautify');
  assert.match(bonito, /^# Título/);
});

test('PHP formata', async () => {
  const bonito = await formatar('<?php function f(  ){return 1;}', 'php', 'beautify');
  assert.match(bonito, /function f\(\)/);
});

test('Blade formata', async () => {
  const bonito = await formatar(
    '<div>@if($a)<b>x</b>@endif</div>',
    'blade',
    'beautify'
  );
  assert.ok(bonito.includes('@if'), 'a diretiva sobrevive ao formatador');
});

test('Python: promete só o que a máquina tem', async () => {
  const tem = formatadorDePython() !== null;
  if (tem) {
    const bonito = await formatar('def f( ):\n  return   1', 'python', 'beautify');
    assert.match(bonito, /def f\(\):/);
  } else {
    await assert.rejects(() => formatar('def f(): pass', 'python', 'beautify'), /ruff|black/);
  }
  // O motivo do minify é OUTRO, e continua sendo o dele mesmo sem o ruff:
  // mandar instalar ferramenta aqui seria conselho que não resolve nada.
  await assert.rejects(() => formatar('x = 1', 'python', 'minify'), /sintaxe/);
  await assert.doesNotReject(async () => {
    await assert.rejects(() => formatar('x = 1', 'python', 'minify'), (e: Error) => {
      assert.equal(/ruff/.test(e.message), false, 'não manda instalar o que não resolve');
      return true;
    });
  });
});

test('linguagem que a IDE não formata recusa dizendo qual', async () => {
  await assert.rejects(() => formatar('int main(){}', 'c', 'beautify'), /"c"/);
});

test('texto vazio volta como veio, sem chamar biblioteca nenhuma', async () => {
  assert.equal(await formatar('   \n ', 'javascript', 'beautify'), '   \n ');
});

test('a declaração cobre toda linguagem que sabe alguma coisa', () => {
  const mapa = capacidades();
  assert.ok(mapa.javascript?.minify);
  assert.equal(mapa.typescript?.minify, false);
  assert.equal(mapa.python?.beautify, formatadorDePython() !== null);
});
