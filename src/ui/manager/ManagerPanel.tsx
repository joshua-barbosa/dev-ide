// A aba `Manager` do banco: Dashboard, Log e Structure Sync (T070).
//
// Ele pediu os três com todas as letras. São coisas diferentes, e o que as une
// é o lugar — por isso são divisórias de uma aba só, e não três abas soltas
// disputando espaço na barra.
//
// **Tudo aqui é leitura.** O Structure Sync mostra o SQL e oferece abri-lo no
// editor; quem executa é ele, quando quiser. Aplicar no mesmo clique seria a
// IDE mudando o banco por conta própria — e é assim que esse tipo de ferramenta
// costuma estragar o dia de alguém.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { Api } from '../api';
import { compararEstruturas } from '../../shared/sql/manager';
import type {
  DiferencaDeEstrutura, LinhaDeLog, MetricaDoBanco,
} from '../../shared/sql/manager';

export type DivisoriaDoManager = 'dashboard' | 'log' | 'sync';

const DIVISORIAS: readonly { id: DivisoriaDoManager; rotulo: string; icone: string }[] = [
  { id: 'dashboard', rotulo: 'Dashboard', icone: 'lucide:gauge' },
  { id: 'log', rotulo: 'Log', icone: 'lucide:scroll-text' },
  { id: 'sync', rotulo: 'Structure Sync', icone: 'lucide:git-compare' },
];

export interface ManagerPanelProps {
  readonly conexaoId: string;
  /**
   * O painel está à VISTA?
   *
   * Ele fica montado quando some (emenda constitucional), e sem esta marca o
   * Dashboard media na montagem — inclusive numa aba que ninguém abriu. Num
   * SQLite isso ainda punha um diálogo de erro na frente da tela.
   */
  readonly ativo: boolean;
  /** Os bancos desta conexão, para o Structure Sync escolher os dois lados. */
  readonly bancos: readonly string[];
  /** Abre o SQL gerado numa aba do editor — é lá que ele decide se roda. */
  onAbrirSql(titulo: string, sql: string): void;
  onErro(erro: unknown): void;
}

