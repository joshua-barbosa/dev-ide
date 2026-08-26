// O visor de célula: a lupa (spec 062, fase D).
//
// Existe porque a grade mostra o valor cortado na largura da coluna, e há
// colunas — `longtext` com JSON, `blob`, texto de log — em que o que interessa
// nunca cabe. A grade responde "o que tem nesta tabela"; o visor responde "o que
// tem NESTA célula".
//
// Nada aqui grava no banco. `Salvar` mexe no RASCUNHO, e quem grava continua
// sendo a barra de rascunho, com o SQL à vista e o sim do usuário (spec 044).
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import { useTheme } from '@mui/material/styles';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { useColorido } from '../caderno/colorir';
import { TEMAS, type NomeDoTema } from '../../shared/temas';
import {
  compactar, indentar, modosDe, paraEditar, resumoDe, type ModoDoVisor,
} from '../../shared/grade/valor';
import type { CellValue } from '../../shared/contracts';

/**
 * O que decide a posição de cada caractere, compartilhado pelas duas camadas.
 *
 * Não é enfeite: se o `<pre>` e a `textarea` divergirem em um pixel de fonte,
 * entrelinha, recuo ou quebra, o cursor deixa de cair onde o texto está.
 */
const ESTILO_DO_TEXTO = {
  margin: 0,
  padding: '8px',
  fontFamily: tokens.fontMono,
  fontSize: '12px',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'break-word' as const,
  wordBreak: 'normal' as const,
  tabSize: 2,
  border: 0,
  letterSpacing: 'normal',
};

export interface VisorDeCelulaProps {
  readonly aberto: boolean;
  readonly coluna: string;
  /** O valor como está na GRADE — que pode vir cortado pelo servidor. */
  readonly valor: CellValue;
  /**
   * Busca o valor inteiro no banco.
   *
   * Ausente quando não há como: em SQL livre a IDE não sabe a tabela, e sem
   * chave primária não há como apontar uma linha só. Nesses casos o visor
   * mostra o que a grade tem, e DIZ que está cortado.
   */
  readonly buscarInteiro?: () => Promise<{ readonly valor: CellValue; readonly cortadoEm: number | null }>;
  /** Por que não dá para editar, quando não dá. Texto, não booleano. */
  readonly motivoSemEdicao: string | null;
  readonly onFechar: () => void;
  /** Alimenta o rascunho da spec 044. Ausente quando a grade é só de leitura. */
  readonly onSalvar?: (novo: CellValue) => void;
}

