// A tela de configurações (T001).
//
// A desculpa que eu tinha escrito na spec 011 era que o `config.json` já ERA a
// tela de configurações: a IDE sabe abrir, editar e salvar arquivo, então
// custava uma linha e cobria 100% das chaves. A nota dele desfez isso em uma
// frase: *"as duas formas, como o VS Code: tela com campos + o config.json,
// lendo e escrevendo o mesmo arquivo."*
//
// **O formulário sai do ESQUEMA, e não de uma lista escrita à mão.** É o que
// faz "acrescentar preferência" continuar sendo acrescentar uma linha em
// `shared/prefs.ts`: o campo aparece aqui sozinho, com o tipo certo e a faixa
// certa. Uma lista paralela divergiria do esquema no terceiro item novo.
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import {
  CHAVES, descreverRegra, ESQUEMA,
  type ChaveDePreferencia, type PatchDePreferencias, type Preferencias,
} from '../../shared/prefs';
import { nomesDeTema } from '../../shared/temas';
import { ROTULO_DO_TEMA, type TemaEmbutido } from '../../shared/temas-embutidos';

export interface TelaDePreferenciasProps {
  readonly prefs: Preferencias;
  /** As chaves que o `.vscode/settings.json` do projeto sobrescreve (T002). */
  readonly sobrescritas: readonly string[];
  definir(patch: PatchDePreferencias): Promise<void>;
  /** Abre o `config.json` no editor — a outra forma, que continua valendo. */
  abrirJson(): void;
  /** Abre o `.vscode/settings.json` do projeto, criando-o se preciso (T002). */
  abrirDoProjeto(): void;
  onErro(erro: unknown): void;
}

/**
 * O nome legível de cada chave.
 *
 * Tabela à parte de propósito: o esquema é sobre VALOR (tipo, faixa, padrão), e
 * pôr texto de interface nele misturaria as duas coisas. Chave sem rótulo
 * aparece com o próprio nome — some do texto, nunca da tela.
 */
const ROTULOS: Partial<Record<ChaveDePreferencia, string>> = {
  'editor.fontSize': 'Tamanho da fonte',
  'editor.tabSize': 'Tamanho da tabulação',
  'editor.wordWrap': 'Quebrar linha',
  'editor.autoSave': 'Salvar sozinho',
  'editor.autoSaveDelay': 'Esperar antes de salvar (ms)',
  'terminal.fontSize': 'Tamanho da fonte do terminal',
  'workbench.theme': 'Tema',
  'workbench.followSystem': 'Seguir o tema do sistema',
  'workbench.themeLight': 'Tema quando o sistema está claro',
  'workbench.themeDark': 'Tema quando o sistema está escuro',
  'vault.rememberDays': 'Lembrar a senha mestra por (dias)',
};

const GRUPOS: Record<string, string> = {
  editor: 'Editor',
  terminal: 'Terminal',
  workbench: 'Aparência',
  vault: 'Cofre',
};

/**
 * As chaves cujo valor é um NOME DE TEMA.
 *
 * Elas são `texto` no esquema — desde o T012 um tema pode ser dele, e a lista
 * não cabe numa constante. Aqui a tela oferece o que existe AGORA, sem tirar de
 * ninguém o direito de digitar um nome que ainda não foi declarado.
 */
const CHAVES_DE_TEMA = new Set<ChaveDePreferencia>([
  'workbench.theme',
  'workbench.themeLight',
  'workbench.themeDark',
]);

const rotuloDoTema = (nome: string): string => ROTULO_DO_TEMA[nome as TemaEmbutido] ?? nome;

