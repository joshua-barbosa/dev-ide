// Painel de arquivos: cabeçalho da pasta aberta e árvore.
//
// Puramente de apresentação — o estado vive em `usePasta`, porque a árvore, os
// símbolos e o botão de criar arquivo compartilham a mesma verdade.
//
// Não há carregamento preguiçoso aqui: o servidor devolve a árvore inteira de
// uma vez, diferente da árvore de conexões, onde cada nível custa uma consulta
// ao banco. O que existe é **teto** — ver o aviso de árvore cortada.
import { useCallback, useState } from 'react';
import {
  ICONE_DE_PASTA, ICONE_DE_PASTA_ABERTA, iconeDeArquivo,
} from '../../shared/editor/arquivos';
import { linguagemDe } from '../useWorkspace';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import type { FileNode } from '../api';
import type { PastaAberta } from './usePasta';
import { TreeRow } from '../tree/TreeRow';
import { codificarCarga, MIME_DE_ARRASTE } from '../../shared/arrastar';

export interface FilesPanelProps {
  readonly pasta: PastaAberta;
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly caminhoAtivo: string | null;
  /** Sobem para o App: quem pergunta é a entrada rápida. */
  readonly onAbrirPasta: () => void;
  readonly onErro: (erro: unknown) => void;
}

export function FilesPanel({
  pasta, onAbrirArquivo, caminhoAtivo, onAbrirPasta, onErro,
}: FilesPanelProps) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());

  const alternar = useCallback((caminho: string) => {
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(caminho)) proximo.delete(caminho);
      else proximo.add(caminho);
      return proximo;
    });
  }, []);

  const abrir = useCallback(
    (caminho: string) => {
      onAbrirArquivo(caminho).catch(onErro);
    },
    [onAbrirArquivo, onErro]
  );

  const renderizar = (nos: readonly FileNode[], nivel: number): React.ReactNode =>
    nos.map((no) => {
      const aberta = abertas.has(no.path);
      return (
        <Box key={no.path}>
          <TreeRow
            nivel={nivel}
            rotulo={no.name}
            icone={
              no.type === 'dir'
                ? (aberta ? ICONE_DE_PASTA_ABERTA : ICONE_DE_PASTA)
                : iconeDeArquivo(no.path, linguagemDe(no.path))
            }
            expansivel={no.type === 'dir'}
            aberto={aberta}
            ativo={no.path === caminhoAtivo}
            onClick={() => (no.type === 'dir' ? alternar(no.path) : abrir(no.path))}
            aoArrastar={
              no.type === 'dir'
                ? undefined
                : (e) => {
                    e.dataTransfer.setData(
                      MIME_DE_ARRASTE,
                      codificarCarga({ tipo: 'arquivo', caminho: no.path })
                    );
                    e.dataTransfer.effectAllowed = 'copyMove';
                  }
            }
          />
          {no.type === 'dir' && aberta && renderizar(no.children ?? [], nivel + 1)}
        </Box>
      );
    });

  if (pasta.erro !== null) {
    return <Box sx={{ p: 1.25, color: 'error.main', fontSize: 11 }}>{pasta.erro}</Box>;
  }

  // Sem pasta aberta a IDE não finge ter uma: diz o que é e oferece a saída.
  if (pasta.pasta === '') {
    return (
      <Box sx={{ px: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
          Nenhuma pasta aberta.
        </Box>
        <Button variant="outlined" size="small" onClick={onAbrirPasta} sx={{ fontSize: 11 }}>
          Abrir pasta…
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          px: 1, pb: 0.75, display: 'flex', gap: 0.5, alignItems: 'center', minWidth: 0,
        }}
      >
        <Tooltip title={pasta.pasta} placement="bottom-start">
          <Box
            data-pasta-aberta={pasta.pasta}
            sx={{
              flex: 1, minWidth: 0, fontSize: 11, textTransform: 'uppercase',
              letterSpacing: 0.5, color: 'text.secondary',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {pasta.nome}
          </Box>
        </Tooltip>
        <Tooltip title="Abrir pasta…" placement="bottom">
          <Button onClick={onAbrirPasta} sx={{ minWidth: 28, px: 0.5 }}>
            <Icon name={ICONE_DE_PASTA} size={14} />
          </Button>
        </Tooltip>
      </Box>

      {pasta.truncada && (
        // Árvore cortada em silêncio parece pasta vazia pela metade. Dizer é o
        // mínimo — e é o que o teto de nós comprou.
        <Box
          data-arvore-truncada
          sx={{ px: 1.25, pb: 0.5, color: 'warning.main', fontSize: 10, lineHeight: 1.4 }}
        >
          Pasta grande: a árvore foi cortada. Abra uma subpasta para ver o resto.
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {pasta.arvore.length === 0 ? (
          <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
            pasta vazia — crie um arquivo
          </Box>
        ) : (
          renderizar(pasta.arvore, 0)
        )}
      </Box>
    </Box>
  );
}
