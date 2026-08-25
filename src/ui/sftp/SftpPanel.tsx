// A tabela SFTP, estilo FileZilla (spec 055).
//
// É a MESMA coisa que a árvore da lateral vê — o mesmo `RemoteFiles` —, com
// outro gesto: lá se navega em profundidade, aqui se navega uma pasta por vez,
// com colunas, ordenação e o caminho corrente à vista. As duas superfícies
// existem porque servem a dois usos, e nascem do mesmo lugar para não
// divergirem.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Api } from '../api';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { paiDe } from '../../shared/remoto/caminho';
import { ordenarPorColuna, type ColunaDeOrdem, type Direcao } from '../../shared/remoto/ordenacao';
import type { RemoteEntry } from '../../shared/contracts';

interface Coluna {
  readonly id: ColunaDeOrdem;
  readonly rotulo: string;
  readonly largura: string;
  readonly alinhar?: 'right';
}

const COLUNAS: readonly Coluna[] = [
  { id: 'nome', rotulo: 'NAME', largura: '1fr' },
  { id: 'tamanho', rotulo: 'SIZE', largura: '110px', alinhar: 'right' },
  { id: 'modificado', rotulo: 'MODIFIED', largura: '190px' },
  { id: 'tipo', rotulo: 'KIND', largura: '90px' },
  { id: 'dono', rotulo: 'OWNER', largura: '150px' },
];

const GRADE = COLUNAS.map((c) => c.largura).join(' ');

