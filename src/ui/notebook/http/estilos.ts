// Estilos que as peças da célula HTTP (spec 120) repetem.

/**
 * As opções do `select` são desenhadas pelo sistema, com fundo claro: herdando
 * a cor clara do tema escuro, ficavam em branco (relato da 0.1.16).
 */
export const estiloDoSeletor = {
  border: 1, borderColor: 'divider', borderRadius: 0.5, fontSize: 11, py: 0.1,
  bgcolor: 'background.paper', color: 'text.primary', cursor: 'pointer',
  '& option': { bgcolor: 'background.paper', color: 'text.primary' },
} as const;

/** Uma aba (Params, Headers, Body…): texto que acende quando escolhida. */
export const estiloDaAba = (ativa: boolean) => ({
  border: 0, borderBottom: 2, px: 1, py: 0.5, cursor: 'pointer', fontSize: 11, bgcolor: 'transparent',
  borderColor: ativa ? 'primary.main' : 'transparent',
  color: ativa ? 'text.primary' : 'text.secondary',
} as const);
