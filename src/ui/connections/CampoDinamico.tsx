// Um controle para cada `FieldType`.
//
// Este arquivo é o único lugar da interface que sabe traduzir metadado em
// controle — e não sabe o nome de nenhum campo de nenhum driver. Se algum dia
// aparecer aqui um `if (campo.name === 'ssl_mode')`, a promessa do Artigo III
// quebrou: adicionar um driver deixaria de ser só declarar campos.
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { FieldSpec } from '../../shared/contracts';

export interface CampoDinamicoProps {
  readonly campo: FieldSpec;
  readonly valor: string | boolean;
  readonly erro?: string;
  /** Verdadeiro ao editar: o segredo existe no cofre, mas não pode ser exibido. */
  readonly segredoGuardado: boolean;
  readonly onChange: (valor: string | boolean) => void;
}

export function CampoDinamico({
  campo, valor, erro, segredoGuardado, onChange,
}: CampoDinamicoProps) {
  const rotulo = campo.required === true ? `${campo.label} *` : campo.label;

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
    (segredoGuardado ? 'Guardado no cofre. Deixe em branco para manter.' : campo.help);

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
      type={campo.type === 'password' ? 'password' : 'text'}
      multiline={campo.type === 'textarea'}
      minRows={campo.type === 'textarea' ? 2 : undefined}
      label={rotulo}
      value={typeof valor === 'boolean' ? '' : valor}
      error={erro !== undefined}
      placeholder={segredoGuardado ? '••••••••' : campo.placeholder}
      onChange={(e) => onChange(e.target.value)}
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
      slotProps={{ htmlInput: { 'aria-label': campo.label, list: listaId } }}
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
