// Barra de abas.
//
// O ponto de "não salvo" ocupa o mesmo lugar do X e vira X ao passar o mouse:
// a aba não muda de largura ao ficar suja, então a fila não dança.
//
// **Reordenar (T029).** A barra recebe a soltura em vez de deixá-la cair no
// grupo de baixo: soltar sobre a barra quer dizer "aqui nesta fila", e não
// "divide a tela deste lado". Por isso o `stopPropagation` — sem ele o mesmo
// gesto acionaria as duas coisas.
import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { Tab } from '../../shared/tabs';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import {
  alvoDaInsercao, codificarCarga, decodificarCarga, ehMetadeDireita, MIME_DE_ARRASTE,
  type CargaDeArraste,
} from '../../shared/arrastar';

export interface TabBarProps {
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  /** Ausente quando não há o que executar; aí o botão não aparece. */
  readonly onExecutar?: () => void;
  /** Numa aba SQL o mesmo botão manda para o banco. */
  readonly ehSql?: boolean;
  /**
   * Soltaram algo NA BARRA, antes da aba dita (T029).
   *
   * `antesDe: null` quer dizer no fim da fila. Quem trata decide o que fazer
   * com cada tipo de carga — a barra só sabe onde o dedo parou.
   */
  readonly onSoltarNaBarra?: (carga: CargaDeArraste, antesDe: string | null) => void;
  /**
   * Um arraste nosso está passando sobre a barra.
   *
   * O grupo de baixo usa para apagar o indicador de divisão dele: com os dois
   * acesos, a tela mostraria duas promessas diferentes para o mesmo gesto.
   */
  readonly onArrastarNaBarra?: () => void;
  /** Ausente quando a aba ativa não é pré-visualizável (só markdown, hoje). */

  /** Verdadeiro quando a aba ativa já está mostrando o renderizado. */

}

