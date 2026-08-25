// A sub-aba Port Forwarding (spec 059).
//
// É a única das quatro que o usuário mostrou e **não descreveu** — a tela aqui
// é desenho meu, e diz o que um encaminhamento é em vez de supor que se saiba:
// quem falar com a porta local está falando com o outro lado.
//
// O uso que justifica a fase inteira está escrito na própria tela: um banco que
// só existe dentro da rede do servidor vira um banco em `127.0.0.1`, e o driver
// da spec 006 não precisa saber de nada.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { Api } from '../api';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import type { PortForward } from '../../shared/contracts';

export interface PortasPanelProps {
  readonly conexaoId: string;
  readonly ativo: boolean;
  onErro(erro: unknown): void;
}

export function PortasPanel({ conexaoId, ativo, onErro }: PortasPanelProps) {
  const [tuneis, setTuneis] = useState<readonly PortForward[]>([]);
  const [host, setHost] = useState('127.0.0.1');
  const [portaRemota, setPortaRemota] = useState('3306');
  const [portaLocal, setPortaLocal] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setTuneis(await Api.encaminhamentos(conexaoId));
  }, [conexaoId]);

  useEffect(() => {
    if (!ativo) return;
    recarregar().catch(onErro);
  }, [ativo, onErro, recarregar]);

  const abrir = async (): Promise<void> => {
    setErro(null);
    try {
      await Api.abrirEncaminhamento(conexaoId, {
        remoteHost: host.trim(),
        remotePort: Number(portaRemota),
        // Em branco: o sistema escolhe uma porta livre e a IDE diz qual foi.
        localPort: portaLocal.trim() === '' ? undefined : Number(portaLocal),
      });
      setPortaLocal('');
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, p: 1.5, bgcolor: tokens.bgEditor }}>
      <Box sx={{ fontSize: 11.5, color: 'text.secondary', mb: 1.5, maxWidth: 640 }}>
        Um encaminhamento faz a porta local falar com um endereço do outro lado.
        Serve para alcançar o que só existe dentro da rede do servidor — um banco,
        por exemplo: ele vira <code>127.0.0.1</code> para a IDE, e a conexão de
        banco não precisa saber de nada.
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Campo rotulo="Host remoto" valor={host} onMudar={setHost} largura={200} />
        <Campo rotulo="Porta remota" valor={portaRemota} onMudar={setPortaRemota} largura={110} />
        <Campo
          rotulo="Porta local"
          valor={portaLocal}
          onMudar={setPortaLocal}
          largura={110}
          apoio="em branco = livre"
        />
        <Box
          component="button"
          type="button"
          onClick={() => void abrir()}
          sx={{
            border: 0, bgcolor: 'action.selected', color: 'primary.main', font: 'inherit',
            fontSize: 11.5, px: 1.25, py: 0.6, borderRadius: 0.5, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}
        >
          <Icon name="lucide:plug" size={13} />
          Encaminhar
        </Box>
      </Box>

      {erro !== null && (
        <Box
          data-erro-portas
          sx={{
            mb: 1.5, px: 1.25, py: 0.5, bgcolor: 'error.main',
            color: 'background.default', fontSize: 11,
          }}
        >
          {erro}
        </Box>
      )}

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5 }}>
        <Linha cabecalho />
        {tuneis.map((t) => (
          <Linha key={t.id} marca={t.id}>
            <Box sx={{ fontFamily: tokens.fontMono }}>127.0.0.1:{t.localPort}</Box>
            <Box sx={{ color: 'text.secondary' }}>→</Box>
            <Box sx={{ fontFamily: tokens.fontMono }}>
              {t.remoteHost}:{t.remotePort}
            </Box>
            <Box
              component="button"
              type="button"
              aria-label={`Fechar o encaminhamento ${t.localPort}`}
              onClick={() => {
                Api.fecharEncaminhamento(conexaoId, t.id)
                  .then(recarregar)
                  .catch(onErro);
              }}
              sx={{
                ml: 'auto', border: 0, bgcolor: 'transparent', color: 'text.secondary',
                p: 0.25, cursor: 'pointer', display: 'flex',
                '&:hover': { color: 'error.main' },
              }}
            >
              <Icon name="lucide:x" size={13} />
            </Box>
          </Linha>
        ))}
        {tuneis.length === 0 && (
          <Box sx={{ p: 1.5, fontSize: 11.5, color: 'text.secondary' }}>
            Nenhum encaminhamento aberto.
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Campo({
  rotulo, valor, onMudar, largura, apoio,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly onMudar: (v: string) => void;
  readonly largura: number;
  readonly apoio?: string;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Box sx={{ fontSize: 10, color: 'text.secondary' }}>{rotulo}</Box>
      <Box
        component="input"
        aria-label={rotulo}
        value={valor}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onMudar(e.target.value)}
        sx={{
          width: largura, border: 1, borderColor: 'divider', borderRadius: 0.5,
          bgcolor: 'background.paper', color: 'text.primary',
          fontFamily: tokens.fontMono, fontSize: 11.5, px: 0.75, py: 0.5,
          outline: 'none',
        }}
      />
      {apoio !== undefined && (
        <Box sx={{ fontSize: 9.5, color: 'text.secondary' }}>{apoio}</Box>
      )}
    </Box>
  );
}

function Linha({
  children, cabecalho = false, marca,
}: {
  readonly children?: React.ReactNode;
  readonly cabecalho?: boolean;
  readonly marca?: string;
}) {
  return (
    <Box
      data-tunel={marca}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5,
        fontSize: 11.5,
        color: cabecalho ? 'text.secondary' : 'text.primary',
        borderBottom: cabecalho ? 1 : 0,
        borderColor: 'divider',
      }}
    >
      {cabecalho ? (
        <>
          <Box sx={{ width: 160 }}>LOCAL</Box>
          <Box sx={{ width: 20 }} />
          <Box>REMOTO</Box>
        </>
      ) : (
        children
      )}
    </Box>
  );
}
