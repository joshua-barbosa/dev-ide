// O diagrama ER, em Mermaid (T064, spec 069).
//
// A desculpa que escrevi na spec 045 foi *"não foi pedido"* — e ele pediu na
// triagem. A spec 068 já pôs Mermaid na IDE, então o desenho não custa
// biblioteca nova: o servidor devolve tabelas e chaves, esta função pura vira
// `erDiagram`, e o renderizador que já existe desenha.
//
// O teto não é enfeite: um diagrama de 200 tabelas não é diagrama, é parede. E
// **quantas ficaram de fora aparece escrito** — cortar em silêncio é o erro do
// total estimado da spec 041 outra vez.

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

/** Teto de tabelas por diagrama. Acima disto o desenho deixa de informar. */
export const MAX_TABELAS_NO_DIAGRAMA = 40;

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
        `${diagrama.tabelas.length} primeiras, em ordem alfabética. Acima de ` +
        `${MAX_TABELAS_NO_DIAGRAMA} o desenho deixa de informar.`,
      ''
    );
  }
  if (diagrama.tabelas.length === 0) {
    partes.push('Não há tabela neste schema.', '');
    return partes.join('\n');
  }
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
