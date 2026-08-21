// O Query Book (spec 048).
//
// Uma segunda superfície de editor: blocos de SQL e de markdown, cada um com o
// seu `Run`. O que isso resolve e um `.sql` não é **investigação com
// narrativa** — nos cadernos do usuário (`1070`, `Chamado #123`, `Erros`)
// cada arquivo é a reconstituição de um problema, e o que explica cada consulta
// merece ser texto que se lê, não comentário.
//
// Os blocos são `textarea`, e não Monaco, pela mesma razão da spec 043 — e aqui
// pesa mais: um caderno tem dezenas de blocos, e dezenas de instâncias de editor
// não se justificam.
import { useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import type { Caderno, Celula, TipoDeCelula } from '../../shared/sql/caderno';

export interface CadernoPanelProps {
  readonly caderno: Caderno;
  /** O que o `Run All` está fazendo agora, ou `null`. */
  readonly rodando: string | null;
  readonly erro: string | null;
  onAlterar(id: string, conteudo: string): void;
  onAcrescentar(tipo: TipoDeCelula, depoisDe: number): void;
  onRemover(id: string): void;
  onMover(id: string, direcao: -1 | 1): void;
  onRodar(celula: Celula, modo: 'run' | 'tab' | 'json'): void;
  onRodarTudo(): void;
}

export function CadernoPanel({
  caderno, rodando, erro, onAlterar, onAcrescentar, onRemover, onMover, onRodar, onRodarTudo,
}: CadernoPanelProps) {
  const [atual, setAtual] = useState(0);

  return (
    <Box
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
        bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
          fontSize: 11, color: 'text.secondary', flexShrink: 0,
        }}
      >
        <Acao rotulo="Add Code" onClick={() => onAcrescentar('sql', -1)} />
        <Acao rotulo="Add Markdown" onClick={() => onAcrescentar('markdown', -1)} />
        <Box component="span" sx={{ opacity: 0.4 }}>|</Box>
        <Acao
          rotulo={rodando === null ? 'Run All' : 'rodando…'}
          onClick={onRodarTudo}
          desabilitada={rodando !== null}
        />
        <Box sx={{ flex: 1 }} />
        <Box component="span" data-contagem-de-celulas>
          {caderno.celulas.length === 0
            ? 'caderno vazio'
            : `Bloco ${Math.min(atual + 1, caderno.celulas.length)} de ${caderno.celulas.length}`}
        </Box>
      </Box>

      {erro !== null && (
        <Box
          data-erro-caderno
          sx={{
            px: 1.25, py: 0.5, bgcolor: 'error.main', color: 'background.default',
            fontFamily: tokens.fontMono, fontSize: 11, flexShrink: 0,
          }}
        >
          {erro}
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, p: 1 }}>
        {caderno.celulas.length === 0 ? (
          <Box sx={{ p: 1.75, color: 'text.secondary', fontSize: 12 }}>
            Caderno vazio. Comece com <strong>Add Code</strong> ou{' '}
            <strong>Add Markdown</strong>.
          </Box>
        ) : (
          caderno.celulas.map((celula, i) => (
            <Bloco
              key={celula.id}
              celula={celula}
              indice={i}
              total={caderno.celulas.length}
              rodando={rodando === celula.id}
              onFocar={() => setAtual(i)}
              onAlterar={onAlterar}
              onAcrescentar={onAcrescentar}
              onRemover={onRemover}
              onMover={onMover}
              onRodar={onRodar}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function Bloco({
  celula, indice, total, rodando, onFocar, onAlterar, onAcrescentar, onRemover, onMover, onRodar,
}: {
  readonly celula: Celula;
  readonly indice: number;
  readonly total: number;
  readonly rodando: boolean;
  onFocar(): void;
  onAlterar(id: string, conteudo: string): void;
  onAcrescentar(tipo: TipoDeCelula, depoisDe: number): void;
  onRemover(id: string): void;
  onMover(id: string, direcao: -1 | 1): void;
  onRodar(celula: Celula, modo: 'run' | 'tab' | 'json'): void;
}) {
  // Markdown nasce mostrando o texto quando está vazio, e renderizado quando
  // tem conteúdo: um bloco novo é para escrever, um antigo é para ler.
  const [editando, setEditando] = useState(celula.conteudo.trim() === '');
  const ehSql = celula.tipo === 'sql';

  return (
    <Box
      data-bloco={celula.id}
      data-tipo={celula.tipo}
      onFocus={onFocar}
      sx={{
        mb: 1, border: 1, borderColor: rodando ? 'primary.main' : 'divider', borderRadius: 0.5,
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25,
          borderBottom: 1, borderColor: 'divider', fontSize: 10, color: 'text.secondary',
        }}
      >
        {ehSql ? (
          <>
            <Acao rotulo="▷ Run" onClick={() => onRodar(celula, 'run')} />
            <Acao rotulo="＋Tab" onClick={() => onRodar(celula, 'tab')} />
            <Acao rotulo="JSON" onClick={() => onRodar(celula, 'json')} />
          </>
        ) : (
          <Acao
            rotulo={editando ? 'Ver renderizado' : 'Editar'}
            onClick={() => setEditando((v) => !v)}
          />
        )}

        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ opacity: 0.6 }}>
          {celula.tipo}
        </Box>
        <BotaoDeIcone
          icone="lucide:chevron-up"
          rotulo={`Mover o bloco ${indice + 1} para cima`}
          desabilitada={indice === 0}
          onClick={() => onMover(celula.id, -1)}
        />
        <BotaoDeIcone
          icone="lucide:chevron-down"
          rotulo={`Mover o bloco ${indice + 1} para baixo`}
          desabilitada={indice === total - 1}
          onClick={() => onMover(celula.id, 1)}
        />
        <BotaoDeIcone
          icone="lucide:plus"
          rotulo={`Acrescentar bloco depois do ${indice + 1}`}
          onClick={() => onAcrescentar(celula.tipo, indice)}
        />
        <BotaoDeIcone
          icone="lucide:trash-2"
          rotulo={`Apagar o bloco ${indice + 1}`}
          onClick={() => onRemover(celula.id)}
        />
      </Box>

      {!ehSql && !editando ? (
        // Clicar no renderizado volta a editar: é o gesto que se espera de um
        // caderno, e evita ter que mirar no botão.
        <Box onClick={() => setEditando(true)} sx={{ cursor: 'text' }}>
          <MarkdownPreview fonte={celula.conteudo} />
        </Box>
      ) : (
        <Box
          component="textarea"
          data-conteudo={celula.id}
          aria-label={`Bloco ${indice + 1} (${celula.tipo})`}
          spellCheck={false}
          value={celula.conteudo}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onAlterar(celula.id, e.target.value)
          }
          onKeyDown={(e: React.KeyboardEvent) => {
            // `Ctrl+Enter` roda este bloco — o mesmo gesto do editor de query.
            if (ehSql && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRodar(celula, 'run');
            }
          }}
          rows={Math.min(20, Math.max(3, celula.conteudo.split('\n').length + 1))}
          sx={{
            width: '100%', border: 0, outline: 'none', resize: 'vertical',
            bgcolor: 'transparent', color: 'text.primary', p: 1,
            fontFamily: tokens.fontMono, fontSize: 12, lineHeight: 1.5,
          }}
        />
      )}
    </Box>
  );
}

/** Ação em texto, como as da aba de estrutura. */
function Acao({
  rotulo, onClick, desabilitada = false,
}: {
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      disabled={desabilitada}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', color: desabilitada ? 'text.disabled' : 'primary.main',
        font: 'inherit', fontSize: 10.5, px: 0.5,
        cursor: desabilitada ? 'default' : 'pointer',
      }}
    >
      {rotulo}
    </Box>
  );
}

function BotaoDeIcone({
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
            border: 0, bgcolor: 'transparent', color: 'inherit', p: 0.25, borderRadius: 0.5,
            display: 'flex', cursor: desabilitada ? 'default' : 'pointer',
            opacity: desabilitada ? 0.3 : 1,
            '&:hover': { bgcolor: desabilitada ? 'transparent' : 'action.hover' },
          }}
        >
          <Icon name={icone} size={12} />
        </Box>
      </Box>
    </Tooltip>
  );
}
