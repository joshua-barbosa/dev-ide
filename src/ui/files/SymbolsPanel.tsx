// Painel de símbolos do projeto.
//
// Agrupa por espécie na ordem em que interessa ler um arquivo desconhecido:
// primeiro os tipos, depois o que executa, por último o que guarda valor.
import { nomeParaExibir } from '../../shared/caminho-local';
import Box from '@mui/material/Box';
import type { SymbolInfo } from '../api';
import { tokens } from '../theme';

const ORDEM = ['class', 'interface', 'enum', 'function', 'method', 'object', 'const', 'variable'] as const;

const TITULO: Record<string, string> = {
  class: 'Classes', interface: 'Interfaces', enum: 'Enums', function: 'Funções',
  method: 'Métodos', object: 'Objetos', const: 'Constantes', variable: 'Variáveis',
};

const SIGLA: Record<string, string> = {
  class: 'C', interface: 'I', enum: 'E', function: 'ƒ',
  method: 'm', object: 'O', const: 'K', variable: 'v',
};

/** Uma cor por espécie, reaproveitando a paleta de tokens do editor. */
const COR: Record<string, string> = {
  class: '#e5c07b', interface: '#c678dd', enum: '#c678dd', function: '#61afef',
  method: '#61afef', object: '#56b6c2', const: '#e06c75', variable: '#d8dae2',
};

export interface SymbolsPanelProps {
  readonly simbolos: readonly SymbolInfo[];
  /** A busca está em voo — a lista chega quando a aba abre, não antes (D222). */
  readonly carregando?: boolean;
  readonly erro?: string | null;
  readonly onIr: (arquivo: string, linha: number) => void;
  /** Refaz a lista. A árvore muda sem a aba estar aberta; isto é o acerto. */
  readonly onRecarregar?: () => void;
}

export function SymbolsPanel({
  simbolos, carregando, erro, onIr, onRecarregar,
}: SymbolsPanelProps) {
  const aviso = (texto: string, cor = 'text.secondary') => (
    <Box sx={{ px: 1.25, color: cor, fontSize: 11, lineHeight: 1.5 }}>{texto}</Box>
  );

  // Enquanto procura, dizer que procura: sem isto o painel vazio parece um
  // projeto sem símbolos, e o usuário fecha a aba antes da resposta chegar.
  if (carregando === true && simbolos.length === 0) return aviso('Procurando símbolos…');
  if (erro !== null && erro !== undefined) return aviso(erro, 'error.main');

  if (simbolos.length === 0) {
    return (
      <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
        Nenhum símbolo — salve arquivos de código na pasta aberta.
      </Box>
    );
  }

  const porEspecie = new Map<string, SymbolInfo[]>();
  for (const s of simbolos) {
    const lista = porEspecie.get(s.kind);
    if (lista === undefined) porEspecie.set(s.kind, [s]);
    else lista.push(s);
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      {onRecarregar !== undefined && (
        <Box
          component="button"
          type="button"
          onClick={onRecarregar}
          disabled={carregando === true}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer',
            fontSize: 10.5, px: 1.25, py: 0.5, font: 'inherit', textAlign: 'left',
            '&:hover': { color: 'text.primary' },
          }}
        >
          {carregando === true ? 'Procurando…' : 'Recarregar'}
        </Box>
      )}
      {ORDEM.filter((especie) => porEspecie.has(especie)).map((especie) => (
        <Box key={especie}>
          <Box
            sx={{
              px: 1.25, pt: 0.75, pb: 0.25, color: 'text.secondary', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}
          >
            {TITULO[especie] ?? especie}
          </Box>
          {(porEspecie.get(especie) ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <Box
                key={`${s.file}:${s.line}:${s.name}`}
                onClick={() => onIr(s.file, s.line)}
                title={`${s.file}:${s.line}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: '2px',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: tokens.fontMono, fontSize: 12,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    width: 16, height: 16, borderRadius: '3px', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: tokens.bgEditor,
                    bgcolor: COR[especie] ?? tokens.fgDim,
                  }}
                >
                  {SIGLA[especie] ?? '?'}
                </Box>
                <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</Box>
                <Box sx={{ ml: 'auto', pl: 1, color: 'text.secondary', fontSize: 10 }}>
                  {nomeParaExibir(s.file)}:{s.line}
                </Box>
              </Box>
            ))}
        </Box>
      ))}
    </Box>
  );
}
