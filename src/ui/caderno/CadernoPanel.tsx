// O Query Book (spec 048; superfície revista na spec 050).
//
// Uma segunda superfície de editor: blocos de SQL e de markdown, cada um com o
// seu `Run`. O que isso resolve e um `.sql` não é **investigação com
// narrativa** — nos cadernos do usuário (`1070`, `Chamado #123`, `Erros`)
// cada arquivo é a reconstituição de um problema, e o que explica cada consulta
// merece ser texto que se lê, não comentário.
//
// A spec 050 aproximou a superfície da ferramenta de referência em quatro
// pontos: cor no bloco (`BlocoDeCodigo`), acrescentar **entre** blocos
// (`Fresta`), arrastar para reordenar, e a barra de administração do bloco só
// aparecendo sob o mouse. O que se USA (`Run`, `＋Tab`, `JSON`) fica sempre à
// vista; o que se ADMINISTRA (mover, apagar) se esconde.
import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { Fresta } from './Fresta';
import { BlocoDeCodigo } from './BlocoDeCodigo';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import type { NomeDoTema } from '../../shared/temas';
import { comoRoda, type Caderno, type Celula, type TipoDeCelula } from '../../shared/sql/caderno';
import { rotuloDaLinguagem } from '../../shared/editor/idiomas';
import type { Vinculo } from '../../shared/sql/vinculo';

/**
 * Tipo MIME só do bloco (spec 050, D16).
 *
 * NÃO é o `MIME_DE_ARRASTE` das abas e dos arquivos: com o mesmo tipo, arrastar
 * um bloco por cima da barra de abas ofereceria soltar lá. Um tipo próprio torna
 * a confusão impossível por construção, em vez de por checagem.
 */
const MIME_DO_BLOCO = 'application/x-dev-ide-bloco';

export interface CadernoPanelProps {
  readonly caderno: Caderno;
  /** O que o `Run All` está fazendo agora, ou `null`. */
  readonly rodando: string | null;
  readonly erro: string | null;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onAlterar(id: string, conteudo: string): void;
  /** `fresta` conta as posições ENTRE blocos: `0` antes do primeiro. */
  onAcrescentar(tipo: TipoDeCelula, fresta: number): void;
  onRemover(id: string): void;
  onMover(id: string, direcao: -1 | 1): void;
  onReordenar(id: string, fresta: number): void;
  onRodar(celula: Celula, modo: 'run' | 'tab' | 'json'): void;
  onRodarTudo(): void;
  /** Pergunta a linguagem nova do bloco; `null` se o usuário desistir. */
  onEscolherLinguagem(id: string): void;
  /** Contra quem o caderno inteiro roda, ou `null` se ainda não se sabe. */
  readonly vinculo: Vinculo | null;
  onTrocarVinculo(): void;
}