function tamanhoLegivel(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(2)} ${unidades[i]}`;
}

function quando(ms: number | null): string {
  if (ms === null) return '--';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** O que a coluna `KIND` mostra — a extensão, como na ferramenta de referência. */
function tipoLegivel(entrada: RemoteEntry): string {
  if (entrada.kind === 'folder') return 'folder';
  if (entrada.kind === 'link') return 'link';
  const nome = entrada.name;
  const ponto = nome.lastIndexOf('.');
  return ponto > 0 ? nome.slice(ponto + 1) : 'file';
}

export interface SftpPanelProps {
  readonly conexaoId: string;
  /** Onde abrir. Vem da sessão — não é sempre `/` (spec 055). */
  readonly raiz: string;
  readonly somenteLeitura: boolean;
  onAbrirArquivo(conexaoId: string, caminho: string): Promise<void>;
  onErro(erro: unknown): void;
}

export function SftpPanel({
  conexaoId, raiz, somenteLeitura, onAbrirArquivo, onErro,
}: SftpPanelProps) {
  const [caminho, setCaminho] = useState(raiz);
  const [entradas, setEntradas] = useState<readonly RemoteEntry[] | null>(null);
  const [coluna, setColuna] = useState<ColunaDeOrdem>('nome');
  const [direcao, setDirecao] = useState<Direcao>('asc');
  const [carregando, setCarregando] = useState(false);

  const listar = useCallback(
    async (alvo: string) => {
      setCarregando(true);
      try {
        setEntradas(await Api.listarRemoto(conexaoId, alvo));
        setCaminho(alvo);
      } finally {
        setCarregando(false);
      }
    },
    [conexaoId]
  );

  useEffect(() => {
    listar(caminho).catch(onErro);
    // Só na montagem: navegar depois é gesto do usuário, e refazer a listagem a
    // cada renderização faria uma ida ao servidor por tecla digitada em
    // qualquer lugar da IDE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ir = (alvo: string): void => {
    listar(alvo).catch(onErro);
  };

  const ordenadas = entradas === null ? [] : ordenarPorColuna(entradas, coluna, direcao);
  // Não há para onde subir a partir da raiz da CONEXÃO — e com `Prender na
  // raiz` ligado, tentar seria recusado pela rota.
  const naRaiz = caminho === raiz;

  const alternarOrdem = (id: ColunaDeOrdem): void => {
    if (id === coluna) setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setColuna(id);
      setDirecao('asc');
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
        }}
      >
        <Acao
          icone="lucide:chevron-up"
          rotulo="Subir uma pasta"
          desabilitada={naRaiz}
          onClick={() => ir(paiDe(caminho))}
        />
        <Acao icone="lucide:refresh-cw" rotulo="Recarregar" onClick={() => ir(caminho)} />
        {!somenteLeitura && (
          <>
            <Acao
              icone="lucide:folder-plus"
              rotulo="Nova pasta"
              onClick={() => void criar('pasta')}
            />
            <Acao
              icone="lucide:file-plus-2"
              rotulo="Novo arquivo"
              onClick={() => void criar('arquivo')}
            />
          </>
        )}
        <Box
          data-caminho-sftp
          sx={{
            ml: 1, fontFamily: tokens.fontMono, fontSize: 11.5, color: 'text.secondary',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {caminho}
        </Box>
        {carregando && (
          <Box sx={{ ml: 'auto', fontSize: 11, color: 'text.secondary' }}>carregando…</Box>
        )}
      </Box>

      <Box
        sx={{
          display: 'grid', gridTemplateColumns: GRADE, gap: 1, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
          fontSize: 10.5, color: 'text.secondary', letterSpacing: 0.4,
        }}
      >
        {COLUNAS.map((c) => (
          <Box
            key={c.id}
            component="button"
            type="button"
            onClick={() => alternarOrdem(c.id)}
            data-coluna={c.id}
            aria-label={`Ordenar por ${c.rotulo}`}
            sx={{
              border: 0, bgcolor: 'transparent', font: 'inherit', cursor: 'pointer',
              color: coluna === c.id ? 'text.primary' : 'inherit',
              display: 'flex', alignItems: 'center', gap: 0.25, p: 0,
              justifyContent: c.alinhar === 'right' ? 'flex-end' : 'flex-start',
            }}
          >
            {c.rotulo}
            <Icon
              name={
                coluna !== c.id
                  ? 'lucide:chevrons-up-down'
                  : direcao === 'asc'
                    ? 'lucide:chevron-up'
                    : 'lucide:chevron-down'
              }
              size={10}
            />
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {!naRaiz && (
          <Linha marca=".." onDuploClique={() => ir(paiDe(caminho))}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Icon name="lucide:corner-left-up" size={13} />
              ..
            </Box>
            <Box />
            <Box />
            <Box sx={{ color: 'text.secondary' }}>folder</Box>
            <Box />
          </Linha>
        )}

        {ordenadas.map((e) => (
          <Linha
            key={e.path}
            marca={e.path}
            onDuploClique={() => {
              // Dois cliques: pasta ENTRA, arquivo ABRE. É o gesto do FileZilla,
              // e é o que o usuário descreveu.
              if (e.kind === 'file') void onAbrirArquivo(conexaoId, e.path).catch(onErro);
              else ir(e.path);
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
              <Icon
                name={
                  e.kind === 'folder'
                    ? 'lucide:folder'
                    : e.kind === 'link'
                      ? 'lucide:link'
                      : 'lucide:file'
                }
                size={13}
              />
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</Box>
            </Box>
            <Box sx={{ textAlign: 'right', color: 'text.secondary' }}>
              {tamanhoLegivel(e.size)}
            </Box>
            <Box sx={{ color: 'text.secondary' }}>{quando(e.modifiedAt)}</Box>
            <Box sx={{ color: 'text.secondary' }}>{tipoLegivel(e)}</Box>
            <Box sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.owner ?? '--'}
            </Box>
          </Linha>
        ))}

        {entradas !== null && ordenadas.length === 0 && (
          <Box sx={{ p: 2, color: 'text.secondary', fontSize: 12 }}>(pasta vazia)</Box>
        )}
      </Box>
    </Box>
  );

  async function criar(tipo: 'pasta' | 'arquivo'): Promise<void> {
    // O nome vem de um `prompt` do navegador de propósito: a entrada rápida da
    // IDE pertence ao `App`, e passá-la por cinco níveis de props só para esta
    // caixa seria arrastar o mundo inteiro até aqui. Trocar por ela é uma
    // melhoria óbvia se este painel ganhar mais entradas de texto.
    const nome = window.prompt(tipo === 'pasta' ? 'Nome da nova pasta' : 'Nome do novo arquivo');
    if (nome === null || nome.trim() === '') return;
    const alvo = `${caminho === '/' ? '' : caminho}/${nome.trim()}`;
    try {
      if (tipo === 'pasta') await Api.criarPastaRemota(conexaoId, alvo);
      else await Api.gravarArquivoRemoto(conexaoId, alvo, '');
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }
}

function Linha({
  children, marca, onDuploClique,
}: {
  readonly children: React.ReactNode;
  readonly marca?: string;
  onDuploClique(): void;
}) {
  return (
    <Box
      data-linha-sftp={marca}
      onDoubleClick={onDuploClique}
      sx={{
        display: 'grid', gridTemplateColumns: GRADE, gap: 1, px: 1, py: 0.4,
        fontSize: 12, cursor: 'default', userSelect: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {children}
    </Box>
  );
}

function Acao({
  icone, rotulo, onClick, desabilitada = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    <Tooltip title={rotulo} placement="bottom" describeChild>
      <Box component="span">
        <Box
          component="button"
          type="button"
          aria-label={rotulo}
          disabled={desabilitada}
          onClick={onClick}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', p: 0.5, borderRadius: 0.5,
            display: 'flex', cursor: desabilitada ? 'default' : 'pointer',
            opacity: desabilitada ? 0.3 : 1,
            '&:hover': { bgcolor: desabilitada ? 'transparent' : 'action.hover' },
          }}
        >
          <Icon name={icone} size={14} />
        </Box>
      </Box>
    </Tooltip>
  );
}
