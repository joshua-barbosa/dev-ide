// A aparência da grade: o `👁` da barra (spec 062, fase E · D56).
//
// Não é leitura de dado, é conforto de leitura — e por isso veio por último,
// **não** por isso ficou de fora. Eu tinha mandado para o backlog por conta
// própria; não era minha decisão a tomar.
//
// Puro porque o que entra aqui vem de `+`/`-` e de botão, e um valor fora de
// faixa produz uma grade que não se lê e não se conserta pela interface.

export type Alinhamento = 'auto' | 'esquerda' | 'centro' | 'direita';
export type Borda = 'nenhuma' | 'horizontal' | 'vertical' | 'todas';

export interface Aparencia {
  /** Altura de cada linha, em pixels. */
  readonly alturaDaLinha: number;
  /** A coluna do número da linha, à esquerda. */
  readonly numeroDaLinha: boolean;
  /** A coluna das caixas de marcar para apagar. */
  readonly colunaDeControle: boolean;
  readonly alinhamento: Alinhamento;
  readonly borda: Borda;
}

/**
 * O padrão é o que a grade já fazia antes desta fase.
 *
 * Mudar o comportamento de quem nunca abriu o `👁` seria trocar a tela dele por
 * uma decisão minha — que é exatamente o que esta spec está desfazendo.
 */
export const APARENCIA_PADRAO: Aparencia = {
  alturaDaLinha: 22,
  numeroDaLinha: true,
  colunaDeControle: true,
  alinhamento: 'auto',
  borda: 'todas',
};

export const ALTURA_MINIMA = 16;
export const ALTURA_MAXIMA = 96;
export const PASSO_DA_ALTURA = 2;

/** Fora da faixa, a grade não se lê — e não se conserta pela interface. */
export function comAltura(atual: Aparencia, altura: number): Aparencia {
  const nova = Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, Math.round(altura)));
  return nova === atual.alturaDaLinha ? atual : { ...atual, alturaDaLinha: nova };
}

/**
 * O alinhamento de UMA coluna.
 *
 * `auto` alinha número à direita e o resto à esquerda — é como toda planilha e
 * todo cliente de banco faz, porque casa a vírgula decimal na vertical. As
 * outras três valem para a tabela inteira, e são escolha explícita.
 */
export function alinhamentoDe(aparencia: Aparencia, ehNumero: boolean): 'left' | 'center' | 'right' {
  switch (aparencia.alinhamento) {
    case 'esquerda':
      return 'left';
    case 'centro':
      return 'center';
    case 'direita':
      return 'right';
    case 'auto':
      return ehNumero ? 'right' : 'left';
  }
}

/** As bordas que cada célula desenha, para virar CSS. */
export function bordasDe(aparencia: Aparencia): {
  readonly direita: boolean;
  readonly baixo: boolean;
} {
  return {
    direita: aparencia.borda === 'vertical' || aparencia.borda === 'todas',
    baixo: aparencia.borda === 'horizontal' || aparencia.borda === 'todas',
  };
}

/**
 * Um tipo de coluna do banco é numérico?
 *
 * Por prefixo, e não por lista fechada: cada dialeto inventa nomes (`int8`,
 * `bigint unsigned`, `numeric(10,2)`, `double precision`), e uma lista sempre
 * ficaria faltando um. Errar aqui só desalinha uma coluna, e o usuário resolve
 * escolhendo o alinhamento à mão.
 */
export function ehTipoNumerico(tipo: string | undefined): boolean {
  if (tipo === undefined) return false;
  const t = tipo.toLowerCase();
  return (
    t.startsWith('int') || t.startsWith('bigint') || t.startsWith('smallint') ||
    t.startsWith('tinyint') || t.startsWith('mediumint') || t.startsWith('serial') ||
    t.startsWith('dec') || t.startsWith('numeric') || t.startsWith('float') ||
    t.startsWith('double') || t.startsWith('real') || t.startsWith('money') ||
    t === 'number' || t.startsWith('int2') || t.startsWith('int4') || t.startsWith('int8')
  );
}
