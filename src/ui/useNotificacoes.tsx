// A pilha de notificações e o sino (T107).
//
// A nota dele: *"empilham no canto, e um sino guarda o histórico da sessão"*.
//
// **Não substitui o diálogo.** O `avisar` que interrompe continua para o que
// exige decisão. Isto é para o que só precisa ser dito — e que hoje ou vira um
// diálogo demais, ou não vira nada.
//
// A REGRA (quanto tempo cada tipo fica, o que sai quando enche) mora em
// `shared/notificacoes.ts` e é testada sem navegador. Aqui fica o estado e o
// desenho.
import { useCallback, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { Icon } from './Icon';
import {
  DURACAO, empilhar, naoLidos, noHistorico, tipoDoErro,
  type Aviso, type TipoDeAviso,
} from '../shared/notificacoes';
import { quandoEmPalavras } from '../shared/historico-local';

const ICONE: Readonly<Record<TipoDeAviso, string>> = {
  info: 'lucide:info',
  sucesso: 'lucide:circle-check',
  atencao: 'lucide:circle-alert',
  erro: 'lucide:circle-x',
};

const COR: Readonly<Record<TipoDeAviso, string>> = {
  info: 'text.secondary',
  sucesso: 'success.main',
  atencao: 'warning.main',
  erro: 'error.main',
};

export interface NotificacoesController {
  /** Empilha um aviso no canto. */
  notificar(mensagem: string, tipo?: TipoDeAviso, origem?: string): void;
  /** Atalho para `.catch()` que NÃO interrompe — o erro vira notificação. */
  aoFalhar(erro: unknown, origem?: string): void;
  /** A pilha, para pôr no canto da tela. */
  readonly pilha: React.ReactNode;
  /** O sino, para a barra de status. */
  readonly sino: React.ReactNode;
}

export function useNotificacoes(): NotificacoesController {
  const [pilha, setPilha] = useState<readonly Aviso[]>([]);
  const [historico, setHistorico] = useState<readonly Aviso[]>([]);
  const [lidoAte, setLidoAte] = useState(0);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  /** Os relógios de cada aviso, para poder cancelá-los ao fechar na mão. */
  const relogios = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const fechar = useCallback((id: string) => {
    const relogio = relogios.current.get(id);
    if (relogio !== undefined) clearTimeout(relogio);
    relogios.current.delete(id);
    setPilha((atual) => atual.filter((a) => a.id !== id));
  }, []);

  const notificar = useCallback(
    (mensagem: string, tipo: TipoDeAviso = 'info', origem?: string) => {
      const aviso: Aviso = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quando: Date.now(),
        tipo,
        mensagem,
        ...(origem === undefined ? {} : { origem }),
      };
      setPilha((atual) => empilhar(atual, aviso));
      // O histórico guarda TUDO que passou pela pilha, inclusive o que sumiu
      // sozinho: é para isso que o sino existe — ver o que passou enquanto se
      // olhava para outro lado.
      setHistorico((atual) => noHistorico(atual, aviso));

      const duracao = DURACAO[tipo];
      if (duracao !== null) {
        relogios.current.set(aviso.id, setTimeout(() => fechar(aviso.id), duracao));
      }
    },
    [fechar]
  );

  const aoFalhar = useCallback(
    (erro: unknown, origem?: string) => {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      notificar(mensagem, tipoDoErro(mensagem), origem);
    },
    [notificar]
  );

  const pendentes = naoLidos(historico, lidoAte);

  return {
    notificar,
    aoFalhar,

    pilha: (
      <Box
        data-pilha-de-avisos
        sx={{
          position: 'fixed', right: 16, bottom: 40, zIndex: 1400,
          display: 'flex', flexDirection: 'column', gap: 0.75,
          // Sem `pointerEvents` aqui, a caixa invisível cobriria a barra de
          // status inteira e roubaria os cliques dela. Cada aviso religa o seu.
          pointerEvents: 'none',
          maxWidth: 380,
        }}
      >
        {pilha.map((aviso) => (
          <Box
            key={aviso.id}
            data-aviso={aviso.tipo}
            sx={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'flex-start', gap: 0.75,
              px: 1.25, py: 0.9, borderRadius: 0.5,
              bgcolor: 'background.paper',
              border: 1, borderColor: 'divider',
              borderLeft: 3, borderLeftColor: COR[aviso.tipo],
              boxShadow: 3, fontSize: 12,
            }}
          >
            <Box sx={{ color: COR[aviso.tipo], mt: '1px' }}>
              <Icon name={ICONE[aviso.tipo]} size={14} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>
              {aviso.origem !== undefined && (
                <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>
                  {aviso.origem}:
                </Box>
              )}
              {aviso.mensagem}
            </Box>
            <Box
              component="button"
              type="button"
              aria-label="Fechar o aviso"
              onClick={() => fechar(aviso.id)}
              sx={{
                border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer',
                p: 0, display: 'flex', '&:hover': { color: 'text.primary' },
              }}
            >
              <Icon name="lucide:x" size={12} />
            </Box>
          </Box>
        ))}
      </Box>
    ),

    sino: (
      <>
        <Box
          component="button"
          type="button"
          data-sino
          aria-label={
            pendentes === 0 ? 'Histórico de avisos' : `${pendentes} aviso(s) não lido(s)`
          }
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            setAncora(e.currentTarget);
            // Marca como lido na ABERTURA: o que ele acabou de ver não pode
            // continuar contando como pendente.
            setLidoAte(Date.now());
          }}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.25,
            px: 0.5, height: '100%', '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name={pendentes > 0 ? 'lucide:bell-dot' : 'lucide:bell'} size={12} />
          {pendentes > 0 && <Box component="span" data-nao-lidos>{pendentes}</Box>}
        </Box>

        <Popover
          open={ancora !== null}
          anchorEl={ancora}
          onClose={() => setAncora(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          slotProps={{ paper: { sx: { width: 420, maxHeight: 400 } } }}
        >
          <Box
            data-historico-de-avisos
            sx={{ display: 'flex', flexDirection: 'column', maxHeight: 400 }}
          >
            <Box
              sx={{
                px: 1.25, py: 0.6, borderBottom: 1, borderColor: 'divider',
                fontSize: 11, color: 'text.secondary', display: 'flex', alignItems: 'center',
              }}
            >
              <Box sx={{ flex: 1 }}>Avisos desta sessão</Box>
              {historico.length > 0 && (
                <Box
                  component="button"
                  type="button"
                  onClick={() => setHistorico([])}
                  sx={{
                    border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
                    fontSize: 11, cursor: 'pointer',
                  }}
                >
                  limpar
                </Box>
              )}
            </Box>

            <Box sx={{ overflow: 'auto' }}>
              {historico.length === 0 ? (
                <Box sx={{ p: 1.5, fontSize: 12, color: 'text.secondary' }}>
                  Nada aconteceu ainda nesta sessão.
                </Box>
              ) : (
                historico.map((aviso) => (
                  <Box
                    key={aviso.id}
                    data-aviso-no-historico={aviso.tipo}
                    sx={{
                      display: 'flex', gap: 0.75, px: 1.25, py: 0.6,
                      borderBottom: 1, borderColor: 'divider', fontSize: 12,
                    }}
                  >
                    <Box sx={{ color: COR[aviso.tipo], mt: '2px' }}>
                      <Icon name={ICONE[aviso.tipo]} size={13} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word', lineHeight: 1.5 }}>
                      {aviso.mensagem}
                    </Box>
                    <Box sx={{ color: 'text.secondary', fontSize: 10.5, whiteSpace: 'nowrap' }}>
                      {quandoEmPalavras(aviso.quando)}
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Popover>
      </>
    ),
  };
}
