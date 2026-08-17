// Painel de arquivos: seletor de projeto e árvore.
//
// Puramente de apresentação — o estado do projeto vive em useProject, porque a
// árvore, os símbolos e o botão de criar arquivo compartilham a mesma verdade.
//
// Não há carregamento preguiçoso aqui: o servidor devolve a árvore inteira do
// projeto de uma vez, diferente da árvore de conexões, onde cada nível custa
// uma consulta ao banco.
import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { FileNode } from '../api';
import type { Project } from './useProject';
import { TreeRow } from '../tree/TreeRow';

export interface FilesPanelProps {
  readonly projeto: Project;
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly caminhoAtivo: string | null;
  /** Sobe para o App: quem pergunta o nome é a entrada rápida. */
  readonly onNovoProjeto: () => void;
}

export function FilesPanel({
  projeto, onAbrirArquivo, caminhoAtivo, onNovoProjeto,
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
      onAbrirArquivo(caminho).catch((e: Error) => window.alert(e.message));
    },
    [onAbrirArquivo]
  );

  const renderizar = (nos: readonly FileNode[], nivel: number): React.ReactNode =>
    nos.map((no) => {
      const aberta = abertas.has(no.path);
      return (
        <Box key={no.path}>
          <TreeRow
            nivel={nivel}
            rotulo={no.name}
            icone={no.type === 'dir' ? 'folder' : 'file'}
            expansivel={no.type === 'dir'}
            aberto={aberta}
            ativo={no.path === caminhoAtivo}
            onClick={() => (no.type === 'dir' ? alternar(no.path) : abrir(no.path))}
          />
          {no.type === 'dir' && aberta && renderizar(no.children ?? [], nivel + 1)}
        </Box>
      );
    });

  if (projeto.erro !== null) {
    return <Box sx={{ p: 1.25, color: 'error.main', fontSize: 11 }}>{projeto.erro}</Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ px: 1, pb: 0.75, display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <TextField
          select
          fullWidth
          value={projeto.projeto}
          onChange={(e) => projeto.selecionar(e.target.value)}
          slotProps={{ select: { displayEmpty: true } }}
          sx={{ '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        >
          {projeto.projetos.length === 0 && (
            <MenuItem value="" disabled>(sem projetos)</MenuItem>
          )}
          {projeto.projetos.map((nome) => (
            <MenuItem key={nome} value={nome}>{nome}</MenuItem>
          ))}
        </TextField>
        <Button
          onClick={onNovoProjeto}
          title="Criar novo projeto"
          sx={{ minWidth: 32 }}
        >
          ＋
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {projeto.arvore.length === 0 ? (
          <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
            projeto vazio — crie um arquivo
          </Box>
        ) : (
          renderizar(projeto.arvore, 0)
        )}
      </Box>
    </Box>
  );
}
