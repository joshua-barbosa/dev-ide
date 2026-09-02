// O escritor de `.zip` (T089).
//
// A prova que importa está no fim: o arquivo montado aqui é aberto por um
// descompactador DE FORA. Testar só os bytes que eu mesmo escrevi provaria que
// o código faz o que o código faz — e não que o resultado é um zip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { crc32, horaDeDos, montarZip, nomeDoZip, normalizarCaminho } from '../zip';

const texto = (s: string): Uint8Array => new TextEncoder().encode(s);

test('o CRC-32 bate com o valor conhecido', () => {
  // `123456789` tem CRC-32 = 0xCBF43926. É o vetor de teste canônico; se esta
  // conta estiver errada, todo zip sai recusado pelo descompactador.
  assert.equal(crc32(texto('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('data anterior a 1980 não vira número negativo', () => {
  // O campo do MS-DOS conta anos desde 1980 e não representa antes disso; um
  // negativo ali faria o descompactador mostrar lixo.
  const { data } = horaDeDos(new Date('1970-01-01T00:00:00'));
  assert.ok(data >= 0);
});

test('o caminho não escapa da pasta ao ser extraído', () => {
  // Zip slip: um `../` no caminho grava fora do destino. Os caminhos vêm do
  // servidor dele, mas quem monta o arquivo responde pelo que ele contém.
  assert.equal(normalizarCaminho('/etc/passwd'), 'etc/passwd');
  assert.equal(normalizarCaminho('../../etc/passwd'), 'etc/passwd');
  assert.equal(normalizarCaminho('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(normalizarCaminho('a//./b'), 'a/b');
});

test('o nome do zip leva a pasta e a data', () => {
  assert.equal(nomeDoZip('/var/www/meu-site', new Date(2026, 8, 1)), 'meu-site-20260901.zip');
  assert.equal(nomeDoZip('/', new Date(2026, 8, 1)), 'pasta-20260901.zip');
});

test('o progresso é avisado a cada arquivo', async () => {
  const vistos: string[] = [];
  await montarZip(
    [
      { caminho: 'a.txt', dados: texto('a') },
      { caminho: 'sub/b.txt', dados: texto('b') },
    ],
    { aoProgredir: (feitos, total, caminho) => vistos.push(`${feitos}/${total} ${caminho}`) }
  );
  assert.deepEqual(vistos, ['1/2 a.txt', '2/2 sub/b.txt']);
});

test('cancelar LANÇA, e não devolve meio zip', async () => {
  // Meio zip seria um arquivo corrompido com cara de pronto — pior que um erro.
  await assert.rejects(
    () =>
      montarZip([{ caminho: 'a.txt', dados: texto('a') }], {
        cancelado: () => true,
      }),
    /cancelado/
  );
});

test('arquivo já comprimido não CRESCE', async () => {
  // Deflate em bytes aleatórios aumenta o tamanho. Guardar o maior dos dois
  // seria pagar tempo para o arquivo ficar pior.
  const aleatorio = new Uint8Array(2048);
  for (let i = 0; i < aleatorio.length; i += 1) aleatorio[i] = (i * 137 + 29) % 251;
  const zip = await montarZip([{ caminho: 'r.bin', dados: aleatorio }]);
  assert.ok(zip.length < aleatorio.length + 512, `zip de ${zip.length} bytes cresceu demais`);
});

test('zip vazio ainda é um zip válido', async () => {
  const zip = await montarZip([]);
  // Só o "fim do diretório central": 22 bytes.
  assert.equal(zip.length, 22);
});

// ---------------------------------------------------------------------------
// A prova de verdade: um descompactador DE FORA abre o que montamos
//
// O árbitro é o `zipfile` do Python, e não o `unzip` do sistema — e isso foi
// medido, não escolhido. Com o mesmo arquivo:
//
// | quem leu            | nome do arquivo com acento |
// |---------------------|----------------------------|
// | `zipfile` do Python | `sub/coração.md` — certo   |
// | `unzip` 6.0         | `sub/cora├з├гo.md`         |
//
// E, ao contrário, o `.zip` gerado pelo comando `zip` do sistema — que NÃO liga
// o bit de UTF-8 — sai errado no Python e certo no `unzip`. Ou seja: o bit 11
// está certo aqui (é o que o formato manda, e o que Windows, 7-Zip e macOS
// honram), e o `unzip` 6.0, de 2009, é que o trata mal. Se um dia um arquivo
// sair com nome estranho ao ser aberto por `unzip` na linha de comando, é isto.
// ---------------------------------------------------------------------------

const temPython = (): boolean => {
  try {
    execFileSync('python3', ['-c', 'import zipfile'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('um descompactador de fora abre o arquivo, com nomes e conteúdo certos', async (t) => {
  if (!temPython()) {
    t.skip('sem python3 nesta máquina');
    return;
  }

  // Texto longo para o deflate valer a pena, acento no nome para exercer o bit
  // de UTF-8, subpasta para exercer o caminho e um vazio para o caso de borda.
  const grande = 'linha de teste repetida\n'.repeat(500);
  const zip = await montarZip([
    { caminho: 'raiz.txt', dados: texto('oi') },
    { caminho: 'sub/coração.md', dados: texto(grande) },
    { caminho: 'vazio.txt', dados: new Uint8Array() },
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-zip-'));
  try {
    const arquivo = path.join(dir, 'saida.zip');
    fs.writeFileSync(arquivo, zip);

    // `testzip()` confere o CRC de cada membro: um byte trocado reprova aqui.
    const saida = execFileSync(
      'python3',
      [
        '-c',
        [
          'import zipfile,sys,json',
          'z=zipfile.ZipFile(sys.argv[1])',
          'assert z.testzip() is None, "CRC quebrado"',
          'print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))',
        ].join('\n'),
        arquivo,
      ],
      { encoding: 'utf8' }
    );
    const lido = JSON.parse(saida) as Record<string, string>;

    assert.deepEqual(Object.keys(lido).sort(), ['raiz.txt', 'sub/coração.md', 'vazio.txt']);
    assert.equal(lido['raiz.txt'], 'oi');
    assert.equal(lido['sub/coração.md'], grande, 'o texto comprimido volta idêntico');
    assert.equal(lido['vazio.txt'], '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
