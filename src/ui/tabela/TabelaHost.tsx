// Liga uma ABA de tabela ao gancho que busca as páginas e ao rascunho de
// edição (specs 041 e 044).
//
// Existe como componente próprio porque `useTabela` e `useRascunho` são hooks, e
// hook não pode ser chamado dentro de um `map`. Com uma aba por instância, cada
// uma guarda a sua página, a sua ordenação, os seus filtros e o seu rascunho —
// que é exatamente o que se perderia se elas dividissem um gancho só.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { Api } from '../api';
import { EstruturaPanel } from './EstruturaPanel';
import { useEstrutura } from './useEstrutura';
import { useAlteracoes } from './useAlteracoes';
import type { QuickInputController } from '../useQuickInput';
import { TablePanel } from './TablePanel';
import { useTabela } from './useTabela';
import { chaveDoId, useRascunho } from './useRascunho';
import type { Tab } from '../../shared/tabs';
import type { CellValue } from '../../shared/contracts';

export interface TabelaHostProps {
  readonly aba: Tab;
  readonly onExportar: (conteudo: string, linguagem: string) => void;
  /** Mostra o SQL e espera o sim. Quem desenha o diálogo é o App. */
  readonly onConfirmar: (mensagem: string, titulo: string) => Promise<boolean>;
  /** A conexão é somente-leitura: a edição nem aparece. */
  readonly somenteLeitura: boolean;
  /** A entrada rápida, para as perguntas das alterações (spec 046). */
  readonly qi: QuickInputController;
  /** Abre o comando gerado numa aba de query, amarrada à conexão. */
  readonly abrirComando: (id: string, titulo: string, sql: string) => void;
  readonly onErro: (erro: unknown) => void;
}

export function TabelaHost({
  aba, onExportar, onConfirmar, somenteLeitura, qi, abrirComando, onErro,
}: TabelaHostProps) {
  const meta = aba.meta as {
    connectionId?: string;
    nodePath?: readonly string[];
    database?: string | null;
  };
  const connectionId = meta.connectionId ?? '';
  const nodePath = meta.nodePath ?? [];

  const estado = useTabela({ connectionId, nodePath, database: meta.database ?? null });
  const rascunho = useRascunho();
  const [gravando, setGravando] = useState(false);
  const [subAba, setSubAba] = useState<'dados' | 'estrutura'>('dados');
  const alteracoes = useAlteracoes({
    qi,
    connectionId,
    nodePath,
    database: meta.database ?? null,
    abrirComando,
    somenteLeitura,
  });
  // Só busca quando a sub-aba é aberta: ninguém paga por uma aba que não abriu.
  const estrutura = useEstrutura(connectionId, nodePath, subAba === 'estrutura');

  const colunas = estado.pagina?.columns ?? [];
  const temChave = colunas.some((c) => c.chave);

  /**
   * Por que não dá para editar — texto, e não booleano.
   *
   * "Não responde ao clique" é a pior interface possível. Cada um destes é um
   * motivo diferente, e o usuário precisa saber qual.
   */
  const motivoSemEdicao: string | null = somenteLeitura
    ? 'Esta conexão está marcada como somente-leitura.'
    : estado.modoLivre
      ? 'Em SQL livre a IDE não sabe qual tabela é. Volte ao SQL da tabela para editar.'
      : colunas.length === 0
        ? null
        : temChave
          ? null
          : 'Esta tabela não declara chave primária, então não há como apontar uma linha só.';

  /** Monta o rascunho no formato que o servidor confere. */
  const pedido = () => ({
    nodePath,
    insercoes: rascunho.novas
      .map((l) => l.valores)
      .filter((v) => Object.keys(v).length > 0),
    alteracoes: [...rascunho.alteracoes].map(([id, celulas]) => ({
      chave: chaveDoId(id),
      antes: Object.fromEntries(
        Object.entries(celulas).map(([c, v]) => [c, v.antes])
      ) as Record<string, CellValue>,
      depois: Object.fromEntries(
        Object.entries(celulas).map(([c, v]) => [c, v.depois])
      ) as Record<string, CellValue>,
    })),
    remocoes: [...rascunho.remocoes].map((id) => ({ chave: chaveDoId(id) })),
  });

  const gravar = async (): Promise<void> => {
    setGravando(true);
    try {
      // Prévia primeiro: o usuário LÊ o SQL antes de ele rodar. É a mesma
      // decisão da spec 040, e aqui ela pesa mais — isto escreve.
      const previa = await Api.writeTable(connectionId, { ...pedido(), simular: true });
      const sql = previa.comandos
        .map((c) => `${c.sql};${c.params.length === 0 ? '' : `\n-- valores: ${JSON.stringify(c.params)}`}`)
        .join('\n\n');

      const ok = await onConfirmar(
        `Vai rodar ${previa.comandos.length} comando(s) em ${aba.title}:\n\n${sql}`,
        'Gravar alterações'
      );
      if (!ok) return;

      await Api.writeTable(connectionId, pedido());
      rascunho.descartar();
      // O que está na tela passa a ser o que está no banco.
      estado.recarregar();
    } finally {
      setGravando(false);
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <SubAbas ativa={subAba} onTrocar={setSubAba} />

      {/* As duas ficam MONTADAS: trocar de sub-aba não pode custar outra ida ao
          banco nem apagar página, filtros e rascunho. É a regra constitucional
          do editor e do terminal, aplicada aqui. */}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: subAba === 'dados' ? 'flex' : 'none' }}>
        <TablePanel
      estado={estado}
      titulo={aba.title}
      onExportar={onExportar}
      rascunho={somenteLeitura ? undefined : rascunho}
      gravando={gravando}
      onGravar={somenteLeitura ? undefined : () => void gravar()}
          motivoSemEdicao={motivoSemEdicao}
          connectionId={connectionId}
          nodePath={nodePath}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: subAba === 'estrutura' ? 'flex' : 'none' }}>
        <EstruturaPanel
          estrutura={estrutura.estrutura}
          carregando={estrutura.carregando}
          erro={estrutura.erro}
          onRecarregar={estrutura.recarregar}
          permitidas={alteracoes.permitidas}
          onAlterar={(tipo, ctx) => void alteracoes.executar(tipo, ctx).catch(onErro)}
        />
      </Box>
    </Box>
  );
}

/** As duas metades da aba de tabela: os dados e a estrutura (spec 045). */
function SubAbas({
  ativa, onTrocar,
}: {
  readonly ativa: 'dados' | 'estrutura';
  readonly onTrocar: (a: 'dados' | 'estrutura') => void;
}) {
  return (
    <Box
      role="tablist"
      aria-label="Partes da tabela"
      sx={{
        display: 'flex', gap: 0.5, px: 1, borderBottom: 1, borderColor: 'divider',
        bgcolor: 'background.paper', flexShrink: 0,
      }}
    >
      {(['dados', 'estrutura'] as const).map((a) => (
        <Box
          key={a}
          component="button"
          role="tab"
          aria-selected={ativa === a}
          onClick={() => onTrocar(a)}
          sx={{
            border: 0, borderBottom: 2,
            borderColor: ativa === a ? 'primary.main' : 'transparent',
            bgcolor: 'transparent', color: ativa === a ? 'text.primary' : 'text.secondary',
            font: 'inherit', fontSize: 11.5, px: 1, py: 0.5, cursor: 'pointer',
            textTransform: 'capitalize',
          }}
        >
          {a}
        </Box>
      ))}
    </Box>
  );
}