export function CadernoPanel({
  caderno, rodando, erro, fontSize, tabSize, tema, vinculo,
  onAlterar, onAcrescentar, onRemover, onMover, onReordenar, onRodar, onRodarTudo,
  onEscolherLinguagem, onTrocarVinculo,
}: CadernoPanelProps) {
  const [atual, setAtual] = useState(0);
  // Quem está sendo arrastado e onde cairia. Os dois juntos porque é o par que
  // decide o que cada fresta mostra.
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);

  const largar = (): void => {
    setArrastando(null);
    setAlvo(null);
  };

  const frestaEm = (indice: number) => (
    <Fresta
      key={`fresta-${indice}`}
      indice={indice}
      arrastando={arrastando !== null}
      alvo={alvo === indice}
      onAcrescentar={onAcrescentar}
      onEntrarComArraste={setAlvo}
      onSoltar={(i) => {
        if (arrastando !== null) onReordenar(arrastando, i);
        largar();
      }}
    />
  );

  return (
    <Box
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
        bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        data-barra-do-caderno
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
          fontSize: 11, color: 'text.secondary', flexShrink: 0,
        }}
      >
        <Acao
          rotulo="Add Code"
          onClick={() => onAcrescentar('sql', caderno.celulas.length)}
        />
        <Acao
          rotulo="Add Markdown"
          onClick={() => onAcrescentar('markdown', caderno.celulas.length)}
        />
        <Box component="span" sx={{ opacity: 0.4 }}>|</Box>
        <Acao
          rotulo={rodando === null ? 'Run All' : 'rodando…'}
          onClick={onRodarTudo}
          desabilitada={rodando !== null}
        />
        <Box sx={{ flex: 1 }} />
        <Box component="span" data-contagem-de-celulas sx={{ mr: 1 }}>
          {caderno.celulas.length === 0
            ? 'caderno vazio'
            : `Bloco ${Math.min(atual + 1, caderno.celulas.length)} de ${caderno.celulas.length}`}
        </Box>
        {/*
          Contra quem este caderno roda (spec 051, AC-10).

          O vínculo já existia e já aparecia no RODAPÉ — mas só com editor Monaco
          em foco e linguagem `sql`. O caderno não é Monaco, então o único
          arquivo desta IDE que pertence a uma conexão por definição era
          justamente o que não dizia a qual.
        */}
        <Box
          component="button"
          type="button"
          onClick={onTrocarVinculo}
          aria-label="Trocar a conexão deste caderno"
          title={
            vinculo === null
              ? 'Este caderno ainda não tem conexão. Clique para escolher.'
              : `Roda em ${vinculo.database}. Clique para trocar.`
          }
          data-vinculo-do-caderno={vinculo === null ? '' : vinculo.database}
          sx={{
            border: 0, bgcolor: 'transparent', font: 'inherit', fontSize: 11,
            color: vinculo === null ? 'warning.main' : 'primary.main',
            cursor: 'pointer', px: 0.5,
          }}
        >
          {vinculo === null ? '⚠ sem conexão' : `⛁ ${vinculo.database}`}
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

      <Box
        sx={{ flex: 1, overflow: 'auto', minHeight: 0, p: 1 }}
        // Soltar fora de qualquer fresta cancela — sem isto o arraste ficaria
        // pendurado e as frestas acesas para sempre.
        onDragEnd={largar}
      >
        {caderno.celulas.length === 0 ? (
          <Box sx={{ p: 1.75, color: 'text.secondary', fontSize: 12 }}>
            Caderno vazio. Comece com <strong>Add Code</strong> ou{' '}
            <strong>Add Markdown</strong>.
          </Box>
        ) : (
          caderno.celulas.map((celula, i) => (
            <Box key={celula.id} sx={{ display: 'contents' }}>
              {frestaEm(i)}
              <Bloco
                celula={celula}
                indice={i}
                total={caderno.celulas.length}
                rodando={rodando === celula.id}
                arrastado={arrastando === celula.id}
                fontSize={fontSize}
                tabSize={tabSize}
                tema={tema}
                onFocar={() => setAtual(i)}
                onEscolherLinguagem={() => onEscolherLinguagem(celula.id)}
                onComecarArraste={() => setArrastando(celula.id)}
                onTerminarArraste={largar}
                onAlterar={onAlterar}
                onRemover={onRemover}
                onMover={onMover}
                onRodar={onRodar}
              />
            </Box>
          ))
        )}
        {caderno.celulas.length > 0 && frestaEm(caderno.celulas.length)}
      </Box>
    </Box>
  );
}

