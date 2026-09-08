// Criar uma chave de Redis pela árvore.
//
// Ele, em 08/09/2026: *"Ou adicionar uma nova chave"*. Não existia em lugar
// nenhum — nem na IDE. Entre um comando pronto para editar e um formulário, ele
// escolheu o formulário: nome, tipo, valor e prazo.
//
// A validação NÃO mora aqui: mora em `shared/sql/nova-chave`, porque a árvore
// nativa do editor abre este mesmo diálogo e as duas telas precisam recusar as
// mesmas coisas.
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { tokens } from '../theme';
import { TIPOS_DE_CHAVE, type TipoDeChave } from '../../shared/sql/redis-chave';
import {
  EXEMPLO_DE_VALOR, NOME_DO_TIPO, validarNovaChave, type PedidoDeChave,
} from '../../shared/sql/nova-chave';

export interface PedidoDeNovaChave {
  readonly id: string;
  readonly caminho: readonly string[];
  /** O banco (`db3`), quando "todos os bancos" está ligado. */
  readonly database: string | null;
  /** Vem do nó clicado: `acme:aluno:` já entra preenchido. */
  readonly prefixo: string;
  readonly somenteLeitura: boolean;
}

export interface DialogoDeNovaChaveProps {
  readonly pedido: PedidoDeNovaChave | null;
  readonly onCriar: (pedido: PedidoDeChave) => Promise<void>;
  readonly onCancelar: () => void;
}

export function DialogoDeNovaChave({ pedido, onCriar, onCancelar }: DialogoDeNovaChaveProps) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoDeChave>('string');
  const [valor, setValor] = useState(EXEMPLO_DE_VALOR.string);
  const [ttl, setTtl] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (pedido === null) return;
    // O prefixo do nó entra no nome: criar dentro de `acme:aluno:` é o gesto,
    // e fazê-lo redigitar o prefixo seria cobrar por uma informação que a
    // árvore já tem.
    setNome(pedido.prefixo);
    setTipo('string');
    setValor(EXEMPLO_DE_VALOR.string);
    setTtl('');
    setErro(null);
    setGravando(false);
  }, [pedido]);

  if (pedido === null) return null;

  const trocarTipo = (novo: TipoDeChave): void => {
    // O exemplo do tipo novo entra SÓ se o campo ainda tem o exemplo do
    // anterior: sobrescrever o que ele digitou seria perder o trabalho dele.
    setValor((atual) =>
      Object.values(EXEMPLO_DE_VALOR).includes(atual) ? EXEMPLO_DE_VALOR[novo] : atual
    );
    setTipo(novo);
  };

  const validacao = validarNovaChave({
    nome, tipo, valor, ttl,
    ...(pedido.database === null ? {} : { banco: pedido.database }),
  });
  const impedimento = pedido.somenteLeitura
    ? 'Esta conexão é somente-leitura: criar uma chave é escrita.'
    : validacao.ok ? null : validacao.motivo;

  const criar = async (): Promise<void> => {
    if (!validacao.ok || impedimento !== null || gravando) return;
    setGravando(true);
    setErro(null);
    try {
      await onCriar(validacao.pedido);
    } catch (e) {
      // Fica aberto com o que ele digitou: um nome já usado ou um JSON que o
      // servidor recusou se corrige ali (spec 064).
      setErro((e as Error).message);
    } finally {
      setGravando(false);
    }
  };

  return (
    <Dialog open onClose={onCancelar} maxWidth="sm" fullWidth>
      <DialogTitle>
        Nova chave{pedido.database === null ? '' : ` em ${pedido.database}`}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          spellCheck={false}
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { style: { fontFamily: tokens.fontMono, fontSize: 12 } } }}
        />
        <TextField
          select
          fullWidth
          label="Tipo"
          value={tipo}
          onChange={(e) => trocarTipo(e.target.value as TipoDeChave)}
          sx={{ mt: 2 }}
        >
          {TIPOS_DE_CHAVE.map((t) => (
            <MenuItem key={t} value={t}>{NOME_DO_TIPO[t]}</MenuItem>
          ))}
        </TextField>
        <TextField
          multiline
          fullWidth
          minRows={4}
          maxRows={14}
          label="Valor"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          spellCheck={false}
          sx={{ mt: 2 }}
          slotProps={{ htmlInput: { style: { fontFamily: tokens.fontMono, fontSize: 12 } } }}
        />
        <Box sx={{ mt: 0.5, fontSize: 11, color: 'text.secondary' }}>
          {tipo === 'ReJSON-RL'
            ? 'Um JSON.'
            : tipo === 'hash' || tipo === 'stream'
              ? 'Um `campo=valor` por linha.'
              : tipo === 'zset'
                ? 'Um `membro=nota` por linha.'
                : tipo === 'string'
                  ? 'O texto do valor.'
                  : 'Um item por linha.'}
        </Box>
        <TextField
          fullWidth
          label="Prazo (segundos)"
          value={ttl}
          onChange={(e) => setTtl(e.target.value)}
          placeholder="vazio = sem prazo"
          sx={{ mt: 2 }}
        />
        {impedimento !== null && (
          <Alert severity="info" sx={{ mt: 1.5 }}>{impedimento}</Alert>
        )}
        {erro !== null && (
          <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>{erro}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={impedimento !== null || gravando}
          onClick={() => void criar()}
        >
          {gravando ? 'Criando…' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
