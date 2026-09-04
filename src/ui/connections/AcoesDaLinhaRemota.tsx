// A barra de ações de um nó da árvore remota (spec 053, AC-7 e AC-8).
//
// Saiu do `ConnectionsPanel` quando o portão do Artigo IV pegou o arquivo em
// 810 linhas. É um bloco coeso: pasta e arquivo oferecem coisas diferentes, e
// nada mais do painel participa dessa decisão.
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import type { TreeNode } from '../../shared/contracts';
import { Icon } from '../Icon';
import { noRemotoDe, type NoRemoto as NoRemotoDaLinha } from '../acoes/useAcoesRemotas';

/** Ação que aparece na linha da árvore ao passar o mouse. */
export 
function AcaoDaLinha({
  icone, rotulo, onClick, ativa = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  /** Destaca a ação quando ela está em vigor — hoje, só o filtro. */
  readonly ativa?: boolean;
}) {
  return (
    <Tooltip title={rotulo} placement="bottom">
      <IconButton
        size="small"
        aria-label={rotulo}
        aria-pressed={ativa}
        color={ativa ? 'primary' : 'default'}
        onClick={(e) => {
          // Sem isto, o clique também abriria ou fecharia a pasta.
          e.stopPropagation();
          onClick();
        }}
        sx={{ p: 0.25, borderRadius: 0.5 }}
      >
        <Icon name={icone} size={12} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * A barra de ações de um nó da árvore remota (spec 053, AC-7 e AC-8).
 *
 * Pasta e arquivo oferecem coisas diferentes, e é isso que o print do usuário
 * mostra: pasta tem recarregar; arquivo executável tem executar. O que escreve
 * some com a conexão trancada — a trava de valer está na rota.
 */
export function AcoesDoNoRemoto({
  conexaoId, no, trancada, acoes, onRecarregar, aoFalhar,
}: {
  readonly conexaoId: string;
  readonly no: TreeNode;
  readonly trancada: boolean;
  readonly acoes: {
    favoritar(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
    baixar(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
    executarScript(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
  };
  readonly onRecarregar: () => void;
  readonly aoFalhar: (erro: unknown) => void;
}) {
  const remoto = noRemotoDe(no);
  if (remoto === null) return null;

  /**
   * A ação só acontece no CLIQUE.
   *
   * A primeira versão recebia a promessa pronta — `chamar(acoes.favoritar(...))`
   * —, e isso a executava **a cada renderização**: favoritar, baixar e até
   * EXECUTAR O SCRIPT rodavam sozinhos, e cada um provocava a renderização
   * seguinte. A árvore nunca parava de piscar. O que se passa aqui é a função,
   * nunca o resultado dela.
   */
  const chamar = (acao: () => Promise<unknown>) => () => {
    acao().catch(aoFalhar);
  };

  return (
    <>
      {remoto.kind !== 'file' && (
        <AcaoDaLinha
          icone="lucide:refresh-cw"
          rotulo={`Recarregar ${no.label}`}
          onClick={onRecarregar}
        />
      )}
      <AcaoDaLinha
        icone="lucide:star"
        rotulo={`Favoritar ${no.label}`}
        onClick={chamar(() => acoes.favoritar(conexaoId, remoto))}
      />
      {remoto.kind === 'file' && (
        <AcaoDaLinha
          icone="lucide:download"
          rotulo={`Baixar ${no.label}`}
          onClick={chamar(() => acoes.baixar(conexaoId, remoto))}
        />
      )}
      {remoto.executable && !trancada && (
        <AcaoDaLinha
          icone="lucide:play"
          rotulo={`Executar ${no.label} no servidor`}
          onClick={chamar(() => acoes.executarScript(conexaoId, remoto))}
        />
      )}
    </>
  );
}
