// Os indicadores da barra do notebook: UM por kernel (spec 113).
//
// Cada linguagem usada no notebook tem o seu — a bolinha (parado, de pé,
// ocupado) e o ambiente (`.venv`, Node + pacotes, `vendor`). Clicar escolhe
// com o quê aquele kernel roda. JavaScript e TypeScript são o mesmo Node, e
// por isso um indicador só.
import Box from '@mui/material/Box';
import type { Kernel } from '../../shared/notebook/modelo';
import { familiaDe, type ControleDosKernels, type Familia } from './useKernelDoNotebook';

export const ROTULOS: Record<Kernel, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', php: 'PHP',
};

/** As famílias a mostrar, cada uma com a linguagem que a representa. */
export function familiasDaBarra(
  linguagens: readonly Kernel[],
  padrao: Kernel,
  vivas: readonly Familia[]
): { readonly familia: Familia; readonly linguagem: Kernel; readonly rotulo: string }[] {
  const usadas = linguagens.length > 0 ? linguagens : [padrao];
  const saida: { familia: Familia; linguagem: Kernel; rotulo: string }[] = [];
  for (const l of usadas) {
    const f = familiaDe(l);
    const ja = saida.find((x) => x.familia === f);
    if (ja === undefined) saida.push({ familia: f, linguagem: l, rotulo: ROTULOS[l] });
    else if (!ja.rotulo.includes(ROTULOS[l])) ja.rotulo = 'JS/TS';
  }
  // Um kernel vivo de uma linguagem que não tem mais célula também aparece:
  // ele existe, e ocupa memória.
  for (const f of vivas) {
    if (!saida.some((x) => x.familia === f)) {
      const linguagem: Kernel = f === 'node' ? 'javascript' : f;
      saida.push({ familia: f, linguagem, rotulo: ROTULOS[linguagem] });
    }
  }
  return saida;
}

export function IndicadoresDosKernels({
  linguagens, padrao, kernels, linguagemRodando, onEscolher,
}: {
  readonly linguagens: readonly Kernel[];
  readonly padrao: Kernel;
  readonly kernels: ControleDosKernels;
  /** A linguagem da célula rodando agora (a bolinha dela fica amarela). */
  readonly linguagemRodando: Kernel | null;
  onEscolher(linguagem: Kernel): void;
}) {
  const vivas = Object.keys(kernels.estados) as Familia[];
  const itens = familiasDaBarra(linguagens, padrao, vivas);
  return (
    <>
      {itens.map(({ familia, linguagem, rotulo }) => {
        const estado = kernels.estados[familia];
        const subindo = kernels.subindo.has(familia);
        const ocupado = linguagemRodando !== null && familiaDe(linguagemRodando) === familia;
        return (
          <Box key={familia} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box data-kernel={linguagem} sx={{ fontWeight: 600 }}>{rotulo}</Box>
            <Box
              component="button"
              type="button"
              aria-label={`Interpretador do kernel ${rotulo}`}
              data-estado-do-kernel={subindo ? 'subindo' : estado === undefined ? 'parado' : ocupado ? 'ocupado' : 'ocioso'}
              onClick={() => onEscolher(linguagem)}
              title={
                estado === undefined
                  ? 'O kernel sobe na primeira célula que rodar. Clique para escolher com o quê ele roda.'
                  : `${estado.executavel}${estado.pacotes === null ? '' : `\nPacotes: ${estado.pacotes.caminho}`}\nClique para trocar.`
              }
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0,
                bgcolor: 'transparent', cursor: 'pointer', fontSize: 12, color: 'text.secondary',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 7, height: 7, borderRadius: '50%',
                  bgcolor: estado === undefined ? 'text.disabled' : ocupado ? 'warning.main' : 'success.main',
                }}
              />
              {subindo
                ? 'subindo…'
                : estado === undefined
                  ? 'kernel parado'
                  : `${estado.interpretador.rotulo} · ${estado.versao}${estado.pandas ? ' · pandas' : ''}` +
                    (estado.pacotes === null ? '' : ` · pacotes: ${estado.pacotes.rotulo}`)}
            </Box>
          </Box>
        );
      })}
    </>
  );
}
