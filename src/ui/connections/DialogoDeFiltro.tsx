// O filtro de uma categoria da árvore (T111 e T112, spec 069).
//
// Substitui o campo único de texto da spec 038. Dois motivos:
//
// 1. São quatro critérios agora, e um `QuickInput` tem um campo só;
// 2. o filtro esconde dado, e precisa **dizer o que entendeu** — "10 MB" lido
//    como tamanho e "grande" não lido nenhum têm de parecer diferentes na tela.
//    É a lição da spec 063.
//
// Os campos que aparecem vêm do NÓ (`meta.criterios`), não daqui: `Tables`
// filtra por tamanho e `Types` não, e a interface não sabe por quê — nem
// precisa saber (Artigo III).
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CAMPOS_DO_FILTRO } from '../../shared/tree/campos-do-filtro';
import {
  FILTRO_VAZIO,
  estaVazio,
  explicarFiltro,
  type Criterio,
  type FiltroDaArvore,
} from '../../shared/tree/filtro-da-arvore';

export interface PedidoDeFiltro {
  readonly id: string;
  readonly caminho: readonly string[];
  readonly rotulo: string;
  readonly criterios: readonly Criterio[];
  readonly atual: FiltroDaArvore | null;
}

export interface DialogoDeFiltroProps {
  readonly pedido: PedidoDeFiltro | null;
  readonly onAplicar: (filtro: FiltroDaArvore) => Promise<void>;
  readonly onCancelar: () => void;
}

// A lista mora em `shared/tree/campos-do-filtro`: a mesma pergunta tem dois
// desenhos — esta caixa e a lista em passos do VS Code —, e duas listas
// divergiriam.
const CAMPOS = CAMPOS_DO_FILTRO;

export function DialogoDeFiltro({ pedido, onAplicar, onCancelar }: DialogoDeFiltroProps) {
  const [filtro, setFiltro] = useState<FiltroDaArvore>(FILTRO_VAZIO);

  useEffect(() => {
    if (pedido !== null) setFiltro(pedido.atual ?? FILTRO_VAZIO);
  }, [pedido]);

  if (pedido === null) return null;

  const campos = CAMPOS.filter((c) => pedido.criterios.includes(c.criterio));
  const trocar = (chave: keyof FiltroDaArvore, valor: string): void => {
    setFiltro((atual) => ({ ...atual, [chave]: valor }));
  };

  return (
    <Dialog open onClose={onCancelar} maxWidth="xs" fullWidth>
      <DialogTitle>Filtrar {pedido.rotulo}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {campos.map((campo) => (
            <TextField
              key={campo.chave}
              label={campo.rotulo}
              placeholder={campo.dica}
              size="small"
              value={filtro[campo.chave]}
              onChange={(e) => trocar(campo.chave, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // `preventDefault` NÃO é enfeite: sem ele o diálogo reabre.
                // Ao fechar, o MUI devolve o foco ao botão que o abriu, e o
                // mesmo `Enter` ainda em curso o aciona — o filtro é aplicado e
                // a janela volta com o texto dentro, parecendo que nada houve.
                // Achado pelo teste de ponta a ponta, não pela leitura.
                e.preventDefault();
                e.stopPropagation();
                void onAplicar(filtro);
              }}
              autoFocus={campo.chave === 'nome'}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          ))}
          {/* O que a IDE entendeu, em português. Sem isto, "grande" digitado no
              tamanho vira lista inteira e parece defeito. */}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {explicarFiltro(filtro, new Date())}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        {/* Limpar é um BOTÃO, e não "apagar o texto e confirmar": com quatro
            campos, esvaziar um por um é trabalho, e esquecer um deixa filtro. */}
        <Button
          onClick={() => void onAplicar(FILTRO_VAZIO)}
          disabled={estaVazio(filtro) && pedido.atual === null}
        >
          Limpar
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onCancelar}>Cancelar</Button>
        <Button variant="contained" onClick={() => void onAplicar(filtro)}>
          Aplicar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
