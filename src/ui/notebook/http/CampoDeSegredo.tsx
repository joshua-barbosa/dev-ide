// Um campo de segredo da aba Authorization (spec 120, etapa 2).
//
// Decisão dele (28/10): o valor vai para o COFRE desta máquina e o `.brnb`
// guarda só uma referência. Um `{{variavel}}` não é segredo: fica no arquivo
// como texto, visível.
//
// O campo não mostra o que está no cofre ao abrir — ele aparece vazio, com
// "guardado no cofre". O olho busca o valor quando ele quer ver.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../../Icon';
import { tokens } from '../../theme';
import { ApiDoNotebook } from '../../api-notebook';
import { guardarNoCofre, novaReferencia } from './segredosPendentes';
import type { CampoSecreto } from '../../../shared/notebook/http';

export interface CampoDeSegredoProps {
  readonly rotulo: string;
  readonly campo: CampoSecreto;
  onMudar(campo: CampoSecreto): void;
}

export const estiloDoCampo = {
  flex: 1, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 0.5, outline: 'none',
  bgcolor: 'transparent', color: 'text.primary', fontFamily: tokens.fontMono, fontSize: 12, px: 0.75, py: 0.5,
  '&:focus': { borderColor: 'primary.main' },
} as const;

/** Texto com `{{ }}` (ou vazio) fica no arquivo; o resto vai ao cofre. */
const vaiParaOCofre = (v: string): boolean => v !== '' && !v.includes('{{');

export function CampoDeSegredo({ rotulo, campo, onMudar }: CampoDeSegredoProps) {
  const ref = 'cofre' in campo ? campo.cofre : null;
  const [digitado, setDigitado] = useState('');
  const [revelado, setRevelado] = useState(false);
  /** `null` enquanto pergunta; `false` = o `.brnb` veio de outra máquina. */
  const [existe, setExiste] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (ref === null) return undefined;
    let vigente = true;
    ApiDoNotebook.segredo(ref)
      .then((r) => { if (vigente) setExiste(r.existe); })
      .catch((e: unknown) => { if (vigente) setErro(e instanceof Error ? e.message : String(e)); });
    return () => { vigente = false; };
  }, [ref]);

  const mudar = (v: string): void => {
    setDigitado(v);
    if (!vaiParaOCofre(v)) {
      onMudar({ texto: v });
      return;
    }
    // A referência nasce AGORA: o `.brnb` não espera a volta do cofre.
    const alvo = ref ?? novaReferencia();
    guardarNoCofre(alvo, v);
    setExiste(true);
    if (ref === null) onMudar({ cofre: alvo });
  };

  const alternarOlho = async (): Promise<void> => {
    if (!revelado && ref !== null && digitado === '' && existe === true) {
      try {
        setDigitado((await ApiDoNotebook.segredo(ref, true)).valor ?? '');
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setRevelado((r) => !r);
  };

  const noCofre = ref !== null;
  const valor = noCofre ? digitado : 'texto' in campo ? campo.texto : '';
  const dica = !noCofre ? 'valor, ou {{variavel}}'
    : existe === false ? 'não está neste computador — digite de novo'
      : digitado === '' ? '•••••• guardado no cofre' : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, flex: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <Box
          component="input"
          aria-label={rotulo}
          // Vazio também é senha: o primeiro caractere digitado já não aparece. Só `{{x}}` fica à vista.
          type={revelado || (!noCofre && valor.includes('{{')) ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={valor}
          placeholder={dica}
          data-no-cofre={noCofre ? (existe === false ? 'faltando' : 'sim') : 'nao'}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => mudar(e.target.value)}
          sx={{ ...estiloDoCampo, borderColor: existe === false ? 'warning.main' : 'divider' }}
        />
        {noCofre && (
          <Box
            component="button"
            type="button"
            aria-label={revelado ? `Esconder ${rotulo}` : `Mostrar ${rotulo}`}
            title={revelado ? 'Esconder' : 'Mostrar o valor guardado'}
            onClick={() => void alternarOlho()}
            sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.secondary', display: 'flex' }}
          >
            <Icon name={revelado ? 'lucide:eye-off' : 'lucide:eye'} size={14} />
          </Box>
        )}
      </Box>
      {existe === false && (
        <Box sx={{ fontSize: 11, color: 'warning.main' }}>
          Este segredo não está no cofre deste computador (o notebook veio de outro). Digite-o de novo.
        </Box>
      )}
      {erro !== null && <Box sx={{ fontSize: 11, color: 'error.main' }}>{erro}</Box>}
    </Box>
  );
}
