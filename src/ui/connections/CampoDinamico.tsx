// Um controle para cada `FieldType`.
//
// Este arquivo é o único lugar da interface que sabe traduzir metadado em
// controle — e não sabe o nome de nenhum campo de nenhum driver. Se algum dia
// aparecer aqui um `if (campo.name === 'ssl_mode')`, a promessa do Artigo III
// quebrou: adicionar um driver deixaria de ser só declarar campos.
import { useState } from 'react';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { FieldSpec } from '../../shared/contracts';
import { Icon } from '../Icon';

export interface CampoDinamicoProps {
  readonly campo: FieldSpec;
  readonly valor: string | boolean;
  readonly erro?: string;
  /** Verdadeiro ao editar: o segredo existe no cofre. */
  readonly segredoGuardado: boolean;
  /**
   * Busca o segredo guardado, para o olho (N001).
   *
   * Ausente quando não há o que revelar — conexão nova, campo que não é
   * segredo, ou cofre trancado. É a mesma regra de sempre: a interface só
   * desenha o botão onde ele tem o que fazer.
   */
  readonly revelar?: () => Promise<string>;
  readonly onChange: (valor: string | boolean) => void;
}

export function CampoDinamico({
  campo, valor, erro, segredoGuardado, revelar, onChange,
}: CampoDinamicoProps) {
  const rotulo = campo.required === true ? `${campo.label} *` : campo.label;
  /** O segredo revelado. `null` = ainda escondido, que é como ele nasce. */
  const [revelado, setRevelado] = useState<string | null>(null);
  const [erroAoRevelar, setErroAoRevelar] = useState<string | null>(null);
  const podeRevelar = revelar !== undefined && segredoGuardado && typeof valor === 'string' && valor === '';

  if (campo.type === 'boolean') {
    return (
      <Box>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={valor === true}
              onChange={(e) => onChange(e.target.checked)}
            />
          }
          label={<Box sx={{ fontSize: 12 }}>{campo.label}</Box>}
        />
        {campo.help !== undefined && (
          <Box sx={{ color: 'text.secondary', fontSize: 11, ml: 3.75, mt: -0.5 }}>{campo.help}</Box>
        )}
      </Box>
    );
  }

  // O texto de apoio troca de papel no campo secreto durante a edição: avisar
  // que há valor guardado importa mais que a ajuda, senão o campo vazio parece
  // "sem senha" e o usuário redigita à toa.
  const apoio =
    erro ??
    erroAoRevelar ??
    (revelado !== null
      ? 'Esta é a senha guardada. Sair da tela esconde de novo.'
      : segredoGuardado
        ? 'Guardado no cofre. Deixe em branco para manter.'
        : campo.help);

  // Sugestão, e não lista fechada: `options` num campo que não é `select` quer
  // dizer "estes existem", não "só estes valem" (spec 052, D22). É o caso da
  // chave SSH — oferecer o que está em `~/.ssh` sem proibir a que mora fora.
  const sugestoes = campo.type !== 'select' && campo.options !== undefined
    ? campo.options
    : null;
  const listaId = sugestoes === null ? undefined : `sugestoes-${campo.name}`;

  return (
    <TextField
      fullWidth
      select={campo.type === 'select'}
      // Revelado, o campo vira texto comum: senão o navegador continuaria
      // pintando bolinhas por cima do valor que o usuário pediu para ver.
      type={campo.type === 'password' && revelado === null ? 'password' : 'text'}
      multiline={campo.type === 'textarea'}
      minRows={campo.type === 'textarea' ? 2 : undefined}
      label={rotulo}
      value={revelado ?? (typeof valor === 'boolean' ? '' : valor)}
      error={erro !== undefined}
      placeholder={segredoGuardado && revelado === null ? '••••••••' : campo.placeholder}
      onChange={(e) => {
        // Digitar por cima do revelado volta a ser edição normal: o valor
        // passa a ser o novo, e não o que veio do cofre.
        setRevelado(null);
        onChange(e.target.value);
      }}
      // O `datalist` fica ao lado do campo, e não dentro: o MUI já usa o filho
      // do `TextField` para as opções do `select`.
      helperText={
        sugestoes === null ? (
          apoio
        ) : (
          <>
            {apoio}
            <datalist id={listaId}>
              {sugestoes.map((o) => (
                <option key={o.value} value={o.value} label={o.label} />
              ))}
            </datalist>
          </>
        )
      }
      slotProps={{
        htmlInput: { 'aria-label': campo.label, list: listaId },
        input: (podeRevelar || revelado !== null)
          ? {
              endAdornment: (
                <InputAdornment position="end">
                  {revelado !== null && (
                    <BotaoDoCampo
                      rotulo={`Copiar ${campo.label}`}
                      icone="lucide:copy"
                      onClick={() => void navigator.clipboard?.writeText(revelado)}
                    />
                  )}
                  <BotaoDoCampo
                    rotulo={revelado === null ? `Ver ${campo.label}` : `Esconder ${campo.label}`}
                    icone={revelado === null ? 'lucide:eye' : 'lucide:eye-off'}
                    onClick={() => {
                      if (revelado !== null) {
                        setRevelado(null);
                        return;
                      }
                      setErroAoRevelar(null);
                      void revelar?.()
                        .then(setRevelado)
                        .catch((e: Error) => setErroAoRevelar(e.message));
                    }}
                  />
                </InputAdornment>
              ),
            }
          : undefined,
      }}
      sx={{ '& .MuiFormHelperText-root': { fontSize: 11, ml: 0.5 } }}
    >
      {(campo.options ?? []).map((opcao) => (
        <MenuItem key={opcao.value} value={opcao.value} sx={{ fontSize: 12 }}>
          {opcao.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Um botão pequeno dentro do campo. */
function BotaoDoCampo({
  rotulo, icone, onClick,
}: {
  readonly rotulo: string;
  readonly icone: string;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', color: 'text.secondary', p: 0.3,
        borderRadius: 0.5, display: 'flex', cursor: 'pointer',
        '&:hover': { color: 'text.primary' },
      }}
    >
      <Icon name={icone} size={14} />
    </Box>
  );
}
