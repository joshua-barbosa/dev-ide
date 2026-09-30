// Uma célula do notebook: código do kernel, SQL ou Markdown (spec 112).
//
// O editor é o `BlocoDeCodigo` do sqlbook — cor enquanto se lê, Monaco quando
// ganha foco. Reaproveitado SEM alteração: o notebook é feature separada, mas
// a peça que edita um bloco é a mesma, e duas cópias dela divergiriam.
//
// Toda célula que roda tem ▷ (e `Ctrl+Enter`); Markdown não roda, só se lê.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { BlocoDeCodigo } from '../caderno/BlocoDeCodigo';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import { SaidasDaCelula } from './SaidasDaCelula';
import type { NomeDoTema } from '../../shared/temas';
import {
  nomeValido, type Celula, type Kernel, type MudancaDeCelula, type TipoDeCelula,
} from '../../shared/notebook/modelo';

export interface CelulaDoNotebookProps {
  readonly celula: Celula;
  readonly kernel: Kernel;
  readonly rodando: boolean;
  /** O rótulo da conexão que ESTA célula usa (a dela, ou a do notebook). */
  readonly rotuloDaConexao: string;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onMudar(mudanca: MudancaDeCelula): void;
  onRodar(): void;
  /** A cascata: esta célula e todas abaixo, parando no primeiro erro. */
  onRodarDesde(): void;
  onEscolherConexao(): void;
  onUsarConexaoDoNotebook(): void;
  onLimparSaida(): void;
  onMover(direcao: -1 | 1): void;
  onRemover(): void;
}

const ROTULO_DO_KERNEL: Record<Kernel, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', php: 'PHP',
};

function Botao({
  icone, rotulo, onClick, destaque = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly destaque?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0, px: 0.75, py: 0.25,
        borderRadius: 0.5, cursor: 'pointer', fontSize: 11, bgcolor: 'transparent',
        color: destaque ? 'primary.main' : 'text.secondary',
        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
      }}
    >
      <Icon name={icone} size={13} />
    </Box>
  );
}

