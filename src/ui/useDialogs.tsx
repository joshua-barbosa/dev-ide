// Confirmação e aviso próprios, no lugar de `confirm()` e `alert()`.
//
// Dois motivos, e o segundo é o que pesa:
//
// 1. Aparência — uma caixa cinza do navegador dizendo "localhost:4321 diz" em
//    cima de um editor escuro troca a identidade da interface justamente no
//    momento em que ela mais precisa de atenção.
// 2. `confirm` e `alert` BLOQUEIAM o processo do navegador. É a mesma classe de
//    problema que trava a suíte de ponta a ponta quando um diálogo não é
//    tratado — e o que aqui congela a interface inteira, inclusive execuções em
//    andamento.
//
// Como o chamador precisa de `if (await confirmar(...))`, o mesmo padrão do
// diálogo de senha (spec 004) se repete: a promessa fica guardada e só resolve
// quando o usuário responde.
import { useCallback, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

interface PedidoDeDialogo {
  readonly titulo: string;
  readonly mensagem: string;
  /** Ausente num aviso: aviso só tem "ok". */
  readonly rotuloConfirmar?: string;
  readonly destrutivo: boolean;
}

export interface DialogsController {
  /** `true` se confirmado. Esc e clique fora recusam. */
  confirmar(opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  avisar(mensagem: string, titulo?: string): Promise<void>;
  /** Atalho para `.catch()`: mostra o erro em vez de sumir com ele. */
  aoFalhar(erro: unknown): void;
  readonly elemento: React.ReactNode;
}

export function useDialogs(): DialogsController {
  const [pedido, setPedido] = useState<PedidoDeDialogo | null>(null);
  const resposta = useRef<((ok: boolean) => void) | null>(null);

  const abrir = useCallback((novo: PedidoDeDialogo): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Um por vez: o anterior é recusado, não empilhado. Fechar várias abas
      // sujas seguidas vira uma pergunta de cada vez.
      resposta.current?.(false);
      resposta.current = resolve;
      setPedido(novo);
    });
  }, []);

  const responder = useCallback((ok: boolean) => {
    setPedido(null);
    resposta.current?.(ok);
    resposta.current = null;
  }, []);

  const confirmar = useCallback(
    (opcoes: {
      titulo?: string;
      mensagem: string;
      rotuloConfirmar?: string;
      destrutivo?: boolean;
    }) =>
      abrir({
        titulo: opcoes.titulo ?? 'Confirmar',
        mensagem: opcoes.mensagem,
        rotuloConfirmar: opcoes.rotuloConfirmar ?? 'confirmar',
        destrutivo: opcoes.destrutivo === true,
      }),
    [abrir]
  );

  const avisar = useCallback(
    async (mensagem: string, titulo = 'Aviso') => {
      await abrir({ titulo, mensagem, destrutivo: false });
    },
    [abrir]
  );

  const aoFalhar = useCallback(
    (erro: unknown) => {
      void avisar(erro instanceof Error ? erro.message : String(erro), 'Erro');
    },
    [avisar]
  );

  const ehAviso = pedido !== null && pedido.rotuloConfirmar === undefined;

  const elemento =
    pedido === null ? null : (
      <Dialog
        open
        onClose={() => responder(false)}
        maxWidth="xs"
        fullWidth
        // Enter confirma sem precisar chegar ao botão pelo teclado.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            responder(true);
          }
        }}
      >
        <DialogTitle sx={{ fontSize: 15 }}>{pedido.titulo}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13, whiteSpace: 'pre-line' }}>
            {pedido.mensagem}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          {!ehAviso && <Button onClick={() => responder(false)}>cancelar</Button>}
          <Button
            autoFocus
            color={pedido.destrutivo ? 'error' : 'primary'}
            onClick={() => responder(true)}
          >
            {pedido.rotuloConfirmar ?? 'ok'}
          </Button>
        </DialogActions>
      </Dialog>
    );

  return { confirmar, avisar, aoFalhar, elemento };
}