export function VisorDeCelula({
  aberto, coluna, valor, motivoSemEdicao, onFechar, onSalvar, buscarInteiro,
}: VisorDeCelulaProps) {
  const arquivo = useRef<HTMLInputElement | null>(null);
  const camada = useRef<HTMLPreElement>(null);
  const [buscando, setBuscando] = useState(false);
  /** O valor inteiro, quando já chegou. Antes disso vale o da grade. */
  const [inteiro, setInteiro] = useState<CellValue | undefined>(undefined);
  const [cortadoEm, setCortadoEm] = useState<number | null>(null);

  const original = paraEditar(inteiroOuDaGrade(inteiro, valor));
  const [texto, setTexto] = useState(original);
  const [modo, setModo] = useState<ModoDoVisor>('texto');
  const [aviso, setAviso] = useState<string | null>(null);

  // O tema sai do MUI, que já o acompanha (`criarTema` mapeia `escuro`→`dark`).
  // A alternativa era enfiar `tema` por quatro camadas de props até aqui, para
  // chegar ao mesmo valor.
  const nomeDoTema: NomeDoTema = useTheme().palette.mode === 'dark' ? 'escuro' : 'claro';
  const paleta = TEMAS[nomeDoTema];

  // Reabrir noutra célula precisa recomeçar. Sem isto, o visor mostraria o
  // valor da célula ANTERIOR — que parece um valor legítimo, e é o pior tipo
  // de erro: silencioso e plausível.
  // Buscar o valor INTEIRO ao abrir.
  //
  // A grade corta em 2048 caracteres para não arrastar megabytes por página — e
  // o visor promete o valor inteiro. Ele estava mostrando o cortado, com as
  // reticências do servidor no fim: um JSON de simulado parava no meio de
  // `"nota":…`, e nada na tela dizia que faltava coisa.
  useEffect(() => {
    if (!aberto) {
      setInteiro(undefined);
      setCortadoEm(null);
      return;
    }
    if (buscarInteiro === undefined) return;
    let vigente = true;
    setBuscando(true);
    void buscarInteiro()
      .then((r) => {
        if (!vigente) return;
        setInteiro(r.valor);
        setCortadoEm(r.cortadoEm);
      })
      .catch((e: Error) => {
        // Falhar aqui NÃO pode esvaziar o visor: o valor da grade continua
        // valendo, e o usuário fica sabendo por que não veio o resto.
        if (vigente) setAviso(`Não deu para buscar o valor inteiro: ${e.message}`);
      })
      .finally(() => {
        if (vigente) setBuscando(false);
      });
    return () => {
      vigente = false;
    };
  }, [aberto, buscarInteiro]);

  useEffect(() => {
    if (!aberto) return;
    setTexto(original);
    // Abre já indentado quando é JSON: é para isso que se abre um JSON.
    const bonito = indentar(original);
    setModo(bonito === null ? 'texto' : 'json');
    if (bonito !== null) setTexto(bonito);
  }, [aberto, original]);

  // `plaintext` quando não é JSON: o Monaco devolve o texto escapado sem cor,
  // que é exatamente o que se quer — e evita um `if` em volta das camadas.
  const colorido = useColorido(texto, modo === 'json' ? 'json' : 'plaintext', nomeDoTema, 2);

  const modos = modosDe(texto);
  const editavel = onSalvar !== undefined && motivoSemEdicao === null;
  const mudou = texto !== original && indentar(original) !== texto;

  const trocarModo = (novo: ModoDoVisor): void => {
    if (novo === modo) return;
    const convertido = novo === 'json' ? indentar(texto) : compactar(texto);
    if (convertido === null) {
      setAviso('Este valor não é JSON válido.');
      return;
    }
    setAviso(null);
    setModo(novo);
    setTexto(convertido);
  };

  const salvar = (): void => {
    // O que volta para o banco é COMPACTO quando é JSON: a indentação é do
    // visor, e gravá-la incharia a coluna sem mudar o dado.
    const paraOBanco = modo === 'json' ? (compactar(texto) ?? texto) : texto;
    onSalvar?.(paraOBanco);
    onFechar();
  };

  return (
    <Dialog open={aberto} onClose={onFechar} maxWidth="md" fullWidth>
      <Box data-visor-de-celula sx={{ p: 2, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Box sx={{ fontSize: 13, fontWeight: 600 }}>{coluna}</Box>
          <Box sx={{ color: 'text.secondary', fontSize: 11 }}>
            {buscando ? 'buscando o valor inteiro…' : resumoDe(texto)}
          </Box>
          {avisoDeCorte(texto, inteiro, cortadoEm) !== null && (
            <Box data-corte sx={{ color: 'warning.main', fontSize: 11 }}>
              ⚠ {avisoDeCorte(texto, inteiro, cortadoEm)}
            </Box>
          )}
          <Box sx={{ flex: 1 }} />

          {modos.length > 1 && (
            <Box role="tablist" aria-label="Como mostrar o valor" sx={{ display: 'flex', gap: 0.5 }}>
              {modos.map((m) => (
                <Box
                  key={m}
                  component="button"
                  type="button"
                  role="tab"
                  aria-selected={modo === m}
                  onClick={() => trocarModo(m)}
                  sx={{
                    border: 1, borderColor: modo === m ? 'primary.main' : 'divider',
                    bgcolor: 'transparent', color: modo === m ? 'primary.main' : 'text.secondary',
                    font: 'inherit', fontSize: 11, px: 1, py: 0.25, borderRadius: 0.5,
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}
                >
                  {m}
                </Box>
              ))}
            </Box>
          )}

          <BotaoDoVisor
            icone="lucide:copy"
            rotulo="Copiar o valor"
            onClick={() => void navigator.clipboard?.writeText(texto)}
          />
          {modo === 'json' && (
            <BotaoDoVisor
              icone="lucide:braces"
              rotulo="Reindentar o JSON"
              onClick={() => {
                const bonito = indentar(texto);
                if (bonito === null) setAviso('Este valor não é JSON válido.');
                else setTexto(bonito);
              }}
            />
          )}
          {editavel && (
            <BotaoDoVisor
              icone="lucide:file-up"
              rotulo="Carregar de um arquivo"
              onClick={() => arquivo.current?.click()}
            />
          )}
          <BotaoDoVisor
            icone="lucide:file-down"
            rotulo="Salvar em um arquivo"
            onClick={() => baixar(`${coluna}.txt`, texto)}
          />
        </Box>

        {/* Fora da tela, mas no DOM: é o único jeito de abrir o seletor de
            arquivo do sistema, e ele precisa do clique do usuário. */}
        <Box
          component="input"
          type="file"
          ref={arquivo}
          aria-label="Arquivo para carregar na célula"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f === undefined) return;
            void f.text().then((conteudo) => {
              setTexto(conteudo);
              setAviso(null);
            });
            // Zera para o mesmo arquivo poder ser escolhido duas vezes seguidas.
            e.target.value = '';
          }}
          sx={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />

        {/* Duas camadas ocupando o mesmo espaço, como no bloco do caderno
            (spec 050, D17): embaixo o `<pre>` que o Monaco colore, em cima a
            `textarea` com o texto transparente. Tudo que decide a POSIÇÃO de um
            caractere está em `ESTILO_DO_TEXTO` e vale para as duas — divergir um
            pixel faz o cursor mentir. */}
        <Box sx={{ position: 'relative', bgcolor: tokens.bgEditor, borderRadius: 0.5 }}>
          <Box
            component="pre"
            ref={camada}
            aria-hidden
            sx={{
              ...ESTILO_DO_TEXTO,
              position: 'absolute', inset: 0, overflow: 'hidden',
              pointerEvents: 'none', color: paleta.fg,
            }}
            dangerouslySetInnerHTML={{ __html: colorido ?? '' }}
          />
          <Box
            component="textarea"
            data-valor-da-celula
            aria-label={`Valor de ${coluna}`}
            spellCheck={false}
            readOnly={!editavel}
            value={texto}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTexto(e.target.value)}
            onScroll={(e: React.UIEvent<HTMLTextAreaElement>) => {
              const pre = camada.current;
              if (pre === null) return;
              pre.scrollTop = e.currentTarget.scrollTop;
              pre.scrollLeft = e.currentTarget.scrollLeft;
            }}
            sx={{
              ...ESTILO_DO_TEXTO,
              position: 'relative', display: 'block', width: '100%',
              minHeight: 320, resize: 'vertical', outline: 'none',
              bgcolor: 'transparent',
              // Transparente porque quem aparece é a camada de baixo; o cursor
              // continua pintado, que é a única parte visível da `textarea`.
              color: 'transparent',
              caretColor: paleta.fg,
              '&::selection': { bgcolor: `${paleta.accent}55` },
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
          <Box sx={{ fontSize: 11, color: aviso === null ? 'text.secondary' : 'error.main' }}>
            {aviso ?? motivoSemEdicao ?? ''}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Botao rotulo="Fechar" onClick={onFechar} />
          {editavel && <Botao rotulo="Salvar no rascunho" onClick={salvar} destaque disabled={!mudou} />}
        </Box>
      </Box>
    </Dialog>
  );
}

/** O inteiro quando já chegou; senão o da grade, que é melhor que nada. */
function inteiroOuDaGrade(inteiro: CellValue | undefined, daGrade: CellValue): CellValue {
  return inteiro === undefined ? daGrade : inteiro;
}

/**
 * O aviso de que o que está na tela NÃO é o valor inteiro.
 *
 * Dois casos diferentes, e o usuário precisa distinguir:
 *   - não deu para buscar (SQL livre, tabela sem chave) e o que se vê é o
 *     recorte da grade;
 *   - veio do banco, mas é grande demais até para o visor.
 */
function avisoDeCorte(
  texto: string,
  inteiro: CellValue | undefined,
  cortadoEm: number | null
): string | null {
  if (cortadoEm !== null) {
    return `valor cortado em ${cortadoEm.toLocaleString('pt-BR')} caracteres — é grande demais para caber na tela`;
  }
  // As reticências do servidor no fim são o sinal de que a grade cortou. Só
  // valem como aviso quando o inteiro NÃO chegou: com ele, o `…` pode ser
  // simplesmente parte do texto.
  if (inteiro === undefined && texto.endsWith('…')) {
    return 'cortado pela grade — a IDE não sabe qual linha é para buscar o resto';
  }
  return null;
}

/**
 * Entrega um arquivo ao usuário.
 *
 * `URL.revokeObjectURL` sempre: sem ele cada `Export` deixa o conteúdo da
 * célula preso na memória da aba até a página recarregar, e uma coluna `blob`
 * de alguns megabytes torna isso perceptível.
 */
function baixar(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function BotaoDoVisor({
  icone, rotulo, onClick,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      sx={{
        border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'text.secondary',
        p: 0.5, borderRadius: 0.5, display: 'flex', cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
      }}
    >
      <Icon name={icone} size={14} />
    </Box>
  );
}

function Botao({
  rotulo, onClick, destaque = false, disabled = false,
}: {
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly destaque?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        border: 1, borderColor: destaque ? 'primary.main' : 'divider',
        bgcolor: destaque ? 'primary.main' : 'transparent',
        color: destaque ? 'background.default' : 'text.primary',
        opacity: disabled ? 0.4 : 1,
        font: 'inherit', fontSize: 12, px: 1.5, py: 0.5, borderRadius: 0.5,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {rotulo}
    </Box>
  );
}