function Bloco({
  celula, indice, total, rodando, arrastado, fontSize, tabSize, tema,
  onFocar, onEscolherLinguagem, onComecarArraste, onTerminarArraste,
  onAlterar, onRemover, onMover, onRodar,
}: {
  readonly celula: Celula;
  readonly indice: number;
  readonly total: number;
  readonly rodando: boolean;
  readonly arrastado: boolean;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onFocar(): void;
  onEscolherLinguagem(): void;
  onComecarArraste(): void;
  onTerminarArraste(): void;
  onAlterar(id: string, conteudo: string): void;
  onRemover(id: string): void;
  onMover(id: string, direcao: -1 | 1): void;
  onRodar(celula: Celula, modo: 'run' | 'tab' | 'json'): void;
}) {
  // Markdown nasce mostrando o texto quando está vazio, e renderizado quando
  // tem conteúdo: um bloco novo é para escrever, um antigo é para ler.
  const [editando, setEditando] = useState(celula.conteudo.trim() === '');
  const caixa = useRef<HTMLDivElement>(null);
  const destino = comoRoda(celula.linguagem);
  const rotulo = `Bloco ${indice + 1} (${celula.linguagem})`;

  return (
    <Box
      ref={caixa}
      data-bloco={celula.id}
      data-tipo={celula.linguagem}
      onFocus={onFocar}
      sx={{
        mb: 0, border: 1, borderColor: rodando ? 'primary.main' : 'divider', borderRadius: 0.5,
        bgcolor: 'background.paper',
        // O bloco que está sendo arrastado desbota: é como se vê que ele saiu
        // do lugar e ainda não chegou em outro.
        opacity: arrastado ? 0.4 : 1,
        // A barra de administração só sob o mouse OU com o foco dentro — a
        // segunda metade é o que a mantém alcançável pelo teclado (AC-14).
        '& .administrar': { opacity: 0, transition: 'opacity 90ms' },
        '&:hover .administrar, &:focus-within .administrar': { opacity: 1 },
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25,
          borderBottom: 1, borderColor: 'divider', fontSize: 10, color: 'text.secondary',
        }}
      >
        {/*
          O que o bloco oferece depende da linguagem (spec 051, D17). `nada` é
          resposta comum e legítima: o seletor oferece todas as linguagens do
          editor, e a IDE roda cinco — um `▷ Run` que não faz nada seria uma
          promessa quebrada.
        */}
        {destino === 'sql' && (
          <>
            <Acao rotulo="▷ Run" onClick={() => onRodar(celula, 'run')} />
            <Acao rotulo="＋Tab" onClick={() => onRodar(celula, 'tab')} />
            <Acao rotulo="JSON" onClick={() => onRodar(celula, 'json')} />
          </>
        )}
        {destino === 'runner' && <Acao rotulo="▷ Run" onClick={() => onRodar(celula, 'run')} />}
        {destino === 'markdown' && (
          <Acao
            rotulo={editando ? 'Ver renderizado' : 'Editar'}
            onClick={() => setEditando((v) => !v)}
          />
        )}

        <Box sx={{ flex: 1 }} />
        <Box className="administrar" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <Box
            component="span"
            // O arraste sai DAQUI, e não do bloco inteiro: com o bloco
            // arrastável, selecionar texto com o mouse dentro dele viraria um
            // arraste — a `textarea` perderia a função mais básica que tem.
            draggable
            data-pegar={celula.id}
            aria-label={`Arrastar o bloco ${indice + 1}`}
            title={`Arrastar o bloco ${indice + 1}`}
            onDragStart={(e: React.DragEvent) => {
              e.dataTransfer.setData(MIME_DO_BLOCO, celula.id);
              e.dataTransfer.effectAllowed = 'move';
              // Sem isto o que o mouse carrega é o ícone da alça, e não dá para
              // ver o que está sendo movido.
              if (caixa.current !== null) e.dataTransfer.setDragImage(caixa.current, 16, 16);
              onComecarArraste();
            }}
            onDragEnd={onTerminarArraste}
            sx={{ display: 'flex', cursor: 'grab', p: 0.25, '&:active': { cursor: 'grabbing' } }}
          >
            <Icon name="lucide:grip-vertical" size={12} />
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
            icone="lucide:trash-2"
            rotulo={`Apagar o bloco ${indice + 1}`}
            onClick={() => onRemover(celula.id)}
          />
        </Box>
      </Box>

      {destino === 'markdown' && !editando ? (
        // Clicar no renderizado volta a editar: é o gesto que se espera de um
        // caderno, e evita ter que mirar no botão.
        <Box onClick={() => setEditando(true)} sx={{ cursor: 'text' }}>
          <MarkdownPreview fonte={celula.conteudo} />
        </Box>
      ) : destino !== 'markdown' ? (
        <BlocoDeCodigo
          id={celula.id}
          conteudo={celula.conteudo}
          linguagem={celula.linguagem}
          rotulo={rotulo}
          fontSize={fontSize}
          tabSize={tabSize}
          tema={tema}
          onAlterar={(texto) => onAlterar(celula.id, texto)}
          onAtalhoDeRodar={() => onRodar(celula, 'run')}
          onFocar={onFocar}
        />
      ) : (
        // Markdown em edição segue sem cor (AC-5): o que se lê dele é o modo
        // renderizado, e colorir marcação enquanto se escreve atrapalha mais
        // que ajuda.
        <Box
          component="textarea"
          data-conteudo={celula.id}
          aria-label={rotulo}
          spellCheck={false}
          value={celula.conteudo}
          onFocus={onFocar}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onAlterar(celula.id, e.target.value)
          }
          rows={Math.min(20, Math.max(3, celula.conteudo.split('\n').length + 1))}
          sx={{
            width: '100%', border: 0, outline: 'none', resize: 'vertical',
            bgcolor: 'transparent', color: 'text.primary', p: 1,
            fontFamily: tokens.fontMono, fontSize: `${fontSize}px`, lineHeight: 1.5,
          }}
        />
      )}

      {/* No canto de baixo à direita, como no `MySQL ⌄` da ferramenta dele. */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 0.75, pb: 0.25 }}>
        <Box
          component="button"
          type="button"
          onClick={onEscolherLinguagem}
          aria-label={`Linguagem do bloco ${indice + 1}`}
          title="Trocar a linguagem deste bloco"
          data-linguagem={celula.linguagem}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'text.secondary', font: 'inherit',
            fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.25,
            '&:hover': { color: 'text.primary' },
          }}
        >
          {rotuloDaLinguagem(celula.linguagem)}
          <Icon name="lucide:chevron-down" size={10} />
        </Box>
      </Box>
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
