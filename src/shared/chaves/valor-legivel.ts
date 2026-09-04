// O valor de uma chave, legível.
//
// O que o Redis guarda é texto. Quando esse texto é JSON — e no uso dele quase
// sempre é —, a tela mostrava a linha crua: `ç` no lugar de `ç`, tudo numa
// linha só, cortada com reticências. Ele mandou o print e pediu para melhorar.
//
// `JSON.parse` já desfaz os escapes `\uXXXX`; o que falta é reimprimir com
// recuo. Texto que não é JSON volta intacto: inventar formatação para o que não
// tem forma seria pior que não formatar.

export interface ValorLegivel {
  readonly texto: string;
  /** Era JSON e foi reimpresso — a tela usa isto para decidir a fonte e o wrap. */
  readonly ehJson: boolean;
}

/** Acima disto, reimprimir custa mais do que ajuda: a tela não lê 1 MB. */
const TETO = 512 * 1024;

export function valorLegivel(bruto: string): ValorLegivel {
  const texto = bruto.trim();
  // Só tenta o que TEM cara de JSON: um `JSON.parse` em toda string de log
  // seria trabalho jogado fora a cada célula.
  const comeco = texto[0];
  if (texto.length > TETO || (comeco !== '{' && comeco !== '[')) {
    return { texto: bruto, ehJson: false };
  }
  try {
    return { texto: JSON.stringify(JSON.parse(texto), null, 2), ehJson: true };
  } catch {
    // JSON quebrado é dado, não erro nosso: mostra como veio.
    return { texto: bruto, ehJson: false };
  }
}
