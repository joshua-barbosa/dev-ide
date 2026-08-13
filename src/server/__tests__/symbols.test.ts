import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSymbols } from '../symbols';

const TS_SAMPLE = `
const MAX_RETRIES = 3;
let counter = 0;
const config = { host: 'localhost', port: 8080 };
const soma = (a: number, b: number) => a + b;

function greet(name: string): string {
  return 'Olá, ' + name;
}

class Pessoa {
  constructor(public nome: string) {}
  falar(): void {}
}

interface Forma { area(): number; }
enum Cor { Vermelho, Verde }
`;

test('extrai classes, funções, constantes, variáveis e objetos de TypeScript', () => {
  const symbols = extractSymbols('/tmp/sample.ts', TS_SAMPLE);
  const byName = new Map(symbols.map((s) => [s.name, s]));

  assert.equal(byName.get('MAX_RETRIES')?.kind, 'const');
  assert.equal(byName.get('counter')?.kind, 'variable');
  assert.equal(byName.get('config')?.kind, 'object');
  assert.equal(byName.get('soma')?.kind, 'function');
  assert.equal(byName.get('greet')?.kind, 'function');
  assert.equal(byName.get('Pessoa')?.kind, 'class');
  assert.equal(byName.get('Pessoa.falar')?.kind, 'method');
  assert.equal(byName.get('Forma')?.kind, 'interface');
  assert.equal(byName.get('Cor')?.kind, 'enum');
});

test('reporta linhas 1-based corretas', () => {
  const symbols = extractSymbols('/tmp/sample.ts', TS_SAMPLE);
  const max = symbols.find((s) => s.name === 'MAX_RETRIES');
  assert.equal(max?.line, 2);
});

test('extrai símbolos de Python via regex', () => {
  const py = 'PI = 3.14\nnome = "abc"\ndef soma(a, b):\n    return a + b\nclass Animal:\n    pass\n';
  const symbols = extractSymbols('/tmp/sample.py', py);
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get('PI')?.kind, 'const');
  assert.equal(byName.get('nome')?.kind, 'variable');
  assert.equal(byName.get('soma')?.kind, 'function');
  assert.equal(byName.get('Animal')?.kind, 'class');
});

test('retorna lista vazia para extensões sem suporte', () => {
  assert.deepEqual(extractSymbols('/tmp/readme.md', '# título'), []);
});

test('extrai símbolos de PHP', () => {
  const php = `<?php
define('VERSAO', '1.0');
const LIMITE = 10;
$total = 0;

function calcular($a, $b) {
    return $a + $b;
}

class Pedido {
    public function total() { return 0; }
}

interface Pagavel {}
enum Status {}
`;
  const symbols = extractSymbols('/tmp/sample.php', php);
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get('VERSAO')?.kind, 'const');
  assert.equal(byName.get('LIMITE')?.kind, 'const');
  assert.equal(byName.get('$total')?.kind, 'variable');
  assert.equal(byName.get('calcular')?.kind, 'function');
  assert.equal(byName.get('Pedido')?.kind, 'class');
  assert.equal(byName.get('total')?.kind, 'method');
  assert.equal(byName.get('Pagavel')?.kind, 'interface');
  assert.equal(byName.get('Status')?.kind, 'enum');
});

test('extrai símbolos de C', () => {
  const c = `#include <stdio.h>
#define MAX_ITENS 100

struct Ponto { int x; int y; };
enum Cor { VERMELHO, VERDE };

int contador = 0;
const double PI_LOCAL = 3.14;

int soma(int a, int b) {
    return a + b;
}

int main(void) {
    return 0;
}
`;
  const symbols = extractSymbols('/tmp/sample.c', c);
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get('MAX_ITENS')?.kind, 'const');
  assert.equal(byName.get('Ponto')?.kind, 'class');
  assert.equal(byName.get('Cor')?.kind, 'enum');
  assert.equal(byName.get('contador')?.kind, 'variable');
  assert.equal(byName.get('PI_LOCAL')?.kind, 'const');
  assert.equal(byName.get('soma')?.kind, 'function');
  assert.equal(byName.get('main')?.kind, 'function');
});

test('extrai símbolos de C#', () => {
  const cs = `using System;

public class Calculadora
{
    public const int Limite = 100;

    public int Somar(int a, int b)
    {
        var resultado = a + b;
        return resultado;
    }
}

public interface IRepositorio {}
public enum Estado { Ativo, Inativo }
public struct Coordenada {}
`;
  const symbols = extractSymbols('/tmp/sample.cs', cs);
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get('Calculadora')?.kind, 'class');
  assert.equal(byName.get('Limite')?.kind, 'const');
  assert.equal(byName.get('Somar')?.kind, 'method');
  assert.equal(byName.get('resultado')?.kind, 'variable');
  assert.equal(byName.get('IRepositorio')?.kind, 'interface');
  assert.equal(byName.get('Estado')?.kind, 'enum');
  assert.equal(byName.get('Coordenada')?.kind, 'class');
});
