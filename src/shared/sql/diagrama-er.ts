// O diagrama ER, em Mermaid (T064, spec 069).
//
// A desculpa que escrevi na spec 045 foi *"não foi pedido"* — e ele pediu na
// triagem. A spec 068 já pôs Mermaid na IDE, então o desenho não custa
// biblioteca nova: o servidor devolve tabelas e chaves, esta função pura vira
// `erDiagram`, e o renderizador que já existe desenha.
//
// **Sobre o teto.** A primeira versão cortava em 40 porque, sem zoom, um
// diagrama grande virava uma fileira de tarjas ilegíveis. Ele perguntou as duas
// coisas juntas — *"porque ficou de fora e como que eu iria dar zoom?"* — e as
// duas têm a mesma resposta: o problema era a falta de zoom, não o tamanho do
// schema. Com a janela de zoom e arrasto, o teto deixou de ser questão de gosto
// e virou proteção do navegador: o mermaid desenha tudo de uma vez, e um
// diagrama de mil tabelas trava a aba.
//
// O número continua sendo escolha minha, e ele pode mudá-lo. Quantas ficaram de
// fora aparece ESCRITO — cortar em silêncio é o erro do total estimado da spec
// 041 outra vez.

export interface ColunaDoDiagrama {
  readonly nome: string;
  readonly tipo: string;
  readonly chave: boolean;
}

export interface TabelaDoDiagrama {
  readonly nome: string;
  readonly colunas: readonly ColunaDoDiagrama[];
}

export interface RelacaoDoDiagrama {
  readonly de: string;
  readonly para: string;
  readonly coluna: string;
  /** A coluna do lado que referencia é obrigatória: sem `NULL`, é 1..1. */
  readonly obrigatoria: boolean;
}

export interface DiagramaER {
  readonly titulo: string;
  readonly tabelas: readonly TabelaDoDiagrama[];
  readonly relacoes: readonly RelacaoDoDiagrama[];
  /** Quantas tabelas ficaram de fora por causa do teto. */
  readonly cortadas: number;
}

/**
 * Teto de tabelas por diagrama — proteção do navegador, não critério de gosto.
 *
 * O `banco-grande` dele tem 105 tabelas e agora entra inteiro.
 */
export const MAX_TABELAS_NO_DIAGRAMA = 150;

/**
 * O Mermaid só aceita `[A-Za-z0-9_]` em nome de entidade.
 *
 * Um nome com hífen, espaço ou acento quebra a sintaxe e o diagrama INTEIRO
 * some — por uma tabela. Troca-se o que não cabe e o rótulo original vai no
 * comentário da entidade, para o nome de verdade não se perder.
 */
export function nomeDeEntidade(nome: string): string {
  const limpo = nome.replace(/[^A-Za-z0-9_]/g, '_');
  // Nome que começa com dígito também não vale como identificador.
  return /^[0-9]/.test(limpo) ? `t_${limpo}` : limpo;
}

/** O tipo, no formato que o Mermaid aceita como token de atributo. */
function tipoDeAtributo(tipo: string): string {
  const limpo = tipo.trim().replace(/[^A-Za-z0-9_]/g, '_');
  return limpo === '' ? 'desconhecido' : limpo;
}

/**
 * O diagrama como texto Mermaid.
 *
 * Uma tabela SEM relação nenhuma aparece sozinha, e é de propósito: sumir com
 * ela faria o diagrama mentir sobre o que existe no schema.
 */
export function mermaidDoDiagrama(diagrama: DiagramaER): string {
  const linhas: string[] = ['erDiagram'];

  for (const relacao of diagrama.relacoes) {
    const de = nomeDeEntidade(relacao.de);
    const para = nomeDeEntidade(relacao.para);
    // `}o--||` é muitos-para-um opcional; `}|--||` é muitos-para-um
    // obrigatório. Quem decide é o `NOT NULL` da coluna que referencia — e
    // essa é a única cardinalidade que o catálogo realmente sabe.
    const cardinalidade = relacao.obrigatoria ? '}|--||' : '}o--||';
    linhas.push(`  ${de} ${cardinalidade} ${para} : "${relacao.coluna}"`);
  }

  for (const tabela of diagrama.tabelas) {
    linhas.push(`  ${nomeDeEntidade(tabela.nome)} {`);
    for (const coluna of tabela.colunas) {
      const marca = coluna.chave ? ' PK' : '';
      linhas.push(`    ${tipoDeAtributo(coluna.tipo)} ${nomeDeEntidade(coluna.nome)}${marca}`);
    }
    linhas.push('  }');
  }

  return linhas.join('\n');
}

