// A aba `Result`: a barra de cima, e a MESMA grade da aba de tabela.
//
// Um só componente para todos os drivers: como `QueryResult` é o mesmo formato
// para SQL, chave-valor e documento, a grade não sabe de qual banco vieram as
// linhas.
//
// **Aqui morava uma segunda grade**, e ele reclamou com razão: *"todo Resultado
// deveria ser igual ao que tem do 'abrir tabela'"*. A daqui não tinha lupa nem
// painel de aparência, e o pior é que eu tinha escrito na spec 068 que o CSV
// ganhava as duas coisas "de graça" — não ganhava, porque elas moravam só na
// outra. Duas telas para a mesma coisa divergem; é só questão de quando.
//
// O que sobrou nesta aba é o que é DELA: a barra com contagem, exportação,
// parada e paginação do resultado. O desenho das células é da `Grade`.
import { useState } from 'react';
import Box from '@mui/material/Box';
import type { QueryResult, TableColumn } from '../../shared/contracts';
import { tokens } from '../theme';
import { Icon } from '../Icon';
import { paraCsv, paraJson } from '../../shared/exportar';
import { Grade } from '../tabela/GradeDaTabela';
import { PainelDeAparencia } from '../tabela/PainelDeAparencia';
import { APARENCIA_PADRAO, type Aparencia } from '../../shared/grade/aparencia';
import { LINHAS_POR_PAGINA } from '../useExecution';

export interface ResultGridProps {
  readonly resultado: QueryResult | null;
  readonly erro?: string | null;
  readonly carregando?: boolean;
  readonly rotulo?: string;
  /** Interrompe a consulta em andamento (T005). */
  readonly parar?: () => void;
  /** Vai para outra página deste resultado (T056). */
  readonly irPara?: (pagina: number) => void;
  readonly pagina?: number;
}

