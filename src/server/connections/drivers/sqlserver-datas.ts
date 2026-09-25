// Datas do SQL Server no texto do próprio SQL Server, sem conversão (spec 110).
//
// Ele (25/09): *"se eu to consultando uma query do banco, tem que me mostrar
// exatamente o que está na linha"*, *"não converter horário seja o que for"*.
//
// MySQL e PostgreSQL resolvem isso no driver, pedindo TEXTO. O `tedious` não tem
// essa opção: entrega `Date`. Com `useUTC` (o padrão dele) os dígitos da coluna
// ficam nos campos UTC do `Date`, e a fração além do milissegundo vai num campo
// à parte, `nanosecondsDelta` (em segundos). Daqui se remonta o texto no formato
// que o próprio SQL Server usa ao mostrar — sem `T`, sem `Z`.
//
// **A exceção é `datetimeoffset`.** O `tedious` lê o fuso da coluna e o descarta
// (`readDateTimeOffset`, "time offset?"): só sobra o instante em UTC. Ele sai com
// `+00:00` escrito, para nunca ser lido como a hora local que foi gravada.

/** O pedaço do metadado de coluna do `tedious` que importa aqui. */
export interface TipoDaColuna {
  readonly type: { readonly name: string };
  readonly scale?: number;
  readonly dataLength?: number;
}

const dois = (n: number): string => String(n).padStart(2, '0');

function dia(d: Date): string {
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** Hora com `casas` dígitos de fração (0 a 7), a partir dos ticks de 100 ns. */
function hora(d: Date, casas: number): string {
  const base = `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`;
  if (casas <= 0) return base;
  const alem = (d as Date & { nanosecondsDelta?: number }).nanosecondsDelta ?? 0;
  const ticks = d.getUTCMilliseconds() * 10_000 + Math.round(alem * 1e7);
  return `${base}.${String(ticks).padStart(7, '0').slice(0, casas)}`;
}

export function textoDaData(valor: unknown, coluna: TipoDaColuna): unknown {
  if (!(valor instanceof Date)) return valor;
  const escala = coluna.scale ?? 7;
  switch (coluna.type.name) {
    case 'Date':
      return dia(valor);
    case 'Time':
      return hora(valor, escala);
    case 'SmallDateTime':
      return `${dia(valor)} ${hora(valor, 0)}`;
    case 'DateTimeN':
      // Anulável: o tamanho diz qual dos dois é — 4 bytes, smalldatetime.
      return `${dia(valor)} ${hora(valor, coluna.dataLength === 4 ? 0 : 3)}`;
    case 'DateTime':
      return `${dia(valor)} ${hora(valor, 3)}`;
    case 'DateTime2':
      return `${dia(valor)} ${hora(valor, escala)}`;
    case 'DateTimeOffset':
      return `${dia(valor)} ${hora(valor, escala)} +00:00`;
    default:
      return valor;
  }
}
