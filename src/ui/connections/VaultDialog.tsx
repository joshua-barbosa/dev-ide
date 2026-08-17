// Diálogo da senha mestra — criar cofre e destrancar.
//
// Substitui o `prompt()` do navegador por dois motivos concretos: o `prompt()`
// não tem campo mascarado nem caixa de seleção, e erro de senha ali significa
// reabrir do zero, perdendo o que foi digitado. Aqui a senha errada mantém o
// diálogo e o texto (AC-13).
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import { Icon } from '../Icon';
import type { PedidoDeSenha } from './useConnections';

export interface VaultDialogProps {
  readonly pedido: PedidoDeSenha | null;
  /** Falso quando a máquina não pode ser identificada: aí a caixa nem aparece. */
  readonly podeLembrar: boolean;
  readonly onResponder: (senha: string, lembrar: boolean) => Promise<void>;
  readonly onCancelar: () => void;
}

export function VaultDialog({ pedido, podeLembrar, onResponder, onCancelar }: VaultDialogProps) {
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa limpa — inclusive a caixa, que é escolha por sessão.
  useEffect(() => {
    if (pedido !== null) {
      setSenha('');
      setLembrar(false);
      setErro(null);
    }
  }, [pedido]);

  if (pedido === null) return null;
  const criando = pedido.modo === 'criar';

  const enviar = async () => {
    if (senha === '' || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onResponder(senha, lembrar);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onClose={onCancelar} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15 }}>
        <Icon name={criando ? 'lucide:lock' : 'lucide:unlock'} size={16} />
        {criando ? 'Criar o cofre' : 'Destrancar o cofre'}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ color: 'text.secondary', fontSize: 12, mb: 1.5, lineHeight: 1.5 }}>
          {criando
            ? 'A senha mestra protege as credenciais guardadas. Não há recuperação: perdê-la significa perder os segredos.'
            : 'As credenciais estão cifradas. A senha mestra abre o cofre nesta sessão.'}
        </Box>

        <TextField
          autoFocus
          fullWidth
          type="password"
          label="Senha mestra"
          value={senha}
          disabled={enviando}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void enviar();
          }}
          slotProps={{ htmlInput: { 'aria-label': 'Senha mestra' } }}
        />

        {podeLembrar && (
          <FormControlLabel
            sx={{ mt: 0.5 }}
            control={
              <Checkbox
                size="small"
                checked={lembrar}
                disabled={enviando}
                onChange={(e) => setLembrar(e.target.checked)}
              />
            }
            label={
              <Box sx={{ fontSize: 12 }}>
                Lembrar neste computador
                <Box sx={{ color: 'text.secondary', fontSize: 11 }}>
                  Vale por um prazo e só nesta máquina. A senha não é gravada.
                </Box>
              </Box>
            }
          />
        )}

        {erro !== null && (
          <Alert severity="error" sx={{ mt: 1.5, fontSize: 12, py: 0.25 }}>
            {erro}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancelar} disabled={enviando}>
          cancelar
        </Button>
        <Button onClick={() => void enviar()} disabled={senha === '' || enviando}>
          {criando ? 'criar' : 'destrancar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
