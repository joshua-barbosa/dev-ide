// O painel do botão Ajuda (spec 113, etapa 0). O texto mora em
// `ajudaDoNotebook.ts`; aqui só se desenha, com um "Copiar" por exemplo.
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { secoesDeAjuda, type Exemplo } from './ajudaDoNotebook';
import type { Kernel } from '../../shared/notebook/modelo';

export interface AjudaDoNotebookProps {
  readonly kernel: Kernel;
  onFechar(): void;
  /** Escreve na área de transferência — na extensão, pelo editor quando o navegador nega. */
  copiarTexto(texto: string): Promise<void>;
}

/**
 * A largura do painel. O relato: *"o espaço do helper poderia ser um pouco
 * maior ou ter a opção de ajustar o tamanho, porque fica muito encurtado na
 * lateral"* — mais largo de saída, e a borda esquerda arrasta. Lembrada por
 * navegador (é conveniência; sem armazenamento, volta ao padrão).
 */
const LARGURA_PADRAO = 520;
const LARGURA_MINIMA = 320;
const CHAVE_DA_LARGURA = 'braytech.notebook.ajuda.largura';

function maxima(): number {
  return Math.max(LARGURA_MINIMA, Math.round(window.innerWidth * 0.75));
}

function limitar(largura: number): number {
  return Math.min(maxima(), Math.max(LARGURA_MINIMA, Math.round(largura)));
}

function larguraGuardada(): number {
  try {
    const v = Number(window.localStorage.getItem(CHAVE_DA_LARGURA));
    return Number.isFinite(v) && v > 0 ? limitar(v) : LARGURA_PADRAO;
  } catch {
    return LARGURA_PADRAO;
  }
}

function guardarLargura(largura: number): void {
  try {
    window.localStorage.setItem(CHAVE_DA_LARGURA, String(largura));
  } catch {
    // Sem armazenamento (janela privada, prévia): vale só nesta sessão.
  }
}

const ROTULO: Record<Exemplo['linguagem'], string> = {
  sql: 'SQL', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', php: 'PHP',
};

function BlocoDeExemplo({ exemplo, copiar }: { exemplo: Exemplo; copiar: (t: string) => Promise<void> }) {
  const [estado, setEstado] = useState<'' | 'copiado' | 'falhou'>('');
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.25, fontSize: 10, color: 'text.secondary' }}>
        {ROTULO[exemplo.linguagem]}
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          type="button"
          aria-label={`Copiar exemplo ${ROTULO[exemplo.linguagem]}`}
          onClick={() => {
            copiar(exemplo.codigo).then(() => setEstado('copiado'), () => setEstado('falhou'));
          }}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0, bgcolor: 'transparent',
            cursor: 'pointer', fontSize: 10, color: 'text.secondary', '&:hover': { color: 'text.primary' },
          }}
        >
          <Icon name="lucide:copy" size={11} />
          {estado === 'copiado' ? 'copiado' : estado === 'falhou' ? 'não copiou' : 'Copiar'}
        </Box>
      </Box>
      <Box
        component="pre"
        sx={{ m: 0, px: 1, pb: 0.75, fontFamily: tokens.fontMono, fontSize: 11, whiteSpace: 'pre-wrap', userSelect: 'text' }}
      >
        {exemplo.codigo}
      </Box>
    </Box>
  );
}

export function AjudaDoNotebook({ kernel, onFechar, copiarTexto }: AjudaDoNotebookProps) {
  const [largura, setLargura] = useState(larguraGuardada);

  /** Arrastar a borda esquerda: para a esquerda, alarga. */
  const arrastar = (e: MouseEvent): void => {
    e.preventDefault();
    const inicioX = e.clientX;
    const inicio = largura;
    let atual = inicio;
    const mover = (m: globalThis.MouseEvent): void => {
      atual = limitar(inicio + (inicioX - m.clientX));
      setLargura(atual);
    };
    const soltar = (): void => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      document.body.style.cursor = '';
      guardarLargura(atual);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  };

  /** E pelo teclado: setas de 20 em 20. */
  const teclar = (e: KeyboardEvent): void => {
    const passo = e.key === 'ArrowLeft' ? 20 : e.key === 'ArrowRight' ? -20 : 0;
    if (passo === 0) return;
    e.preventDefault();
    const nova = limitar(largura + passo);
    setLargura(nova);
    guardarLargura(nova);
  };

  return (
    <Box sx={{ display: 'flex', flexShrink: 0, minHeight: 0 }}>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar a largura da ajuda"
        aria-valuenow={largura}
        aria-valuemin={LARGURA_MINIMA}
        tabIndex={0}
        data-alca-da-ajuda
        onMouseDown={arrastar}
        onKeyDown={teclar}
        sx={{
          width: 6, flexShrink: 0, cursor: 'col-resize', borderLeft: 1, borderColor: 'divider',
          '&:hover, &:focus-visible': { bgcolor: 'primary.main', outline: 'none' },
        }}
      />
      <Box
        data-ajuda-do-notebook
        role="complementary"
        aria-label="Ajuda do notebook"
        sx={{
          width: largura, flexShrink: 0, overflow: 'auto',
          px: 2, py: 1.5, fontSize: 12, bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box sx={{ fontWeight: 600, fontSize: 13 }}>Ajuda do notebook</Box>
          <Box sx={{ flex: 1 }} />
          <Box
            component="button"
            type="button"
            aria-label="Fechar a ajuda"
            onClick={onFechar}
            sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.secondary', display: 'inline-flex' }}
          >
            <Icon name="lucide:x" size={14} />
          </Box>
        </Box>
        {secoesDeAjuda(kernel).map((secao) => (
          <Box key={secao.titulo} component="section" sx={{ mb: 2 }}>
            <Box component="h3" sx={{ fontSize: 12, fontWeight: 600, m: 0, mb: 0.5 }}>{secao.titulo}</Box>
            {secao.paragrafos.map((p) => (
              <Box key={p} component="p" sx={{ m: 0, mb: 0.75, color: 'text.secondary', lineHeight: 1.5 }}>{p}</Box>
            ))}
            {secao.exemplos.map((e) => (
              <BlocoDeExemplo key={`${e.linguagem}:${e.codigo}`} exemplo={e} copiar={copiarTexto} />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
