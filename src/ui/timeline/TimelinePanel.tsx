// O Timeline: versões locais do arquivo aberto (T010).
//
// A nota dele define o item: *"versões locais com data, comparar e restaurar,
// **sem depender do git**"*. Um arquivo fora de repositório tem tanto direito a
// histórico quanto um dentro — e é nele que perder trabalho dói mais, porque
// não há `git checkout` que salve.
//
// **Restaurar não grava em disco.** Ele põe a versão no EDITOR, e a aba fica
// suja: quem decide se aquilo vira o arquivo é ele, com `Ctrl+S`. Gravar direto
// transformaria "quero ver como estava" em "perdi o que eu tinha agora".
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { Api } from '../api';
import { quandoEmPalavras, tamanhoEmPalavras } from '../../shared/historico-local';
import type { VersaoLocal } from '../../shared/historico-local';

export interface TimelinePanelProps {
  /** O arquivo em foco. `null` = nenhuma aba de arquivo aberta. */
  readonly caminho: string | null;
  /** Muda quando o arquivo é salvo — é o que faz a lista se atualizar sozinha. */
  readonly versao: number;
  /** Põe a versão no editor, deixando a aba suja (ver a nota do cabeçalho). */
  onRestaurar(caminho: string, conteudo: string): void;
  /** Abre a versão numa aba só de leitura, para comparar lado a lado. */
  onAbrirParaComparar(caminho: string, quando: number, conteudo: string): void;
  onErro(erro: unknown): void;
}

export function TimelinePanel({
  caminho, versao, onRestaurar, onAbrirParaComparar, onErro,
}: TimelinePanelProps) {
  const [versoes, setVersoes] = useState<readonly VersaoLocal[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (caminho === null) {
      setVersoes([]);
      return;
    }
    let vivo = true;
    setCarregando(true);
    Api.historico(caminho)
      .then((v) => {
        if (vivo) setVersoes(v);
      })
      .catch(onErro)
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [caminho, versao, onErro]);

  const comTexto = useCallback(
    async (id: string, o: (conteudo: string, quando: number) => void): Promise<void> => {
      if (caminho === null) return;
      try {
        const v = await Api.versaoDoHistorico(caminho, id);
        o(v.conteudo, v.quando);
      } catch (e) {
        onErro(e);
      }
    },
    [caminho, onErro]
  );

  if (caminho === null) {
    return (
      <Box sx={{ px: 1.25, py: 1, fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}>
        Abra um arquivo para ver as versões locais dele.
      </Box>
    );
  }

  return (
    <Box data-timeline sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      {versoes.length === 0 && !carregando && (
        <Box sx={{ px: 1.25, py: 1, fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}>
          Nenhuma versão ainda. A IDE guarda uma a cada vez que você salva —
          sem depender do git.
        </Box>
      )}

      {versoes.map((v) => (
        <Box
          key={v.id}
          data-versao={v.origem}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5,
            fontSize: 11.5, borderBottom: 1, borderColor: 'divider',
            '& .acoes-da-versao': { opacity: 0, transition: 'opacity 120ms' },
            '&:hover .acoes-da-versao': { opacity: 1 },
          }}
        >
          <Box
            sx={{ color: v.origem === 'rascunho' ? 'warning.main' : 'text.secondary', display: 'flex' }}
            title={
              v.origem === 'rascunho'
                ? 'Trabalho que não chegou a ser salvo'
                : 'Versão gravada ao salvar'
            }
          >
            <Icon name={v.origem === 'rascunho' ? 'lucide:circle-alert' : 'lucide:history'} size={13} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Box>{quandoEmPalavras(v.quando)}</Box>
              {v.origem === 'rascunho' && (
                <Box sx={{ fontSize: 10, color: 'warning.main' }}>rascunho</Box>
              )}
            </Box>
            <Box sx={{ fontSize: 10, color: 'text.secondary' }}>
              {new Date(v.quando).toLocaleString()} · {tamanhoEmPalavras(v.bytes)}
            </Box>
          </Box>

          <Box className="acoes-da-versao" sx={{ display: 'flex', gap: 0.25 }}>
            <BotaoDaVersao
              rotulo="Ver esta versão"
              icone="lucide:eye"
              aoClicar={() =>
                void comTexto(v.id, (conteudo, quando) =>
                  onAbrirParaComparar(caminho, quando, conteudo)
                )
              }
            />
            <BotaoDaVersao
              rotulo="Trazer para o editor"
              icone="lucide:corner-down-left"
              aoClicar={() => void comTexto(v.id, (conteudo) => onRestaurar(caminho, conteudo))}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function BotaoDaVersao({
  rotulo, icone, aoClicar,
}: {
  readonly rotulo: string;
  readonly icone: string;
  aoClicar(): void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={aoClicar}
      sx={{
        border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer',
        p: 0.3, borderRadius: 0.5, display: 'flex',
        '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
      }}
    >
      <Icon name={icone} size={13} />
    </Box>
  );
}
