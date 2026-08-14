// Painel de arquivos: seletor de projeto e árvore.
//
// Pastas guardam o estado de aberta/fechada localmente; não há carregamento
// preguiçoso aqui porque o servidor já devolve a árvore inteira do projeto —
// diferente da árvore de conexões, onde cada nível custa uma consulta.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { Api, type FileNode } from '../api';
import { Icon } from '../Icon';
import { TreeRow } from '../tree/TreeRow';

export interface FilesPanelProps {
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly caminhoAtivo: string | null;
}

export function FilesPanel({ onAbrirArquivo, caminhoAtivo }: FilesPanelProps) {
  const [projetos, setProjetos] = useState<readonly string[]>([]);
  const [projeto, setProjeto] = useState('');
  const [arvore, setArvore] = useState<readonly FileNode[]>([]);
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Api.listProjects()
      .then((lista) => {
        setProjetos(lista);
        setProjeto((atual) => (atual === '' ? (lista[0] ?? '') : atual));
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  useEffect(() => {
    if (projeto === '') return;
    Api.fileTree(projeto)
      .then(setArvore)
      .catch((e: Error) => setErro(e.message));
  }, [projeto]);

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

  if (erro !== null) {
    return (
      <Box sx={{ p: 1.25, color: 'error.main', fontSize: 11 }}>{erro}</Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ px: 1, pb: 0.75, display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <TextField
          select
          fullWidth
          value={projeto}
          onChange={(e) => setProjeto(e.target.value)}
          slotProps={{ select: { displayEmpty: true } }}
          sx={{ '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        >
          {projetos.length === 0 && (
            <MenuItem value="" disabled>
              (sem projetos)
            </MenuItem>
          )}
          {projetos.map((nome) => (
            <MenuItem key={nome} value={nome}>
              {nome}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {arvore.length === 0 ? (
          <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
            <Icon name="folder" size={11} /> projeto vazio — crie um arquivo
          </Box>
        ) : (
          renderizar(arvore, 0)
        )}
      </Box>
    </Box>
  );
}