export function ManagerPanel({
  conexaoId, ativo, bancos, onAbrirSql, onErro,
}: ManagerPanelProps) {
  const [ativa, setAtiva] = useState<DivisoriaDoManager>('dashboard');

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex', gap: 0.25, px: 0.5, borderBottom: 1, borderColor: 'divider',
          bgcolor: 'background.paper', flexShrink: 0,
        }}
      >
        {DIVISORIAS.map((d) => (
          <Box
            key={d.id}
            component="button"
            type="button"
            data-divisoria={d.id}
            aria-selected={ativa === d.id}
            onClick={() => setAtiva(d.id)}
            sx={{
              border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit',
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.6, fontSize: 11.5,
              color: ativa === d.id ? 'text.primary' : 'text.secondary',
              borderBottom: 2, borderColor: ativa === d.id ? 'primary.main' : 'transparent',
            }}
          >
            <Icon name={d.icone} size={13} />
            {d.rotulo}
          </Box>
        ))}
      </Box>

      {/*
        Esconder com `display: none`, nunca desmontar — a emenda constitucional.
        O Structure Sync guarda uma comparação que custou duas varreduras do
        banco; trocar de divisória não pode jogá-la fora.
      */}
      <Box sx={{ flex: 1, minHeight: 0, display: ativa === 'dashboard' ? 'flex' : 'none' }}>
        <Dashboard conexaoId={conexaoId} ativo={ativo && ativa === 'dashboard'} onErro={onErro} />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: ativa === 'log' ? 'flex' : 'none' }}>
        <Log conexaoId={conexaoId} ativo={ativo && ativa === 'log'} onErro={onErro} />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: ativa === 'sync' ? 'flex' : 'none' }}>
        <StructureSync
          conexaoId={conexaoId}
          bancos={bancos}
          onAbrirSql={onAbrirSql}
          onErro={onErro}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({
  conexaoId, ativo, onErro,
}: {
  readonly conexaoId: string;
  readonly ativo: boolean;
  onErro(erro: unknown): void;
}) {
  const [metricas, setMetricas] = useState<readonly MetricaDoBanco[]>([]);
  /** `true` quando o banco não é um servidor — SQLite é um arquivo. */
  const [semServidor, setSemServidor] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    // Só mede quando está à vista: um painel escondido medindo um banco de
    // produção é ruído que a IDE criaria sozinha. Mesma regra do Monitor.
    if (!ativo) return;
    let vivo = true;
    Api.managerMetrics(conexaoId)
      .then((m) => {
        if (!vivo) return;
        setSemServidor(m === null);
        setMetricas(m ?? []);
      })
      .catch(onErro);
    return () => {
      vivo = false;
    };
  }, [conexaoId, ativo, versao, onErro]);

  const grupos = [...new Set(metricas.map((m) => m.grupo))];

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, bgcolor: tokens.bgEditor }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <Box
          component="button"
          type="button"
          aria-label="Recarregar os números"
          onClick={() => setVersao((v) => v + 1)}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer',
            display: 'flex', p: 0.4, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name="lucide:refresh-cw" size={13} />
        </Box>
      </Box>

      {grupos.map((grupo) => (
        <Box key={grupo} sx={{ mb: 2 }}>
          <Box
            sx={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
              color: 'text.secondary', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 0.75,
            }}
          >
            {grupo}
          </Box>
          {metricas
            .filter((m) => m.grupo === grupo)
            .map((m) => (
              <Box
                key={m.nome}
                data-metrica={m.nome}
                sx={{
                  display: 'flex', alignItems: 'baseline', gap: 1, py: 0.3,
                  fontSize: 12, borderBottom: 1, borderColor: 'divider',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {m.nome}
                  {m.ajuda !== undefined && (
                    <Tooltip title={m.ajuda} placement="right">
                      <Box component="span" sx={{ ml: 0.5, color: 'text.secondary' }}>
                        <Icon name="lucide:circle-help" size={11} />
                      </Box>
                    </Tooltip>
                  )}
                </Box>
                <Box sx={{ fontFamily: tokens.fontMono, fontSize: 11.5 }}>{m.valor}</Box>
              </Box>
            ))}
        </Box>
      ))}

      {semServidor ? (
        <Box sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.7, maxWidth: 620 }}>
          Este banco não é um servidor — é um arquivo. Não há conexões, cache nem
          uptime para medir.
        </Box>
      ) : (
        metricas.length === 0 && (
          <Box sx={{ color: 'text.secondary', fontSize: 12 }}>medindo…</Box>
        )
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const COR_DO_NIVEL: Readonly<Record<LinhaDeLog['nivel'], string>> = {
  erro: 'error.main',
  aviso: 'warning.main',
  nota: 'text.secondary',
  outro: 'text.primary',
};

function Log({
  conexaoId, ativo, onErro,
}: {
  readonly conexaoId: string;
  readonly ativo: boolean;
  onErro(erro: unknown): void;
}) {
  const [linhas, setLinhas] = useState<readonly LinhaDeLog[] | null>(null);
  const [semLog, setSemLog] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    Api.managerLog(conexaoId)
      .then((l) => {
        if (!vivo) return;
        // `null` é "este banco não expõe o log por SQL" — diferente de lista
        // vazia, que seria "não há linhas". A tela diz qual dos dois é.
        setSemLog(l === null);
        setLinhas(l);
      })
      .catch(onErro);
    return () => {
      vivo = false;
    };
  }, [conexaoId, ativo, versao, onErro]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5,
          borderBottom: 1, borderColor: 'divider', fontSize: 11, color: 'text.secondary',
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label="Recarregar o log"
          onClick={() => setVersao((v) => v + 1)}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', cursor: 'pointer',
            display: 'flex', p: 0.4, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name="lucide:refresh-cw" size={13} />
        </Box>
        <Box data-total-log>{linhas === null ? '' : `${linhas.length} linha(s)`}</Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: semLog ? 1.5 : 0, bgcolor: tokens.bgEditor }}>
        {semLog ? (
          <Box sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.7, maxWidth: 620 }}>
            Este servidor não expõe o log por SQL — ele grava em arquivo, e não há
            consulta que o leia.
            <br />
            <br />
            No MySQL, <code>log_output = TABLE</code> põe o log lento em{' '}
            <code>mysql.slow_log</code> e ele aparece aqui. Em qualquer um dos dois,
            o arquivo se lê pela aba do servidor, por SSH.
          </Box>
        ) : (
          (linhas ?? []).map((l, i) => (
            <Box
              key={`${l.quando ?? ''}-${i}`}
              data-linha-log={l.nivel}
              sx={{
                display: 'flex', gap: 1, px: 1.25, py: '2px',
                fontFamily: tokens.fontMono, fontSize: 11,
                borderBottom: 1, borderColor: 'divider',
              }}
            >
              <Box sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{l.quando ?? ''}</Box>
              <Box sx={{ color: COR_DO_NIVEL[l.nivel], whiteSpace: 'nowrap', width: 48 }}>
                {l.nivel}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{l.texto}</Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Structure Sync
// ---------------------------------------------------------------------------

function StructureSync({
  conexaoId, bancos, onAbrirSql, onErro,
}: {
  readonly conexaoId: string;
  readonly bancos: readonly string[];
  onAbrirSql(titulo: string, sql: string): void;
  onErro(erro: unknown): void;
}) {
  const [origem, setOrigem] = useState(bancos[0] ?? '');
  const [destino, setDestino] = useState(bancos[1] ?? bancos[0] ?? '');
  const [diferencas, setDiferencas] = useState<readonly DiferencaDeEstrutura[] | null>(null);
  const [comparando, setComparando] = useState(false);

  const comparar = useCallback(async () => {
    if (origem === '' || destino === '' || origem === destino) return;
    setComparando(true);
    try {
      // Os dois retratos em paralelo: são leituras independentes, e uma de cada
      // vez dobraria a espera sem ganho nenhum.
      const [a, b] = await Promise.all([
        Api.managerStructure(conexaoId, origem),
        Api.managerStructure(conexaoId, destino),
      ]);
      setDiferencas(compararEstruturas(a, b));
    } catch (e) {
      onErro(e);
    } finally {
      setComparando(false);
    }
  }, [conexaoId, origem, destino, onErro]);

  /** Todo o SQL das diferenças que TÊM comando, na ordem em que aparecem. */
  const sqlCompleto = (diferencas ?? [])
    .map((d) => d.sql)
    .filter((s) => s !== '')
    .join('\n\n');

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.6,
          borderBottom: 1, borderColor: 'divider', fontSize: 11.5, flexWrap: 'wrap',
        }}
      >
        <Box component="span" sx={{ color: 'text.secondary' }}>
          igualar
        </Box>
        <Seletor valor={destino} opcoes={bancos} aoMudar={setDestino} marca="destino" />
        <Box component="span" sx={{ color: 'text.secondary' }}>
          a
        </Box>
        <Seletor valor={origem} opcoes={bancos} aoMudar={setOrigem} marca="origem" />
        <Box
          component="button"
          type="button"
          data-comparar
          disabled={origem === destino || comparando}
          onClick={() => void comparar()}
          sx={{
            border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'inherit',
            font: 'inherit', fontSize: 11.5, px: 1, py: '2px', borderRadius: 0.5,
            cursor: origem === destino ? 'not-allowed' : 'pointer',
            opacity: origem === destino ? 0.5 : 1,
          }}
        >
          {comparando ? 'comparando…' : 'Comparar'}
        </Box>
        {sqlCompleto !== '' && (
          <Box
            component="button"
            type="button"
            data-abrir-sql
            onClick={() => onAbrirSql(`sync-${destino}.sql`, sqlCompleto)}
            sx={{
              border: 1, borderColor: 'primary.main', bgcolor: 'transparent',
              color: 'primary.main', font: 'inherit', fontSize: 11.5, px: 1, py: '2px',
              borderRadius: 0.5, cursor: 'pointer', ml: 'auto',
            }}
          >
            Abrir o SQL no editor
          </Box>
        )}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', bgcolor: tokens.bgEditor }}>
        {diferencas === null ? (
          <Box sx={{ p: 1.5, fontSize: 12, color: 'text.secondary', lineHeight: 1.7, maxWidth: 620 }}>
            Escolha dois bancos e compare. A IDE mostra o que falta no destino e
            escreve o SQL — <b>ela não executa nada</b>: o comando vai para o
            editor, e você decide.
          </Box>
        ) : diferencas.length === 0 ? (
          <Box sx={{ p: 1.5, fontSize: 12, color: 'success.main' }}>
            As duas estruturas estão iguais.
          </Box>
        ) : (
          diferencas.map((d) => (
            <Box
              key={`${d.tipo}-${d.objeto}-${d.lado}`}
              data-diferenca={d.objeto}
              sx={{ px: 1.25, py: 0.6, borderBottom: 1, borderColor: 'divider', fontSize: 11.5 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Box sx={{ fontFamily: tokens.fontMono }}>{d.objeto}</Box>
                <Box sx={{ fontSize: 10.5, color: 'text.secondary' }}>{d.lado}</Box>
                <Box sx={{ fontSize: 10.5, color: 'text.secondary', ml: 'auto' }}>{d.detalhe}</Box>
              </Box>
              {d.sql === '' ? (
                <Box sx={{ mt: 0.4, fontSize: 10.5, color: 'warning.main' }}>
                  {/* Ver a nota em `shared/sql/manager.ts`: apagar não se gera. */}
                  A IDE não escreve o comando que apagaria isto — se for para
                  remover, o comando é seu.
                </Box>
              ) : (
                <Box
                  component="pre"
                  sx={{
                    m: 0, mt: 0.4, fontFamily: tokens.fontMono, fontSize: 10.5,
                    color: 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {d.sql}
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

function Seletor({
  valor, opcoes, aoMudar, marca,
}: {
  readonly valor: string;
  readonly opcoes: readonly string[];
  aoMudar(v: string): void;
  readonly marca: string;
}) {
  return (
    <Box
      component="select"
      data-banco={marca}
      aria-label={marca}
      value={valor}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => aoMudar(e.target.value)}
      sx={{
        bgcolor: 'transparent', color: 'inherit', font: 'inherit', fontSize: 11.5,
        border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.5, py: '1px',
      }}
    >
      {opcoes.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Box>
  );
}
