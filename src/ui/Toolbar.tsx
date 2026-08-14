// Barra de ferramentas.
//
// Mesma composição da versão anterior — arquivo, tipo e execução — porque o
// critério desta migração é paridade.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { LANGUAGES } from '../shared/editor/languages';
import { tokens } from './theme';

/** Rótulos amigáveis; a ordem é a que o seletor mostra. */
const LINGUAGENS: ReadonlyArray<readonly [string, string]> = [
  ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'],
  ['php', 'PHP'], ['c', 'C'], ['csharp', 'C#'], ['sql', 'SQL'],
  ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'], ['plain', 'Texto'],
];

export interface ToolbarProps {
  readonly linguagem: string;
  readonly onLinguagem: (lang: string) => void;
  readonly onNovo: () => void;
  readonly onAbrir: () => void;
  readonly onSalvar: () => void;
  readonly onExecutar: (modo: 'file' | 'block') => void;
  readonly ehSql: boolean;
}

export function Toolbar({
  linguagem, onLinguagem, onNovo, onAbrir, onSalvar, onExecutar, ehSql,
}: ToolbarProps) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.75, px: 1.25, py: 0.75,
        bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ fontFamily: tokens.fontMono, fontWeight: 700, color: 'primary.main' }}>
        dev-ide
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Button onClick={onNovo}>novo</Button>
        <Button onClick={onAbrir}>abrir</Button>
        <Button onClick={onSalvar}>salvar</Button>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ color: 'text.secondary', fontSize: 11, textTransform: 'uppercase' }}>Tipo</Box>
        <TextField
          select
          value={LANGUAGES[linguagem] === undefined ? 'plain' : linguagem}
          onChange={(e) => onLinguagem(e.target.value)}
          sx={{ minWidth: 120, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        >
          {LINGUAGENS.map(([valor, rotulo]) => (
            <MenuItem key={valor} value={valor}>{rotulo}</MenuItem>
          ))}
        </TextField>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Button color="success" onClick={() => onExecutar('file')}>
          {/* Numa aba SQL o mesmo botão manda para o banco: o despacho é por contexto */}
          ▶ {ehSql ? 'consulta' : 'arquivo'}
        </Button>
        <Button color="success" onClick={() => onExecutar('block')}>▶ seleção</Button>
      </Box>
    </Box>
  );
}
