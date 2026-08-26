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
  readonly onResponder: (senha: string, lembrar: boolean, nova?: string) => Promise<void>;
  readonly onCancelar: () => void;
}

export function VaultDialog({ pedido, podeLembrar, onResponder, onCancelar }: VaultDialogProps) {
  const [senha, setSenha] = useState('');
  /** Só no modo `trocar`: a senha nova (T100). */
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [lembrar, setLembrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa limpa — inclusive a caixa, que é escolha por sessão.
  useEffect(() => {
    if (pedido !== null) {
      setSenha('');
      setNova('');
      setConfirmacao('');
      setLembrar(false);
      setErro(null);
    }
  }, [pedido]);

  if (pedido === null) return null;
  const criando = pedido.modo === 'criar';
  const trocando = pedido.modo === 'trocar';

  const enviar = async () => {
    if (senha === '' || enviando) return;
    if (trocando) {
      if (nova === '') return;
      // Conferir AQUI, e não no servidor: um erro de digitação na senha nova
      // trancaria o cofre com uma senha que ninguém sabe qual é.
      if (nova !== confirmacao) {
        setErro('A senha nova e a confirmação não batem.');
        return;
      }
    }
    setEnviando(true);
    setErro(null);
    try {
      await onResponder(senha, lembrar, trocando ? nova : undefined);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onClose={onCancelar} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15 }}>
        <Icon name={criando || trocando ? 'lucide:lock' : 'lucide:unlock'} size={16} />
        {criando ? 'Criar o cofre' : trocando ? 'Trocar a senha mestra' : 'Destrancar o cofre'}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ color: 'text.secondary', fontSize: 12, mb: 1.5, lineHeight: 1.5 }}>
          {criando
            ? 'A senha mestra protege as credenciais guardadas. Não há recuperação: perdê-la significa perder os segredos.'
            : trocando
              ? 'Todos os segredos são recifrados com a senha nova. A lembrança neste computador é apagada, porque a chave muda.'
              : 'As credenciais estão cifradas. A senha mestra abre o cofre nesta sessão.'}
        </Box>

        <TextField
          autoFocus
          fullWidth
          type="password"
          label={trocando ? 'Senha mestra atual' : 'Senha mestra'}
          value={senha}
          disabled={enviando}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void enviar();
          }}
          slotProps={{
            htmlInput: { 'aria-label': trocando ? 'Senha mestra atual' : 'Senha mestra' },
          }}
        />

        {trocando && (
          <>
            <TextField
              fullWidth
              sx={{ mt: 1.5 }}
              type="password"
              label="Senha nova"
              value={nova}
              disabled={enviando}
              onChange={(e) => setNova(e.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'Senha nova' } }}
            />
            <TextField
              fullWidth
              sx={{ mt: 1.5 }}
              type="password"
              label="Repita a senha nova"
              value={confirmacao}
              disabled={enviando}
              onChange={(e) => setConfirmacao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void enviar();
              }}
              slotProps={{ htmlInput: { 'aria-label': 'Repita a senha nova' } }}
            />
          </>
        )}

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
          {criando ? 'criar' : trocando ? 'trocar' : 'destrancar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
