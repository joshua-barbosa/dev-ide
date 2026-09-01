// "O que esta IDE precisa da sua máquina" — a ideia dele.
//
// > *"é bem interessante montar essa documentação dentro da IDE, porque
// > algumas coisas precisam instalar dependências, certo? Que estariam fora do
// > Electron talvez."*
//
// A observação do Electron é o miolo: empacotar a IDE não leva junto o `git`,
// o `ruff` nem o `xdg-open`. Essas ferramentas são da máquina e vão continuar
// sendo — então esta lista precisa existir de qualquer jeito, e é melhor que
// ela seja **verificada** do que escrita num README que envelhece.
//
// A tela não instala nada. Ela mostra o que falta, o que aquilo habilita e a
// linha para copiar — instalar programa na máquina de alguém sem que a pessoa
// digite o comando não é papel de editor de texto.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { Api } from '../api';
import type { EstadoDaFerramenta } from '../../shared/ferramentas';
import type { Capacidade } from '../../shared/formatacao';

export interface TelaDeRequisitosProps {
  onErro(erro: unknown): void;
}

const ROTULO_DA_LINGUAGEM: Readonly<Record<string, string>> = {
  javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', html: 'HTML',
  css: 'CSS', sql: 'SQL', xml: 'XML', markdown: 'Markdown', php: 'PHP',
  blade: 'Blade', yaml: 'YAML', dockerfile: 'Dockerfile', python: 'Python',
};

/** Um `<code>` que dá para selecionar e copiar — é para isso que ele existe. */
function Comando({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: tokens.fontMono, fontSize: 11, px: 0.75, py: 0.25,
        borderRadius: 0.5, bgcolor: 'action.hover', userSelect: 'all',
      }}
    >
      {children}
    </Box>
  );
}

function Cabecalho({ texto }: { texto: string }) {
  return (
    <Box
      sx={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
        color: 'text.secondary', borderBottom: 1, borderColor: 'divider',
        pb: 0.5, mb: 1, mt: 2.5,
      }}
    >
      {texto}
    </Box>
  );
}

export function TelaDeRequisitos({ onErro }: TelaDeRequisitosProps) {
  const [ferramentas, setFerramentas] = useState<readonly EstadoDaFerramenta[]>([]);
  const [capacidades, setCapacidades] = useState<Readonly<Record<string, Capacidade>>>({});
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    Api.formatCapabilities()
      .then((r) => {
        if (!vivo) return;
        setFerramentas(r.ferramentas);
        setCapacidades(r.capacidades);
      })
      .catch(onErro);
    return () => {
      vivo = false;
    };
    // `recarga` está aqui de propósito: é o botão "conferir de novo", para quem
    // instalou o que faltava sem fechar a IDE.
  }, [onErro, recarga]);

  const faltando = ferramentas.filter((f) => f.caminho === null);

  return (
    <Box
      data-tela-de-requisitos
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: tokens.bgEditor, p: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontSize: 15, flex: 1 }}>O que esta IDE precisa da sua máquina</Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Icon name="lucide:refresh-cw" size={13} />}
          onClick={() => setRecarga((n) => n + 1)}
          sx={{ fontSize: 11 }}
        >
          Conferir de novo
        </Button>
      </Box>

      <Box sx={{ color: 'text.secondary', fontSize: 11, mt: 1, maxWidth: 720, lineHeight: 1.7 }}>
        A IDE traz tudo o que é JavaScript dentro dela. O que está nesta página é
        o que vem <b>da sua máquina</b> — e continuará vindo mesmo depois de a
        IDE virar aplicativo: empacotar não leva junto o <code>git</code> nem o{' '}
        <code>ruff</code>. Nada aqui é executado para a conferência: a IDE só
        procura o programa no seu <code>PATH</code>.
      </Box>

      {faltando.length === 0 ? (
        <Box sx={{ fontSize: 12, color: 'success.main', mt: 2 }}>
          Está tudo aqui — nenhum recurso desligado por falta de ferramenta.
        </Box>
      ) : (
        <Box sx={{ fontSize: 12, color: 'warning.main', mt: 2 }}>
          {faltando.length === 1
            ? '1 ferramenta não está nesta máquina.'
            : `${faltando.length} ferramentas não estão nesta máquina.`}{' '}
          O que elas habilitam continua no menu, dizendo o que falta.
        </Box>
      )}

      <Cabecalho texto="Ferramentas" />
      {ferramentas.map((f) => (
        <Box
          key={f.nome}
          data-ferramenta={f.nome}
          data-presente={f.caminho === null ? 'nao' : 'sim'}
          sx={{
            display: 'flex', gap: 1.5, py: 1, borderBottom: 1, borderColor: 'divider',
            alignItems: 'flex-start',
          }}
        >
          <Icon
            name={f.caminho === null ? 'lucide:circle-alert' : 'lucide:circle-check'}
            size={14}
            // A cor diz o estado antes de a pessoa ler: obrigatória que falta é
            // vermelha, opcional que falta é amarela, presente é verde.
            color={
              f.caminho !== null
                ? 'var(--mui-palette-success-main, #4caf50)'
                : f.obrigatoria
                  ? 'var(--mui-palette-error-main, #f44336)'
                  : 'var(--mui-palette-warning-main, #ffa726)'
            }
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 12.5 }}>
              {f.nome}
              {f.obrigatoria && (
                <Box component="span" sx={{ fontSize: 10, color: 'text.secondary', ml: 1 }}>
                  obrigatória
                </Box>
              )}
            </Box>
            <Box sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25, lineHeight: 1.6 }}>
              {f.habilita}
            </Box>
            <Box sx={{ mt: 0.5 }}>
              {f.caminho === null ? (
                <Comando>{f.instalar}</Comando>
              ) : (
                <Box
                  sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: tokens.fontMono }}
                >
                  {f.caminho}
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      ))}

      <Cabecalho texto="Beautify e Minify, por linguagem" />
      <Box sx={{ color: 'text.secondary', fontSize: 11, mb: 1, maxWidth: 720, lineHeight: 1.7 }}>
        O que estiver marcado com <b>não</b> traz o motivo junto quando você
        tenta — o item do menu não some, ele explica.
      </Box>
      {Object.entries(capacidades).map(([linguagem, c]) => (
        <Box
          key={linguagem}
          data-capacidade={linguagem}
          sx={{
            display: 'flex', gap: 1.5, py: 0.6, borderBottom: 1, borderColor: 'divider',
            alignItems: 'center',
          }}
        >
          <Box sx={{ flex: 1, fontSize: 12 }}>
            {ROTULO_DA_LINGUAGEM[linguagem] ?? linguagem}
          </Box>
          {(['beautify', 'minify'] as const).map((modo) => (
            <Box
              key={modo}
              title={c[modo] ? undefined : c.porQueNao[modo]}
              sx={{
                fontSize: 11, width: 110, display: 'flex', alignItems: 'center', gap: 0.5,
                color: c[modo] ? 'text.primary' : 'text.secondary',
                cursor: c[modo] ? 'default' : 'help',
              }}
            >
              <Icon
                name={c[modo] ? 'lucide:check' : 'lucide:minus'}
                size={12}
                color={c[modo] ? 'var(--mui-palette-success-main, #4caf50)' : undefined}
              />
              {modo === 'beautify' ? 'Beautify' : 'Minify'}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