export function TelaDePreferencias({
  prefs, sobrescritas, definir, abrirJson, abrirDoProjeto, onErro,
}: TelaDePreferenciasProps) {
  const doProjeto = useMemo(() => new Set(sobrescritas), [sobrescritas]);
  /** O que o campo mostra enquanto ele digita, antes de o servidor aceitar. */
  const [rascunho, setRascunho] = useState<Partial<Record<string, string>>>({});

  const porGrupo = useMemo(() => {
    const mapa = new Map<string, ChaveDePreferencia[]>();
    for (const chave of CHAVES) {
      const grupo = chave.split('.')[0] ?? 'outros';
      mapa.set(grupo, [...(mapa.get(grupo) ?? []), chave]);
    }
    return [...mapa];
  }, []);

  const gravar = (chave: ChaveDePreferencia, valor: number | boolean | string): void => {
    // O servidor é quem valida (fronteira rígida da spec 011): a tela nem tenta
    // adivinhar se o número cabe na faixa.
    definir({ [chave]: valor } as PatchDePreferencias)
      .then(() => setRascunho((r) => ({ ...r, [chave]: undefined })))
      .catch(onErro);
  };

  const campo = (chave: ChaveDePreferencia): React.ReactNode => {
    const regra = ESQUEMA[chave];
    const valor = prefs[chave];

    if (regra.tipo === 'booleano') {
      return (
        <Switch
          size="small"
          checked={valor === true}
          slotProps={{ input: { 'aria-label': ROTULOS[chave] ?? chave } }}
          onChange={(e) => gravar(chave, e.target.checked)}
        />
      );
    }

    if (regra.tipo === 'opcao' || CHAVES_DE_TEMA.has(chave)) {
      const opcoes = regra.tipo === 'opcao' ? regra.opcoes : nomesDeTema();
      // Nome de tema declarado no `config.json` e apagado depois continua sendo
      // o valor gravado: sem esta linha o campo abriria vazio e a primeira
      // interação apagaria a escolha dele.
      const lista = opcoes.includes(String(valor)) ? opcoes : [String(valor), ...opcoes];
      return (
        <Select
          size="small"
          value={String(valor)}
          inputProps={{ 'aria-label': ROTULOS[chave] ?? chave }}
          onChange={(e) => gravar(chave, e.target.value)}
          sx={{ minWidth: 220, fontSize: 12 }}
        >
          {lista.map((o) => (
            <MenuItem key={o} value={o} sx={{ fontSize: 12 }}>
              {CHAVES_DE_TEMA.has(chave) ? rotuloDoTema(o) : o}
            </MenuItem>
          ))}
        </Select>
      );
    }

    if (regra.tipo === 'texto') {
      return (
        <TextField
          size="small"
          value={rascunho[chave] ?? String(valor)}
          slotProps={{ htmlInput: { 'aria-label': ROTULOS[chave] ?? chave } }}
          onChange={(e) => setRascunho((r) => ({ ...r, [chave]: e.target.value }))}
          onBlur={(e) => gravar(chave, e.target.value)}
          sx={{ width: 220, '& input': { fontSize: 12 } }}
        />
      );
    }

    return (
      <TextField
        size="small"
        type="number"
        value={rascunho[chave] ?? String(valor)}
        slotProps={{
          htmlInput: { 'aria-label': ROTULOS[chave] ?? chave, min: regra.min, max: regra.max },
        }}
        onChange={(e) => setRascunho((r) => ({ ...r, [chave]: e.target.value }))}
        // No `blur`, e não a cada tecla: digitar "22" passa por "2", que seria
        // gravado e devolveria o cursor para um valor que ninguém pediu.
        onBlur={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isNaN(n)) {
            setRascunho((r) => ({ ...r, [chave]: undefined }));
            return;
          }
          gravar(chave, n);
        }}
        sx={{ width: 120, '& input': { fontSize: 12 } }}
      />
    );
  };

  return (
    <Box
      data-tela-de-preferencias
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: tokens.bgEditor, p: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ fontSize: 15, flex: 1 }}>Configurações</Box>
        {/* As DUAS formas, e a segunda a um clique: é a nota dele. */}
        <Button
          size="small"
          variant="outlined"
          startIcon={<Icon name="lucide:file-json" size={13} />}
          onClick={abrirDoProjeto}
          sx={{ fontSize: 11 }}
        >
          Deste projeto
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Icon name="lucide:file-json" size={13} />}
          onClick={abrirJson}
          sx={{ fontSize: 11 }}
        >
          Editar o config.json
        </Button>
      </Box>

      <Box sx={{ color: 'text.secondary', fontSize: 11, mb: 2, maxWidth: 640, lineHeight: 1.6 }}>
        As duas formas escrevem no MESMO arquivo. O que você mudar aqui aparece
        no <code>config.json</code>, e o que salvar lá aparece aqui. O que o
        projeto declarar no <code>.vscode/settings.json</code> vence os dois — e
        os campos assim ficam marcados.
      </Box>

      {porGrupo.map(([grupo, chaves]) => (
        <Box key={grupo} sx={{ mb: 2.5 }}>
          <Box
            sx={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
              color: 'text.secondary', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 1,
            }}
          >
            {GRUPOS[grupo] ?? grupo}
          </Box>
          {chaves.map((chave) => (
            <Box
              key={chave}
              data-preferencia={chave}
              sx={{
                display: 'flex', alignItems: 'center', gap: 2, py: 0.75,
                borderBottom: 1, borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontSize: 12 }}>{ROTULOS[chave] ?? chave}</Box>
                <Box sx={{ fontSize: 10, color: 'text.secondary', fontFamily: tokens.fontMono }}>
                  {chave} · {descreverRegra(chave)}
                </Box>
                {/*
                  T002: o campo continua editável, e o aviso diz por que mexer
                  nele não muda nada. Desabilitar seria pior — quem não conhece
                  o `.vscode/settings.json` ficaria com um campo morto e sem
                  explicação.
                */}
                {doProjeto.has(chave) && (
                  <Box
                    data-sobrescrita={chave}
                    sx={{ fontSize: 10, color: 'warning.main', mt: 0.25 }}
                  >
                    este projeto manda nesta — o valor vem do
                    {' '}<code>.vscode/settings.json</code>
                  </Box>
                )}
              </Box>
              {campo(chave)}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