export function CelulaDoNotebook(p: CelulaDoNotebookProps) {
  const { celula } = p;
  // Markdown se lê renderizado; editar é um gesto (dois cliques), como no Jupyter.
  const [editandoMarkdown, setEditandoMarkdown] = useState(celula.conteudo === '');
  const [nome, setNome] = useState(celula.nome ?? '');
  const nomeRuim = celula.tipo === 'sql' && !nomeValido(nome);

  const linguagem = celula.tipo === 'codigo' ? p.kernel : celula.tipo;
  const tipos: readonly (readonly [TipoDeCelula, string])[] = [
    ['codigo', ROTULO_DO_KERNEL[p.kernel]], ['sql', 'SQL'], ['markdown', 'Markdown'],
  ];

  return (
    <Box
      data-celula={celula.id}
      data-tipo={celula.tipo}
      sx={{
        border: 1, borderColor: p.rodando ? 'primary.main' : 'divider', borderRadius: 1,
        bgcolor: 'background.paper', overflow: 'hidden',
        '& [data-administra]': { opacity: 0 },
        '&:hover [data-administra], &:focus-within [data-administra]': { opacity: 1 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, fontSize: 11 }}>
        {/* O `[3]` do Jupyter: mostra em que ordem as células rodaram. */}
        <Box sx={{ fontFamily: tokens.fontMono, color: 'text.secondary', minWidth: 30 }}>
          {celula.tipo === 'markdown' ? '' : `[${p.rodando ? '*' : (celula.contador ?? ' ')}]`}
        </Box>

        {celula.tipo !== 'markdown' && (
          <Botao icone="lucide:play" rotulo="▷ Rodar célula" destaque onClick={p.onRodar} />
        )}

        <Box role="radiogroup" aria-label="Tipo da célula" sx={{ display: 'flex', gap: 0.25 }}>
          {tipos.map(([valor, rotulo]) => (
            <Box
              key={valor}
              component="button"
              type="button"
              role="radio"
              aria-checked={celula.tipo === valor}
              onClick={() => p.onMudar({ tipo: valor })}
              sx={{
                border: 0, px: 0.75, py: 0.25, borderRadius: 0.5, cursor: 'pointer', fontSize: 11,
                bgcolor: celula.tipo === valor ? 'action.selected' : 'transparent',
                color: celula.tipo === valor ? 'text.primary' : 'text.secondary',
              }}
            >
              {rotulo}
            </Box>
          ))}
        </Box>

        {celula.tipo === 'sql' && (
          <>
            <Box sx={{ color: 'text.secondary', ml: 1 }}>→</Box>
            <Box
              component="input"
              aria-label="Nome do resultado"
              title="O resultado vira uma variável com este nome no kernel"
              value={nome}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNome(e.target.value);
                if (nomeValido(e.target.value)) p.onMudar({ nome: e.target.value });
              }}
              sx={{
                width: 120, fontFamily: tokens.fontMono, fontSize: 11, px: 0.5, py: 0.25,
                border: 1, borderRadius: 0.5, bgcolor: 'transparent', color: 'text.primary',
                borderColor: nomeRuim ? 'error.main' : 'divider',
              }}
            />
            <Box
              component="button"
              type="button"
              aria-label="Conexão desta célula"
              title="Trocar a conexão só desta célula"
              onClick={p.onEscolherConexao}
              sx={{
                border: 0, bgcolor: 'transparent', cursor: 'pointer', fontSize: 11,
                color: celula.conexao === null ? 'text.secondary' : 'warning.main',
              }}
            >
              {p.rotuloDaConexao}
            </Box>
            {celula.conexao !== null && (
              <Botao icone="lucide:rotate-ccw" rotulo="Voltar à conexão do notebook" onClick={p.onUsarConexaoDoNotebook} />
            )}
          </>
        )}

        <Box sx={{ flex: 1 }} />
        <Box data-administra sx={{ display: 'flex', gap: 0.25, transition: 'opacity 120ms' }}>
          {celula.saidas.length > 0 && (
            <Botao icone="lucide:eraser" rotulo="Limpar a saída desta célula" onClick={p.onLimparSaida} />
          )}
          <Botao icone="lucide:chevrons-down" rotulo="Rodar daqui para baixo" onClick={p.onRodarDesde} />
          <Botao icone="lucide:chevron-up" rotulo="Subir a célula" onClick={() => p.onMover(-1)} />
          <Botao icone="lucide:chevron-down" rotulo="Descer a célula" onClick={() => p.onMover(1)} />
          <Botao icone="lucide:trash-2" rotulo="Apagar a célula" onClick={p.onRemover} />
        </Box>
      </Box>

      {nomeRuim && (
        <Box sx={{ px: 1.5, pb: 0.5, fontSize: 11, color: 'error.main' }}>
          Nome inválido: use letras, números e _, começando por letra — é o nome da variável no kernel.
        </Box>
      )}

      {celula.tipo === 'markdown' && !editandoMarkdown ? (
        <Box
          data-markdown-renderizado
          onDoubleClick={() => setEditandoMarkdown(true)}
          title="Dois cliques para editar"
          sx={{ px: 2, py: 1, cursor: 'text' }}
        >
          <MarkdownPreview fonte={celula.conteudo} />
        </Box>
      ) : celula.tipo === 'markdown' ? (
        // Markdown se EDITA num `textarea`, como no sqlbook — não no Monaco.
        // Com o Monaco, voltar ao renderizado desmontava o editor de dentro do
        // próprio atalho dele ("Model is disposed!", visto pela guarda).
        <Box
          component="textarea"
          aria-label="Célula Markdown"
          autoFocus
          spellCheck={false}
          value={celula.conteudo}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => p.onMudar({ conteudo: e.target.value })}
          onBlur={() => setEditandoMarkdown(celula.conteudo.trim() === '')}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              setEditandoMarkdown(false);
            }
          }}
          rows={Math.min(20, Math.max(3, celula.conteudo.split('\n').length + 1))}
          sx={{
            display: 'block', width: '100%', border: 0, outline: 'none', resize: 'vertical',
            px: 2, py: 1, bgcolor: 'transparent', color: 'text.primary',
            fontFamily: tokens.fontMono, fontSize: p.fontSize,
          }}
        />
      ) : (
        <BlocoDeCodigo
          id={celula.id}
          conteudo={celula.conteudo}
          linguagem={linguagem}
          rotulo={`Célula ${celula.tipo === 'codigo' ? ROTULO_DO_KERNEL[p.kernel] : 'SQL'}`}
          fontSize={p.fontSize}
          tabSize={p.tabSize}
          tema={p.tema}
          onAlterar={(conteudo) => p.onMudar({ conteudo })}
          onAtalhoDeRodar={p.onRodar}
          onFocar={() => undefined}
        />
      )}

      <SaidasDaCelula saidas={celula.saidas} />
    </Box>
  );
}
