// A aba de um servidor, com as sub-abas que ele SABE oferecer (spec 055).
//
// As divisórias não são fixas: cada uma existe porque a sessão declarou a
// capacidade correspondente (`files`, `shell`, `monitor`, `forwarding`). É o
// que a spec 005 desenhou e nunca foi exercido — e é o que faz o FTP, na S8,
// nascer sem Terminal e sem Monitor sem ninguém escrever um `if` para ele.
//
// **Esconder é `display: none`, nunca desmontar** (emenda constitucional): a
// sub-aba de terminal segura um canal SSH vivo, e a de SFTP segura a pasta em
// que o usuário estava. Trocar de aba não pode jogar fora nem um nem outro.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { SftpPanel } from '../sftp/SftpPanel';
import { MonitorPanel } from '../monitor/MonitorPanel';
import { PortasPanel } from '../portas/PortasPanel';
import type { SessionCapabilities } from '../../shared/contracts';
import type { EntradaMenu } from '../ContextMenu';

export type SubAbaDoServidor = 'monitor' | 'terminal' | 'sftp' | 'portas';

interface Divisoria {
  readonly id: SubAbaDoServidor;
  readonly rotulo: string;
  readonly icone: string;
  /** Que capacidade da sessão faz esta divisória existir. */
  readonly exige: keyof SessionCapabilities;
}

/** Na ordem da ferramenta de referência. */
const DIVISORIAS: readonly Divisoria[] = [
  { id: 'monitor', rotulo: 'Monitor', icone: 'lucide:activity', exige: 'monitor' },
  { id: 'terminal', rotulo: 'Terminal', icone: 'lucide:square-terminal', exige: 'shell' },
  { id: 'sftp', rotulo: 'SFTP', icone: 'lucide:folder', exige: 'files' },
  { id: 'portas', rotulo: 'Port Forwarding', icone: 'lucide:plug', exige: 'forwarding' },
];

export interface ServidorHostProps {
  readonly conexaoId: string;
  readonly rotulo: string;
  readonly capacidades: SessionCapabilities | null;
  readonly somenteLeitura: boolean;
  /** Abre um arquivo remoto no editor — o duplo clique da tabela. */
  onAbrirArquivo(conexaoId: string, caminho: string): Promise<void>;
  /** Abre o terminal daquela conexão numa aba própria (spec 054). */
  onAbrirTerminal(): void;
  /** Abre o menu de botão direito da tabela SFTP (T079). */
  abrirMenu(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
  /** Pergunta antes do que não tem volta — kill de processo e excluir (T079, T080). */
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  /**
   * Pergunta um texto — nome novo, permissões, nome de arquivo.
   *
   * Chega por props, e não por `window.prompt`, por dois motivos que apontam
   * para o mesmo lado: dentro da webview do editor o `prompt` devolve `null`
   * calado, e na IDE quem pergunta é a entrada rápida, que já existe. Quem
   * monta a tela decide qual caixa aparece.
   */
  pedirTexto(o: {
    titulo: string;
    valorInicial?: string;
  }): Promise<string | null>;
  onErro(erro: unknown): void;
}

export function ServidorHost({
  conexaoId, rotulo, capacidades, somenteLeitura, onAbrirArquivo, onAbrirTerminal, abrirMenu,
  confirmar, pedirTexto, onErro,
}: ServidorHostProps) {
  const disponiveis = DIVISORIAS.filter(
    (d) => capacidades !== null && capacidades[d.exige] === true
  );
  // Abre no Monitor, como a ferramenta de referência: é o que se quer ver ao
  // chegar num servidor.
  const [ativa, setAtiva] = useState<SubAbaDoServidor>('monitor');
  const atual = disponiveis.some((d) => d.id === ativa) ? ativa : disponiveis[0]?.id;

  if (disponiveis.length === 0) {
    return (
      <Box sx={{ p: 2, color: 'text.secondary', fontSize: 12 }}>
        {capacidades === null
          ? 'Conectando…'
          : 'Esta conexão não tem nada além da árvore.'}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: tokens.bgEditor }}>
      <Box
        data-sub-abas-do-servidor
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.25, px: 0.5,
          borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0,
        }}
      >
        {disponiveis.map((d) => (
          <Box
            key={d.id}
            component="button"
            type="button"
            role="tab"
            aria-selected={atual === d.id}
            data-sub-aba={d.id}
            onClick={() => setAtiva(d.id)}
            sx={{
              border: 0, bgcolor: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75,
              font: 'inherit', fontSize: 11.5,
              color: atual === d.id ? 'text.primary' : 'text.secondary',
              borderBottom: 2,
              borderColor: atual === d.id ? 'primary.main' : 'transparent',
            }}
          >
            <Icon name={d.icone} size={13} />
            {d.rotulo}
          </Box>
        ))}
      </Box>

      {disponiveis.map((d) => (
        <Box
          key={d.id}
          // `display: none`, e não desmontar: a divisória guarda estado que
          // custa caro para refazer — a pasta em que o usuário estava, e o
          // canal do terminal.
          sx={{
            flex: 1, minHeight: 0,
            display: atual === d.id ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          {d.id === 'sftp' && (
            <SftpPanel
              conexaoId={conexaoId}
              raiz={capacidades?.rootPath ?? '/'}
              somenteLeitura={somenteLeitura}
              onAbrirArquivo={onAbrirArquivo}
              abrirMenu={abrirMenu}
              confirmar={confirmar}
              pedirTexto={pedirTexto}
              onErro={onErro}
            />
          )}
          {d.id === 'monitor' && (
            <MonitorPanel
              conexaoId={conexaoId}
              somenteLeitura={somenteLeitura}
              confirmar={confirmar}
              // Escondido, o monitor PARA de medir: um relógio que sobrevive à
              // troca de aba mediria um servidor que ninguém está olhando.
              ativo={atual === 'monitor'}
              onErro={onErro}
            />
          )}
          {d.id === 'portas' && (
            <PortasPanel conexaoId={conexaoId} ativo={atual === 'portas'} onErro={onErro} />
          )}
          {d.id === 'terminal' && (
            <Box sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>
              O terminal deste servidor abre em aba própria — é o mesmo canal.{' '}
              <Box
                component="button"
                type="button"
                onClick={onAbrirTerminal}
                sx={{
                  border: 0, bgcolor: 'transparent', color: 'primary.main',
                  font: 'inherit', cursor: 'pointer', p: 0,
                }}
              >
                Abrir o terminal de {rotulo}
              </Box>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