export function TabBar({
  tabs, activeId, onActivate, onClose, onExecutar, ehSql = false,
  onSoltarNaBarra, onArrastarNaBarra,
}: TabBarProps) {
  // A marca vive num `ref` E num estado, pela mesma razão do grupo: soltar logo
  // depois de entrar na barra cairia numa closure com o estado ainda vazio.
  const alvo = useRef<string | null>(null);
  const [insercao, setInsercao] = useState<{ readonly antesDe: string | null } | null>(null);

  const marcar = (antesDe: string | null): void => {
    alvo.current = antesDe;
    setInsercao({ antesDe });
  };
  const limpar = (): void => {
    alvo.current = null;
    setInsercao(null);
  };

  /** Só arraste NOSSO reordena — um arquivo do sistema não conta. */
  const ehNosso = (e: React.DragEvent): boolean =>
    [...e.dataTransfer.types].includes(MIME_DE_ARRASTE);

  const sobrevoar = (e: React.DragEvent, indice: number): void => {
    if (!ehNosso(e) || onSoltarNaBarra === undefined) return;
    // Sem `preventDefault` o navegador recusa a soltura; sem `stopPropagation`
    // o grupo de baixo acende o indicador de divisão ao mesmo tempo.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onArrastarNaBarra?.();

    if (indice < 0) {
      marcar(null); // o vazio depois da última aba
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const direita = ehMetadeDireita(
      { x: r.left, y: r.top, largura: r.width, altura: r.height },
      e.clientX
    );
    marcar(alvoDaInsercao(tabs.map((t) => t.id), indice, direita));
  };

  const soltar = (e: React.DragEvent): void => {
    if (!ehNosso(e) || onSoltarNaBarra === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const antesDe = alvo.current;
    limpar();
    const carga = decodificarCarga(e.dataTransfer.getData(MIME_DE_ARRASTE));
    // Pasta não vira aba — ver a nota no `EditorGroup`.
    if (carga?.tipo === 'arquivo' && carga.pasta === true) return;
    if (carga !== null) onSoltarNaBarra(carga, antesDe);
  };

  if (tabs.length === 0) return null;

  const ultima = tabs[tabs.length - 1];

  return (
    <Box
      data-barra-de-abas
      onDragOver={(e) => sobrevoar(e, -1)}
      onDragEnter={(e) => sobrevoar(e, -1)}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) limpar();
      }}
      onDrop={soltar}
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      {tabs.map((tab, indice) => {
        const ativa = tab.id === activeId;
        // A linha da inserção. O fim da fila se desenha à DIREITA da última, que
        // é o único lugar onde ela não cabe à esquerda de ninguém.
        const marcaAntes = insercao?.antesDe === tab.id;
        const marcaDepois = insercao !== null && insercao.antesDe === null && tab.id === ultima?.id;
        return (
          <Box
            key={tab.id}
            data-tab={tab.title}
            data-tab-active={ativa ? 'true' : 'false'}
            data-tab-dirty={tab.dirty ? 'true' : 'false'}
            {...(marcaAntes ? { 'data-insercao': 'antes' } : {})}
            {...(marcaDepois ? { 'data-insercao': 'depois' } : {})}
            onDragOver={(e) => sobrevoar(e, indice)}
            onDragEnter={(e) => sobrevoar(e, indice)}
            onDrop={soltar}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.id); // botão do meio fecha
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(MIME_DE_ARRASTE, codificarCarga({ tipo: 'aba', id: tab.id }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            title={tab.title}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pl: 1.25,
              pr: 1,
              py: 0.75,
              maxWidth: 220,
              borderRight: 1,
              borderColor: 'divider',
              borderTop: '2px solid',
              borderTopColor: ativa ? 'primary.main' : 'transparent',
              bgcolor: ativa ? tokens.bgEditor : 'transparent',
              color: ativa ? 'text.primary' : 'text.secondary',
              // `boxShadow`, e não borda: uma borda mudaria a largura da aba e a
              // fila dançaria sob o cursor de quem está mirando.
              boxShadow: (t) =>
                marcaAntes
                  ? `inset 2px 0 0 0 ${t.palette.primary.main}`
                  : marcaDepois
                    ? `inset -2px 0 0 0 ${t.palette.primary.main}`
                    : 'none',
              cursor: 'pointer',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              // **O Chromium não dispara `drop` quando o ponto cai sobre um
              // `<svg>`.** O `dragover` dispara, o indicador acende, e soltar
              // não faz nada — o defeito mais confuso possível. Aparecia só na
              // primeira aba, que é a mais estreita: um quinto da largura dela
              // cai bem no ícone. Tirar o ícone da conta de acerto resolve, e
              // não custa nada: quem clica numa aba mira a aba, não o desenho.
              '& svg': { pointerEvents: 'none' },
              '&:hover': { bgcolor: ativa ? tokens.bgEditor : 'background.default' },
              '&:hover .aba-fechar': { opacity: 1 },
              '&:hover .aba-ponto': { display: 'none' },
              '&:hover .aba-x': { display: 'block' },
            }}
          >
            <Icon name={tab.icon ?? tab.type} size={12} />

            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}
            >
              {tab.title}
            </Box>

            <Box
              className="aba-fechar"
              component="button"
              type="button"
              title="Fechar"
              // O nome precisa dizer QUAL aba: com várias abertas, "Fechar"
              // repetido não distingue nada para quem navega pelo teclado.
              aria-label={`Fechar ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation(); // não ativar a aba ao fechá-la
                onClose(tab.id);
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                p: 0,
                border: 'none',
                borderRadius: '3px',
                bgcolor: 'transparent',
                color: tab.dirty ? 'primary.main' : 'inherit',
                opacity: tab.dirty ? 1 : 0.55,
                cursor: 'pointer',
                flexShrink: 0,
                '&:hover': { bgcolor: 'divider', opacity: 1 },
              }}
            >
              {tab.dirty ? (
                <>
                  <Box className="aba-ponto" component="span" sx={{ fontSize: 14, lineHeight: 1 }}>
                    ●
                  </Box>
                  <Box className="aba-x" sx={{ display: 'none' }}>
                    <Icon name="lucide:x" size={12} />
                  </Box>
                </>
              ) : (
                <Icon name="lucide:x" size={12} />
              )}
            </Box>
          </Box>
        );
      })}

      {onExecutar !== undefined && (
        <Box
          component="button"
          type="button"
          onClick={onExecutar}
          title={ehSql ? 'Executar consulta (Ctrl+Enter)' : 'Executar arquivo (Ctrl+Enter)'}
          aria-label={ehSql ? 'Executar consulta' : 'Executar arquivo'}
          sx={{
            // `auto` SEMPRE. Era condicional ao preview não existir, e com os
            // dois na tela nenhum ganhava o empurrão: eles grudavam no fim das
            // abas, no meio da barra. Ele mandou o print.
            ml: 'auto',
            border: 0, bgcolor: 'transparent', cursor: 'pointer',
            color: 'success.main', px: 1.25, display: 'flex', alignItems: 'center',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name="lucide:play" size={13} />
        </Box>
      )}
    </Box>
  );
}
