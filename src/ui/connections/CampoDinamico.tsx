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
      helperText={apoio}
      placeholder={segredoGuardado ? '••••••••' : campo.placeholder}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{ htmlInput: { 'aria-label': campo.label } }}
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
