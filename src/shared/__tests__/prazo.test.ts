// Um prazo para o que pode não voltar nunca.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comPrazo, mensagemDePrazo, PrazoEsgotado, FOLGA_SOBRE_O_DRIVER_MS,
} from '../prazo';

test('promessa que responde a tempo passa direto', async () => {
  assert.equal(await comPrazo(Promise.resolve(7), 1000, 'nunca'), 7);
});

test('promessa que NUNCA resolve é rejeitada pelo prazo', async () => {
  // É o caso do socket meio-aberto: o outro lado sumiu e ninguém avisa.
  await assert.rejects(
    () => comPrazo(new Promise(() => undefined), 20, 'não veio'),
    (e: Error) => e instanceof PrazoEsgotado && e.message === 'não veio'
  );
});

test('erro da promessa passa como ele é, e não vira prazo esgotado', async () => {
  // Confundir os dois faria "senha inválida" aparecer como "tempo esgotado".
  await assert.rejects(
    () => comPrazo(Promise.reject(new Error('senha inválida')), 1000, 'prazo'),
    /senha inválida/
  );
});

test('rejeição que não é Error vira Error, com o texto preservado', async () => {
  await assert.rejects(() => comPrazo(Promise.reject('texto solto'), 1000, 'p'), /texto solto/);
});

test('o relógio é limpo quando a promessa vence', async () => {
  // Um `setTimeout` esquecido segura o processo Node vivo pelo prazo inteiro
  // depois de tudo pronto — e num servidor isso vira atraso no desligamento.
  const antes = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await comPrazo(Promise.resolve(1), 60_000, 'x');
  const depois = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.ok(depois <= antes, `sobrou relógio: ${antes} → ${depois}`);
});

test('a mensagem diz o que foi, o que NÃO foi, e o que fazer', () => {
  // "Tempo esgotado" sozinho faz pensar em consulta pesada, quando na maioria
  // das vezes a conexão é que morreu.
  const m = mensagemDePrazo(60);
  assert.match(m, /60s/);
  assert.match(m, /conexão perdida/);
  assert.match(m, /não consulta pesada/);
  assert.match(m, /reconecta/);
});

test('a folga sobre o driver deixa o erro DELE chegar primeiro', () => {
  // Não é um número mágico: é a ordem que ele produz. Se a folga virasse zero
  // ou negativa, a rota desistiria junto (ou antes) do driver, e a mensagem
  // boa — a que repete o que o banco disse — se perderia.
  assert.ok(FOLGA_SOBRE_O_DRIVER_MS > 0);
  assert.equal(30_000 + FOLGA_SOBRE_O_DRIVER_MS > 30_000, true);
});
