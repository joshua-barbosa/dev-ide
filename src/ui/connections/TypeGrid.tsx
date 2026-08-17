// Grade de tipos de serviço, separada por painel.
//
// Sai inteira de `GET /api/connections/drivers`: nome, ícone e painel são
// declarados pelo driver. Um tipo novo aparece aqui sem que este arquivo mude —
// é o teste prático do Artigo III.
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { DriverPanel } from '../../shared/contracts';
import type { DriverInfo } from '../api';
import { Icon } from '../Icon';

const PAINEIS: ReadonlyArray<readonly [DriverPanel, string]> = [
  ['database', 'Database'],
  ['service', 'Service'],
];

export interface TypeGridProps {
  readonly drivers: readonly DriverInfo[];
  readonly selecionado: string | null;
  /** Ausente ao editar: trocar de tipo invalidaria todos os campos. */
  readonly onEscolher?: (type: string) => void;
}

export function TypeGrid({ drivers, selecionado, onEscolher }: TypeGridProps) {
  const travado = onEscolher === undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {PAINEIS.map(([painel, titulo]) => {
        const doPainel = drivers.filter((d) => d.panel === painel);
        // Ao editar, o painel que não tem o tipo escolhido só polui a tela.
        if (travado && !doPainel.some((d) => d.type === selecionado)) return null;

        return (
          <Box key={painel}>
            <Box sx={{ color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', mb: 0.75 }}>
              {titulo}
            </Box>
            {doPainel.length === 0 ? (
              <Box sx={{ color: 'text.secondary', fontSize: 11 }}>
                Nenhum tipo de {titulo} disponível ainda.
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {doPainel.map((driver) => {
                  const ativo = driver.type === selecionado;
                  return (
                    <ButtonBase
                      key={driver.type}
                      disabled={travado}
                      onClick={() => onEscolher?.(driver.type)}
                      aria-pressed={ativo}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.75,
                        px: 1.25, py: 0.75, borderRadius: 1,
                        border: 1, borderColor: ativo ? 'primary.main' : 'divider',
                        bgcolor: ativo ? 'action.selected' : 'transparent',
                        color: ativo ? 'primary.main' : 'text.primary',
                        fontSize: 12,
                        // Travado não é "desabilitado" visualmente: o tipo
                        // escolhido precisa continuar legível ao editar.
                        opacity: travado && !ativo ? 0.4 : 1,
                        '&:hover': { borderColor: travado ? undefined : 'primary.main' },
                      }}
                    >
                      <Icon name={driver.icon} size={14} />
                      {driver.label}
                    </ButtonBase>
                  );
                })}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
