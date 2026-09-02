// A janela do desktop (T094).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ehDaPropriaIde, enderecoDaJanela, JANELA_PADRAO, MINIMO, ondeAbrir,
} from '../../electron/janela';

const TELA: { x: number; y: number; largura: number; altura: number } =
  { x: 0, y: 0, largura: 1920, altura: 1080 };

test('sem posição guardada, o padrão', () => {
  assert.deepEqual(ondeAbrir(null, [TELA]), JANELA_PADRAO);
});

test('posição guardada que ainda cabe é respeitada', () => {
  const g = { x: 100, y: 50, largura: 1200, altura: 800 };
  assert.deepEqual(ondeAbrir(g, [TELA]), g);
});

test('o monitor que sumiu NÃO leva a janela para fora da vista', () => {
  // Defeito clássico de desktop: ele desconecta o monitor externo e a janela
  // abre em coordenadas que não existem mais, sem forma óbvia de trazer de volta.
  const g = { x: 3000, y: 200, largura: 1200, altura: 800 };
  const r = ondeAbrir(g, [TELA]);
  assert.equal(r.x, JANELA_PADRAO.x);
  assert.equal(r.largura, 1200, 'mas o TAMANHO que ele escolheu continua valendo');
});

test('basta um canto visível — dois monitores lado a lado são legítimos', () => {
  const g = { x: 1850, y: 10, largura: 1200, altura: 800 };
  assert.equal(ondeAbrir(g, [TELA]).x, 1850);
});

test('tamanho menor que o mínimo é subido: abaixo disso os painéis se comem', () => {
  const r = ondeAbrir({ x: 10, y: 10, largura: 200, altura: 100 }, [TELA]);
  assert.equal(r.largura, MINIMO.largura);
  assert.equal(r.altura, MINIMO.altura);
});

test('sem tela nenhuma, o padrão — e não um cálculo com lista vazia', () => {
  assert.deepEqual(ondeAbrir({ x: 5, y: 5, largura: 1000, altura: 700 }, []), JANELA_PADRAO);
});

test('o endereço é 127.0.0.1, e não localhost', () => {
  // Com IPv6, `localhost` pode virar `::1` — e o servidor escuta em 127.0.0.1.
  // A janela ficaria branca sem dizer por quê.
  assert.equal(enderecoDaJanela(4321), 'http://127.0.0.1:4321/');
});

test('porta inválida estoura em vez de gerar URL quebrada', () => {
  assert.throws(() => enderecoDaJanela(0), /Porta inválida/);
  assert.throws(() => enderecoDaJanela(70000), /Porta inválida/);
});

test('só o próprio servidor navega DENTRO da janela', () => {
  // Um link num README levaria a IDE para um site qualquer, e de lá não há
  // barra de endereços para voltar.
  assert.equal(ehDaPropriaIde('http://127.0.0.1:4321/abc', 4321), true);
  assert.equal(ehDaPropriaIde('http://127.0.0.1:9999/abc', 4321), false);
  assert.equal(ehDaPropriaIde('https://exemplo.com', 4321), false);
  assert.equal(ehDaPropriaIde('file:///etc/passwd', 4321), false);
  assert.equal(ehDaPropriaIde('nao é url', 4321), false);
});