/**
 * O documento inteiro: título, aviso de corte e o bloco de Mermaid.
 *
 * Sai como markdown porque a IDE já sabe desenhá-lo — e porque assim ele pode
 * gravar o diagrama no repositório como documentação, que é mais do que uma
 * tela de visualização daria.
 */
export function documentoDoDiagrama(diagrama: DiagramaER): string {
  const partes = [`# Diagrama ER — ${diagrama.titulo}`, ''];

  if (diagrama.cortadas > 0) {
    partes.push(
      `> **${diagrama.cortadas} tabela(s) ficaram de fora**: o diagrama mostra as ` +
        `${diagrama.tabelas.length} primeiras, em ordem alfabética. O teto de ` +
        `${MAX_TABELAS_NO_DIAGRAMA} existe para o navegador não travar desenhando ` +
        'tudo de uma vez — não é limite de leitura: use o zoom e o arrasto.',
      ''
    );
  }
  if (diagrama.tabelas.length === 0) {
    partes.push('Não há tabela neste schema.', '');
    return partes.join('\n');
  }
  partes.push(
    '> Para ler: **roda** navega, **Shift + roda** vai para os lados, ' +
      '**Ctrl + roda** aproxima. Arrastar também move; `100%` volta ao tamanho ' +
      'de leitura e `ajustar` mostra o diagrama inteiro.',
    ''
  );
  if (diagrama.relacoes.length === 0) {
    partes.push(
      '> Nenhuma chave estrangeira declarada aqui — as tabelas aparecem soltas ' +
        'porque é isso que o catálogo diz.',
      ''
    );
  }

  partes.push('```mermaid', mermaidDoDiagrama(diagrama), '```', '');
  return partes.join('\n');
}

/**
 * O diagrama de UMA tabela e a vizinhança dela (P4).
 *
 * Pedido dele em 02/09/2026, com a razão junto: *"Seria muito interessante,
 * porque assim eu consigo ver a tabela que estou olhando"*. O diagrama do
 * schema inteiro mostra tudo e não responde "e esta aqui?" — num banco de cem
 * tabelas ela é um retângulo perdido no meio.
 *
 * **Vizinho é quem se liga a ela nos DOIS sentidos**: as tabelas que ela
 * referencia e as que a referenciam. Só um dos lados daria meia resposta — e
 * seria o lado errado com igual probabilidade.
 *
 * `grau` é quantos saltos: 1 são os vizinhos diretos, 2 os vizinhos deles.
 * Acima disso o desenho volta a ser o schema inteiro em bancos normalizados, e
 * a pergunta original se perde.
 */
export function vizinhanca(
  diagrama: DiagramaER,
  tabela: string,
  grau = 1
): DiagramaER {
  const dentro = new Set<string>([tabela]);

  for (let salto = 0; salto < Math.max(1, grau); salto += 1) {
    // A fronteira desta rodada é fotografada ANTES de crescer: sem isto, um
    // vizinho recém-entrado já traria os vizinhos DELE na mesma volta, e o
    // `grau` não significaria nada.
    const fronteira = new Set(dentro);
    for (const r of diagrama.relacoes) {
      if (fronteira.has(r.de)) dentro.add(r.para);
      if (fronteira.has(r.para)) dentro.add(r.de);
    }
  }

  const tabelas = diagrama.tabelas.filter((t) => dentro.has(t.nome));
  return {
    titulo: `${tabela} e vizinhos`,
    tabelas,
    // Só as relações com AS DUAS PONTAS dentro: uma seta que sai para uma
    // tabela que não está desenhada aponta para o nada.
    relacoes: diagrama.relacoes.filter((r) => dentro.has(r.de) && dentro.has(r.para)),
    cortadas: diagrama.tabelas.length - tabelas.length,
  };
}
