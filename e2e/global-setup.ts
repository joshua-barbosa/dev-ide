// Prepara o mundo da suíte: diretório temporário, banco semeado e uma conexão
// cadastrada.
//
// A semeadura passa pela API da própria IDE em vez de escrever o vault.json à
// mão. Além de menos frágil, exercita o caminho real — se o formato do cofre
// mudar, isto quebra junto, como deve.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SENHA_MESTRA = 'senha-de-teste';

/** A pasta que a suíte deixa aberta. */
export const PASTA_DEMO = (dados: string): string => path.join(dados, 'projects', 'demo');
export const CONEXAO = 'escola';
export const TABELA = 'alunos';
/**
 * Caminho do banco semeado, para o teste do formulário cadastrar uma conexão
 * apontando para um arquivo que existe de verdade.
 *
 * Vai por variável de ambiente porque o `globalSetup` roda em outro processo:
 * estado de módulo não chega aos workers, variável de ambiente chega.
 */
export function bancoDeTeste(): string {
  const caminho = process.env.E2E_BANCO;
  if (caminho === undefined) throw new Error('E2E_BANCO não foi definido pelo global-setup.');
  return caminho;
}

async function esperarServidor(base: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/api/projects`);
      if (r.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`A IDE não respondeu em ${base}`);
}

async function chamar(base: string, rota: string, corpo?: unknown): Promise<unknown> {
  const r = await fetch(base + rota, {
    method: 'POST',
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const payload = (await r.json()) as { success: boolean; data: unknown; error: string };
  if (!payload.success) throw new Error(`${rota}: ${payload.error}`);
  return payload.data;
}

export default async function globalSetup(): Promise<void> {
  const dados = process.env.E2E_DATA;
  const porta = process.env.E2E_PORT;
  if (dados === undefined || porta === undefined) {
    throw new Error('E2E_DATA e E2E_PORT precisam vir da configuração.');
  }

  // Começa sempre do zero: sobra de execução anterior mascararia falha.
  fs.rmSync(dados, { recursive: true, force: true });
  fs.mkdirSync(path.join(dados, 'projects', 'demo'), { recursive: true });

  fs.writeFileSync(
    path.join(dados, 'projects', 'demo', 'utils.ts'),
    ['export const VERSAO = "1.0";', '', 'console.log("ola do utils");', ''].join('\n')
  );
  fs.writeFileSync(
    path.join(dados, 'projects', 'demo', 'consulta.sql'),
    'SELECT id, nome FROM alunos;\n'
  );

  // Dois arquivos que se referenciam, para a navegação por código (spec 032)
  // ter o que atravessar. Sem um par assim, "ir para a definição" só provaria
  // o caso trivial de saltar dentro do próprio arquivo.
  fs.writeFileSync(
    path.join(dados, 'projects', 'demo', 'lib.ts'),
    ['export function saudar(nome: string): string {', '  return `ola ${nome}`;', '}', ''].join('\n')
  );
  fs.writeFileSync(
    path.join(dados, 'projects', 'demo', 'usa-lib.ts'),
    [
      "import { saudar } from './lib';",
      '',
      'export const MENSAGEM = saudar("joshua");',
      '',
    ].join('\n')
  );

  // Deixa a pasta `demo` aberta, como se o usuário já a tivesse aberto antes.
  //
  // Desde a spec 012 a IDE sobe SEM pasta na primeira vez — antes ela escolhia
  // o primeiro projeto por ordem alfabética. Semear aqui deixa os testes mais
  // honestos do que eram: eles dependiam daquela ordem sem dizer.
  fs.writeFileSync(
    path.join(dados, 'state.json'),
    JSON.stringify({ pastaAtual: PASTA_DEMO(dados), recentes: [PASTA_DEMO(dados)] }, null, 2)
  );

  const banco = path.join(dados, 'escola.db');
  process.env.E2E_BANCO = banco;
  const db = new DatabaseSync(banco);
  db.exec(`CREATE TABLE ${TABELA} (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, nota REAL)`);
  const inserir = db.prepare(`INSERT INTO ${TABELA}(nome, nota) VALUES (?, ?)`);
  inserir.run('joshua', 9.5);
  inserir.run('maria', 8);
  db.close();

  const base = `http://127.0.0.1:${porta}`;
  await esperarServidor(base);
  await chamar(base, '/api/connections/vault', { password: SENHA_MESTRA });
  await chamar(base, '/api/connections', {
    type: 'sqlite',
    label: CONEXAO,
    group: 'ACME/Bancos',
    readOnly: false,
    fields: { file: banco },
  });
}
