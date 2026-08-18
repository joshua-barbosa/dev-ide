// Entrada rápida: a caixa que aparece no topo central, no estilo do F1 do VS Code.
//
// Um componente com três modos, e não três componentes: a navegação por setas, o
// foco, o Enter e o Esc são idênticos nos três. Três cópias divergiriam — e é
// justamente o comportamento de teclado que ninguém lembra de replicar igual.
//
// Substitui os `window.prompt()` que a IDE usava para nome de arquivo, nome de
// projeto e caminho a abrir.
import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import { Icon } from './Icon';

export interface OpcaoRapida {
  readonly valor: string;
  readonly rotulo: string;
  readonly detalhe?: string;
  readonly icone?: string;
  /** Mostrado à direita, como o atalho num item de menu. */
  readonly sufixo?: string;
}

export interface QuickInputProps {
  readonly aberto: boolean;
  readonly titulo?: string;
  readonly placeholder: string;
  /** Ausente = modo texto livre: o que for digitado é a resposta. */
  readonly opcoes?: readonly OpcaoRapida[];
  readonly valorInicial?: string;
  readonly erro?: string | null;
  readonly permiteVazio?: boolean;
  readonly onConfirmar: (valor: string) => void;
  readonly onCancelar: () => void;
}

export function QuickInput({
  aberto, titulo, placeholder, opcoes, valorInicial = '', erro = null,
  permiteVazio = false, onConfirmar, onCancelar,
}: QuickInputProps) {
  const [texto, setTexto] = useState(valorInicial);
  const [indice, setIndice] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);

  const modoLista = opcoes !== undefined;

  const visiveis = useMemo(() => {
    if (opcoes === undefined) return [];
    const termos = texto.toLowerCase().split(/\s+/).filter((t) => t !== '');
    return opcoes.filter((o) => {
      const alvo = `${o.rotulo} ${o.detalhe ?? ''}`.toLowerCase();
      return termos.every((termo) => alvo.includes(termo));
    });
  }, [opcoes, texto]);

  // Cada abertura começa limpa; sem isso a caixa reabre com a busca anterior.
  useEffect(() => {
    if (aberto) {
      setTexto(valorInicial);
      setIndice(0);
    }
  }, [aberto, valorInicial]);

  // Filtrar pode encurtar a lista abaixo do item selecionado.
  useEffect(() => {
    setIndice((i) => (i >= visiveis.length ? 0 : i));
  }, [visiveis.length]);

  useEffect(() => {
    listaRef.current
      ?.querySelector('[data-selecionado="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [indice]);

  if (!aberto) return null;

  const confirmar = (): void => {
    if (!modoLista) {
      if (texto.trim() === '' && !permiteVazio) return;
      onConfirmar(texto.trim());
      return;
    }
    const escolhida = visiveis[indice];
    if (escolhida !== undefined) onConfirmar(escolhida.valor);
  };

  const aoTeclar = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmar();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancelar();
      return;
    }
    if (!modoLista) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => (visiveis.length === 0 ? 0 : (i + 1) % visiveis.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => (visiveis.length === 0 ? 0 : (i - 1 + visiveis.length) % visiveis.length));
    }
  };

  return (
    <Dialog
      open
      onClose={onCancelar}
      maxWidth="sm"
      fullWidth
      // Topo central, como no VS Code — não no meio da tela.
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start', pt: '8vh' } }}
      slotProps={{ paper: { sx: { m: 0 } } }}
    >
      <Box role="dialog" aria-label={titulo ?? placeholder}>
        {titulo !== undefined && (
          <Box sx={{ px: 1.5, pt: 1, color: 'text.secondary', fontSize: 11 }}>{titulo}</Box>
        )}

        <Box sx={{ px: 1.5, py: 1 }}>
          <InputBase
            autoFocus
            fullWidth
            value={texto}
            placeholder={placeholder}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            inputProps={{ 'aria-label': placeholder }}
            sx={{
              fontSize: 13,
              border: 1,
              borderColor: erro === null ? 'primary.main' : 'error.main',
              borderRadius: 0.5,
              px: 1,
              py: 0.5,
            }}
          />
        </Box>

        {erro !== null && (
          <Box sx={{ px: 1.5, pb: 1, color: 'error.main', fontSize: 11 }}>{erro}</Box>
        )}

        {modoLista && (
          <Box ref={listaRef} sx={{ maxHeight: '50vh', overflow: 'auto', pb: 0.5 }}>
            {visiveis.length === 0 ? (
              <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>
                Nada encontrado.
              </Box>
            ) : (
              visiveis.map((opcao, i) => (
                <Box
                  key={opcao.valor}
                  role="option"
                  aria-selected={i === indice}
                  data-selecionado={i === indice}
                  onMouseEnter={() => setIndice(i)}
                  onClick={() => onConfirmar(opcao.valor)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 0.6, cursor: 'pointer', fontSize: 12,
                    bgcolor: i === indice ? 'action.selected' : 'transparent',
                  }}
                >
                  {opcao.icone !== undefined && <Icon name={opcao.icone} size={14} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opcao.rotulo}
                    </Box>
                    {opcao.detalhe !== undefined && (
                      <Box sx={{ color: 'text.secondary', fontSize: 11 }}>{opcao.detalhe}</Box>
                    )}
                  </Box>
                  {opcao.sufixo !== undefined && (
                    <Box sx={{ color: 'text.secondary', fontSize: 11 }}>{opcao.sufixo}</Box>
                  )}
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