export function ResultGrid({
  resultado, erro = null, carregando = false, rotulo, parar, irPara, pagina = 1,
}: ResultGridProps) {
  // Antes de qualquer `return`: gancho não pode viver depois de saída
  // condicional, e os dois abaixo são exatamente isso.
  const [aparencia, setAparencia] = useState<Aparencia>(APARENCIA_PADRAO);
  const [olho, setOlho] = useState<HTMLElement | null>(null);

  /**
   * As colunas do resultado no formato da grade.
   *
   * Um resultado de query não tem chave primária nem `NOT NULL` — a IDE não
   * sabe de que tabela cada coluna veio, e pode nem ser de uma. Declarar `false`
   * nas duas é o que faz a grade não desenhar o ⚿ nem o `*`, e não é chute: é o
   * que se sabe.
   */
  const colunas: readonly TableColumn[] = (resultado?.columns ?? []).map((c) => ({
    name: c.name,
    type: c.type,
    chave: false,
    obrigatoria: false,
  }));

  if (carregando) {
    return (
      <Box
        sx={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 1.5,
          p: 1.75, color: 'text.secondary', fontSize: 12,
        }}
      >
        <span>executando…</span>
        {parar !== undefined && (
          <Box
            component="button"
            type="button"
            aria-label="Parar esta consulta"
            onClick={parar}
            sx={{
              border: 1, borderColor: 'error.main', bgcolor: 'transparent',
              color: 'error.main', font: 'inherit', fontSize: 11,
              px: 1, py: 0.25, borderRadius: 0.5, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 0.5,
            }}
          >
            <Icon name="lucide:square" size={11} />
            Parar
          </Box>
        )}
      </Box>
    );
  }
  if (erro !== null) return <Mensagem texto={erro} erro />;
  if (resultado === null) return <Mensagem texto="Execute uma consulta para ver o resultado." />;

  const { columns, rows, rowCount, durationMs, truncated, message } = resultado;

  return (
    // `minWidth: 0` pelo mesmo motivo da aba de tabela — ver a nota na spec 062.
    <Box
      data-grade-de-resultado
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minHeight: 0, minWidth: 0, bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.6,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.secondary',
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        <span>
          {rotulo === undefined ? '' : `${rotulo} · `}
          {rowCount} linha(s) · {durationMs}ms
        </span>

        {/* Exportar o RESULTADO inteiro (T058).
            A grade de resultado não pagina: o que está aqui é tudo que a query
            devolveu, então não há escopo a escolher — e é exatamente por isso
            que ele pediu. */}
        <Box
          component="button"
          type="button"
          aria-label="Exportar o resultado em CSV"
          onClick={() =>
            baixar(
              `${(rotulo ?? 'resultado').replace(/[^\w.-]+/g, '-')}.csv`,
              paraCsv(columns, rows)
            )
          }
          sx={BOTAO_DE_EXPORTAR}
        >
          <Icon name="lucide:file-down" size={11} /> CSV
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="Exportar o resultado em JSON"
          onClick={() =>
            baixar(
              `${(rotulo ?? 'resultado').replace(/[^\w.-]+/g, '-')}.json`,
              paraJson(columns, rows)
            )
          }
          sx={BOTAO_DE_EXPORTAR}
        >
          <Icon name="lucide:braces" size={11} /> JSON
        </Box>
        {/* O mesmo `👁` da aba de tabela (spec 070): fonte, altura da linha,
            número da linha, zebra e alinhamento valem para TODO resultado. */}
        <Box
          component="button"
          type="button"
          aria-label="Aparência da grade"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => setOlho(e.currentTarget)}
          sx={BOTAO_DE_EXPORTAR}
        >
          <Icon name="lucide:eye" size={11} />
        </Box>

        {/* Paginação do resultado (T056).
            O TOTAL não aparece, e é de propósito: envolver um `SELECT` qualquer
            num `COUNT(*)` mente quando ele tem `GROUP BY` ou `LIMIT` próprio.
            "Página 2" é verdade; "página 2 de 7" seria chute. */}
        {irPara !== undefined && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              component="button"
              type="button"
              aria-label="Página anterior do resultado"
              disabled={pagina <= 1}
              onClick={() => irPara(pagina - 1)}
              sx={{ ...BOTAO_DE_EXPORTAR, opacity: pagina <= 1 ? 0.35 : 1 }}
            >
              ‹
            </Box>
            <Box data-pagina-do-resultado component="span" sx={{ minWidth: 58, textAlign: 'center' }}>
              página {pagina}
            </Box>
            <Box
              component="button"
              type="button"
              aria-label="Próxima página do resultado"
              disabled={!truncated}
              onClick={() => irPara(pagina + 1)}
              sx={{ ...BOTAO_DE_EXPORTAR, opacity: truncated ? 1 : 0.35 }}
            >
              ›
            </Box>
          </Box>
        )}
        {truncated && irPara === undefined && (
          // Explícito de propósito: confundir o corte com o total real da tabela
          // seria um erro caro.
          <Box component="span" sx={{ color: 'primary.main' }}>
            ⚠ resultado cortado no limite de linhas
          </Box>
        )}
      </Box>

      {columns.length === 0 ? (
        <Mensagem texto={message ?? 'Comando executado.'} />
      ) : (
        // A MESMA grade da aba de tabela (spec 070). O que esta aba não tem —
        // ordenar, filtrar por coluna e editar — não é passado, e por isso não
        // é desenhado: são capacidades, não modos.
        <Grade
          colunas={colunas}
          linhas={rows}
          aparencia={aparencia}
          // O tamanho da PÁGINA, e não quantas linhas vieram: a última página
          // costuma vir curta, e numerar por ela faria a página 2 começar em 4.
          primeiraLinha={(pagina - 1) * LINHAS_POR_PAGINA + 1}
          motivoSemEdicao={
            'Este resultado não está preso a uma tabela: a IDE não sabe qual linha atualizar.'
          }
        />
      )}

      <PainelDeAparencia
        ancora={olho}
        aparencia={aparencia}
        onMudar={setAparencia}
        onFechar={() => setOlho(null)}
        onPadrao={() => setAparencia(APARENCIA_PADRAO)}
      />
    </Box>
  );
}

const BOTAO_DE_EXPORTAR = {
  border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'inherit',
  font: 'inherit', fontSize: 10.5, px: 0.75, py: 0.15, borderRadius: 0.5,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.4,
  '&:hover': { bgcolor: 'action.hover' },
} as const;

/** Entrega o arquivo. `revokeObjectURL` sempre — ver a nota na aba de tabela. */
function baixar(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Mensagem({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 1.75,
        bgcolor: tokens.bgEditor,
        color: erro ? 'error.main' : 'text.secondary',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
