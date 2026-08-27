// Criar um objeto pela árvore (T113, spec 069).
//
// Antes, o `+` abria o esqueleto numa aba e o trabalho de executá-lo era dele.
// A desculpa que escrevi na spec 009 foi *"o esqueleto abre para edição, e
// executar é o fluxo que já existe"* — verdadeira e irrelevante: descrever o
// caminho longo não é o mesmo que não haver caminho curto.
//
// Os dois caminhos ficam: `Executar` cria e recarrega a categoria, `Abrir no
// editor` faz o que sempre fez. Tirar o segundo seria trocar uma escolha dele
// por uma minha.
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { tokens } from '../theme';
import { motivoParaNaoExecutar } from '../../shared/sql/criacao';

export interface PedidoDeCriacao {
  readonly id: string;
  readonly caminho: readonly string[];
  readonly rotulo: string;
  /** Vira o nome do arquivo quando ele escolhe abrir no editor: `novo_tables.sql`. */
  readonly nomeBase: string;
  readonly esqueleto: string;
  readonly database: string | null;
  readonly somenteLeitura: boolean;
}

export interface DialogoDeCriacaoProps {
  readonly pedido: PedidoDeCriacao | null;
  readonly onExecutar: (sql: string) => Promise<void>;
  readonly onAbrirNoEditor: (sql: string) => void;
  readonly onCancelar: () => void;
}

export function DialogoDeCriacao({
  pedido, onExecutar, onAbrirNoEditor, onCancelar,
}: DialogoDeCriacaoProps) {
  const [sql, setSql] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  useEffect(() => {
    if (pedido !== null) {
      setSql(pedido.esqueleto);
      setErro(null);
      setRodando(false);
    }
  }, [pedido]);

  if (pedido === null) return null;

  const motivo = motivoParaNaoExecutar(sql, pedido.somenteLeitura);

  const executar = async (): Promise<void> => {
    if (motivo !== null || rodando) return;
    setRodando(true);
    setErro(null);
    try {
      await onExecutar(sql);
    } catch (e) {
      // O diálogo FICA aberto com o texto: um erro de sintaxe é para corrigir
      // ali, e reabrir do zero perderia o que foi digitado (spec 064).
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  };

  return (
    <Dialog open onClose={onCancelar} maxWidth="md" fullWidth>
      <DialogTitle>Criar em {pedido.rotulo}</DialogTitle>
      <DialogContent>
        <TextField
          multiline
          fullWidth
          minRows={6}
          maxRows={20}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          slotProps={{
            htmlInput: {
              'aria-label': 'Comando a executar',
              style: { fontFamily: tokens.fontMono, fontSize: 12 },
            },
          }}
        />
        {/* O que a IDE mostra é o que ela vai mandar — sem reescrever nada.
            É a mesma promessa da prévia da spec 044. */}
        {pedido.database !== null && (
          <Box sx={{ mt: 1, fontSize: 11, color: 'text.secondary' }}>
            Roda em <strong>{pedido.database}</strong>.
          </Box>
        )}
        {motivo !== null && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {motivo}
          </Alert>
        )}
        {erro !== null && (
          <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>
            {erro}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onAbrirNoEditor(sql)}>Abrir no editor</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onCancelar}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={motivo !== null || rodando}
          onClick={() => void executar()}
        >
          {rodando ? 'Executando…' : 'Executar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
