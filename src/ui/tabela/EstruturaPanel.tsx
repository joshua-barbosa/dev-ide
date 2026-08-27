// A sub-aba `Estrutura` da aba de tabela (spec 045).
//
// Seis listas, uma por sub-sub-aba, todas vindas de UM pedido ao servidor.
// Nada aqui escreve — mexer na estrutura é a spec 046.
//
// A distinção que mais importa nesta tela: **lista vazia** e **"este banco não
// sabe responder"** são coisas diferentes, e aparecem diferentes. Mostrar as
// duas como "nenhum" seria dizer que uma tabela não tem gatilho quando o que
// acontece é que a IDE não sabe perguntar.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import type {
  ChaveEstrangeira,
  ChecagemDaTabela,
  ColunaDetalhada,
  GatilhoDaTabela,
  IndiceDaTabela,
  ListaOuNaoSei,
  TableStructure,
} from '../../shared/contracts';

export interface EstruturaPanelProps {
  readonly estrutura: TableStructure | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly onRecarregar: () => void;
  /** O que este banco sabe alterar (spec 046). Vazio = aba só de leitura. */
  readonly permitidas?: ReadonlySet<string>;
  readonly onAlterar?: (tipo: string, ctx?: Record<string, unknown>) => void;
}

type Sessao = 'ddl' | 'colunas' | 'fks' | 'indices' | 'gatilhos' | 'checagens';

const ROTULOS: Record<Sessao, string> = {
  ddl: 'DDL',
  colunas: 'Colunas',
  fks: 'Chaves estrangeiras',
  indices: 'Índices',
  gatilhos: 'Gatilhos',
  checagens: 'Checagens',
};

export function EstruturaPanel({
  estrutura, carregando, erro, onRecarregar, permitidas, onAlterar,
}: EstruturaPanelProps) {
  const [sessao, setSessao] = useState<Sessao>('colunas');

  if (erro !== null) return <Aviso texto={erro} erro />;
  if (estrutura === null) return <Aviso texto={carregando ? 'carregando…' : 'sem estrutura'} />;

  // Numa view a estrutura não se altera (AC-11), e o que o dialeto não faz nem
  // vira botão. As duas coisas se resolvem num `pode` só.
  const pode = (tipo: string): boolean =>
    !estrutura.ehView && permitidas !== undefined && permitidas.has(tipo) && onAlterar !== undefined;

  // Numa view não há chave estrangeira, índice nem checagem que valha mostrar.
  const sessoes: Sessao[] = estrutura.ehView
    ? ['ddl', 'colunas']
    : ['ddl', 'colunas', 'fks', 'indices', 'gatilhos', 'checagens'];

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Cabecalho
        estrutura={estrutura}
        onRecarregar={onRecarregar}
        pode={pode}
        onAlterar={onAlterar}
      />

      <Box
        role="tablist"
        aria-label="Partes da estrutura"
        sx={{
          display: 'flex', gap: 0.5, px: 1, borderBottom: 1, borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        {sessoes.map((s) => (
          <Box
            key={s}
            component="button"
            role="tab"
            aria-selected={sessao === s}
            onClick={() => setSessao(s)}
            sx={{
              border: 0, borderBottom: 2, borderColor: sessao === s ? 'primary.main' : 'transparent',
              bgcolor: 'transparent', color: sessao === s ? 'text.primary' : 'text.secondary',
              font: 'inherit', fontSize: 11, px: 0.75, py: 0.5, cursor: 'pointer',
            }}
          >
            {ROTULOS[s]}
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {sessao === 'ddl' && <Ddl texto={estrutura.ddl} />}
        {sessao === 'colunas' && (
          <TabelaDeColunas colunas={estrutura.colunas} pode={pode} onAlterar={onAlterar} />
        )}
        {sessao === 'fks' && (
          <>
            {pode('criar-chave-estrangeira') && (
              <Acao
                rotulo="+ chave estrangeira"
                onClick={() => onAlterar?.('criar-chave-estrangeira', { colunas: estrutura.colunas })}
              />
            )}
          <Lista
            lista={estrutura.chavesEstrangeiras}
            desenhar={desenharFk}
            acao={
              pode('apagar-chave-estrangeira')
                ? { rotulo: 'Apagar', tipo: 'apagar-chave-estrangeira', chave: 'nome' }
                : undefined
            }
            onAlterar={onAlterar}
          />
          </>
        )}
        {sessao === 'indices' && (
          <>
            {pode('criar-indice') && (
              <Acao rotulo="+ índice" onClick={() => onAlterar?.('criar-indice')} />
            )}
            <Lista
              lista={estrutura.indices}
              desenhar={desenharIndice}
              acao={
                pode('apagar-indice')
                  ? { rotulo: 'Apagar', tipo: 'apagar-indice', chave: 'nome' }
                  : undefined
              }
              onAlterar={onAlterar}
            />
          </>
        )}
        {sessao === 'gatilhos' && (
          <>
            {pode('criar-gatilho') && (
              <Acao rotulo="+ gatilho" onClick={() => onAlterar?.('criar-gatilho')} />
            )}
            <Lista
              lista={estrutura.gatilhos}
              desenhar={desenharGatilho}
              acao={
                pode('apagar-gatilho')
                  ? { rotulo: 'Apagar', tipo: 'apagar-gatilho', chave: 'nome' }
                  : undefined
              }
              onAlterar={onAlterar}
            />
          </>
        )}
        {sessao === 'checagens' && (
          <>
            {pode('criar-checagem') && (
              <Acao rotulo="+ checagem" onClick={() => onAlterar?.('criar-checagem')} />
            )}
            <Lista
              lista={estrutura.checagens}
              desenhar={desenharChecagem}
              acao={
                pode('apagar-checagem')
                  ? { rotulo: 'Apagar', tipo: 'apagar-checagem', chave: 'nome' }
                  : undefined
              }
              onAlterar={onAlterar}
            />
          </>
        )}
      </Box>
    </Box>
  );
}

function Cabecalho({
  estrutura, onRecarregar, pode, onAlterar,
}: {
  readonly estrutura: TableStructure;
  readonly onRecarregar: () => void;
  readonly pode: (tipo: string) => boolean;
  readonly onAlterar?: (tipo: string, ctx?: Record<string, unknown>) => void;
}) {
  const campos: [string, string | null][] = [
    ['Nome', estrutura.nome],
    ['Comentário', estrutura.comentario],
    ['Motor', estrutura.motor],
    ['Colação', estrutura.colacao],
  ];
  return (
    <Box
      data-cabecalho-estrutura
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, px: 1.25, py: 0.75,
        borderBottom: 1, borderColor: 'divider', fontSize: 11, flexShrink: 0, flexWrap: 'wrap',
      }}
    >
      {campos
        // O que o banco não tem some, em vez de aparecer vazio: "Motor: —" num
        // PostgreSQL diria que falta algo que nunca existiu ali.
        .filter(([, valor]) => valor !== null && valor !== '')
        .map(([rotulo, valor]) => (
          <Box key={rotulo} component="span">
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {rotulo}:{' '}
            </Box>
            <Box component="span" sx={{ fontFamily: tokens.fontMono }}>
              {valor}
            </Box>
          </Box>
        ))}
      <Box sx={{ flex: 1 }} />
      {pode('renomear-tabela') && (
        <Acao
          rotulo="Renomear tabela"
          onClick={() => onAlterar?.('renomear-tabela', { nome: estrutura.nome })}
        />
      )}
      {pode('comentario-tabela') && (
        <Acao
          rotulo="Comentário"
          onClick={() => onAlterar?.('comentario-tabela', { comentario: estrutura.comentario })}
        />
      )}
      {/* T067. No MySQL a colação é da TABELA; no PostgreSQL é da COLUNA, e por
          isso o rótulo muda junto com a operação que o dialeto declara. */}
      {pode('colacao-tabela') && (
        <Acao
          rotulo="Colação"
          onClick={() => onAlterar?.('colacao-tabela', { colacao: estrutura.colacao })}
        />
      )}
      {pode('colacao-coluna') && (
        <Acao
          rotulo="Colação de coluna"
          onClick={() => onAlterar?.('colacao-coluna', { colunas: estrutura.colunas })}
        />
      )}
      <Box
        component="button"
        type="button"
        aria-label="Recarregar a estrutura"
        onClick={onRecarregar}
        sx={{
          border: 0, bgcolor: 'transparent', color: 'text.secondary', font: 'inherit',
          fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        recarregar
      </Box>
    </Box>
  );
}

function Ddl({ texto }: { readonly texto: string }) {
  return (
    <Box
      data-ddl
      component="pre"
      sx={{
        m: 0, p: 1.25, fontFamily: tokens.fontMono, fontSize: 11.5,
        whiteSpace: 'pre-wrap', color: 'text.primary',
      }}
    >
      {texto === '' ? '(sem DDL)' : texto}
    </Box>
  );
}

const estiloDeGrade = {
  borderCollapse: 'collapse' as const,
  width: '100%',
  fontFamily: tokens.fontMono,
  fontSize: 11.5,
  '& th, & td': {
    borderBottom: 1,
    borderColor: 'divider',
    px: 1,
    py: '3px',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
  },
  '& thead th': {
    position: 'sticky' as const,
    top: 0,
    bgcolor: 'background.paper',
    color: 'text.secondary',
    fontWeight: 600,
  },
};

/** `✓` e vazio, em vez de `true`/`false`: a coluna é para varrer com os olhos. */
const marca = (ligado: boolean): string => (ligado ? '✓' : '');

/** Um botão de ação em texto. Discreto de propósito: isto GERA SQL, não roda. */
function Acao({ rotulo, onClick }: { readonly rotulo: string; readonly onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', color: 'primary.main', font: 'inherit',
        fontSize: 11, cursor: 'pointer', textDecoration: 'underline', px: 0.5,
      }}
    >
      {rotulo}
    </Box>
  );
}

function TabelaDeColunas({
  colunas, pode, onAlterar,
}: {
  readonly colunas: readonly ColunaDetalhada[];
  readonly pode: (tipo: string) => boolean;
  readonly onAlterar?: (tipo: string, ctx?: Record<string, unknown>) => void;
}) {
  const acoes = ['renomear-coluna', 'alterar-coluna', 'apagar-coluna'].filter(pode);
  const cabecalhos = [
    'Nome', 'Tipo', 'Tam.', 'Padrão', 'Not null', 'Chave', 'Única', 'Auto', 'Comentário',
    ...(acoes.length === 0 ? [] : ['Ações']),
  ];
  return (
    <>
      {pode('acrescentar-coluna') && (
        <Acao rotulo="+ coluna" onClick={() => onAlterar?.('acrescentar-coluna')} />
      )}
    <Box component="table" data-lista="colunas" sx={estiloDeGrade}>
      <thead>
        <tr>
          {cabecalhos.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {colunas.map((c) => (
          <Box component="tr" key={c.name} data-coluna-estrutura={c.name}>
            <td>{c.name}</td>
            <td>{c.type}</td>
            <td>{c.tamanho ?? ''}</td>
            <td>{c.padrao ?? ''}</td>
            <td>{marca(c.obrigatoria)}</td>
            <td>{marca(c.chave)}</td>
            <td>{marca(c.unica)}</td>
            <td>{marca(c.autoIncremento)}</td>
            <td>{c.comentario ?? ''}</td>
            {acoes.length > 0 && (
              <td>
                {acoes.map((tipo) => (
                  <Acao
                    key={tipo}
                    rotulo={ROTULO_DE_ACAO[tipo] ?? tipo}
                    onClick={() =>
                      onAlterar?.(tipo, { coluna: c.name, tipoAtual: c.type })
                    }
                  />
                ))}
              </td>
            )}
          </Box>
        ))}
      </tbody>
    </Box>
    </>
  );
}

/** Rótulos curtos: a coluna de ações é estreita, e o verbo já diz tudo. */
const ROTULO_DE_ACAO: Record<string, string> = {
  'renomear-coluna': 'renomear',
  'alterar-coluna': 'alterar',
  'apagar-coluna': 'apagar',
};

interface Desenho<T> {
  readonly cabecalhos: readonly string[];
  readonly linha: (item: T) => readonly string[];
  readonly chave: (item: T) => string;
}

const desenharFk: Desenho<ChaveEstrangeira> = {
  cabecalhos: ['Restrição', 'Coluna', 'Tabela ref.', 'Coluna ref.', 'Ao atualizar', 'Ao apagar'],
  linha: (f) => [
    f.nome, f.coluna, f.tabelaReferenciada, f.colunaReferenciada,
    f.aoAtualizar ?? '', f.aoApagar ?? '',
  ],
  chave: (f) => `${f.nome}:${f.coluna}`,
};

const desenharIndice: Desenho<IndiceDaTabela> = {
  cabecalhos: ['Nome', 'Colunas', 'Única', 'Tipo'],
  linha: (i) => [i.nome, i.colunas.join(', '), marca(i.unico), i.tipo ?? ''],
  chave: (i) => i.nome,
};

const desenharGatilho: Desenho<GatilhoDaTabela> = {
  cabecalhos: ['Nome', 'Momento', 'Evento', 'Orientação', 'Corpo'],
  linha: (g) => [g.nome, g.momento, g.evento, g.orientacao ?? '', g.corpo],
  chave: (g) => g.nome,
};

const desenharChecagem: Desenho<ChecagemDaTabela> = {
  cabecalhos: ['Nome', 'Expressão'],
  linha: (c) => [c.nome, c.expressao],
  chave: (c) => c.nome,
};

function Lista<T>({
  lista, desenhar, acao, onAlterar,
}: {
  readonly lista: ListaOuNaoSei<T>;
  readonly desenhar: Desenho<T>;
  readonly acao?: { readonly rotulo: string; readonly tipo: string; readonly chave: string };
  readonly onAlterar?: (tipo: string, ctx?: Record<string, unknown>) => void;
}) {
  // "Este banco não sabe responder" é diferente de "não há nenhum", e aparece
  // diferente: um é limitação da IDE ou do servidor, o outro é um fato sobre a
  // tabela. Mostrar os dois como "nenhum" mentiria sobre o segundo.
  if ('naoSei' in lista) return <Aviso texto={lista.naoSei} />;
  if (lista.itens.length === 0) return <Aviso texto="Nenhum." />;

  return (
    <Box component="table" sx={estiloDeGrade}>
      <thead>
        <tr>
          {desenhar.cabecalhos.map((c) => (
            <th key={c}>{c}</th>
          ))}
          {acao !== undefined && <th>Ações</th>}
        </tr>
      </thead>
      <tbody>
        {lista.itens.map((item) => (
          <tr key={desenhar.chave(item)}>
            {desenhar.linha(item).map((celula, i) => (
              <Box
                component="td"
                key={i}
                title={celula}
                sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {celula}
              </Box>
            ))}
            {acao !== undefined && (
              <td>
                <Acao
                  rotulo={acao.rotulo}
                  onClick={() =>
                    onAlterar?.(acao.tipo, {
                      nome: (item as Record<string, unknown>)[acao.chave],
                    })
                  }
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

function Aviso({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      data-aviso-estrutura
      sx={{
        p: 1.75, color: erro ? 'error.main' : 'text.secondary', fontSize: 12,
        whiteSpace: 'pre-wrap', fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
