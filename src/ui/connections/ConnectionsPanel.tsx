// Painel Database ou Service.
//
// O mesmo componente, montado duas vezes com um `painel` diferente. Quem decide
// onde cada serviço aparece é o driver, pelo campo `panel` — não dá para
// derivar do protocolo, já que Redis é chave-valor e Pinecone é vetorial, mas
// os dois são armazenamento e vão para Database.
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { DriverPanel, GroupNode, PublicConnection, TreeNode } from '../../shared/contracts';
import { Icon } from '../Icon';
import { TreeRow } from '../tree/TreeRow';
import type { ConnectionsController } from './useConnections';

export interface ConnectionsPanelProps {
  readonly painel: DriverPanel;
  readonly ctrl: ConnectionsController;
  readonly onMenuNo: (e: React.MouseEvent, id: string, caminho: string[], no: TreeNode) => void;
  readonly onMenuConexao: (e: React.MouseEvent, conexao: PublicConnection) => void;
  readonly onAbrirQuery: (id: string, no: TreeNode) => void;
  /** Recebe o grupo quando vem do botão de uma pasta, para já vir preenchido. */
  readonly onNovaConexao: (grupo?: string) => void;
  readonly onRenomearGrupo: (caminho: string) => void;
  readonly onErro: (erro: unknown) => void;
}

/** Botão de ação do cabeçalho: só ícone, com dica. */
function AcaoDoPainel({
  icone, rotulo, onClick, desabilitada = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    <Tooltip title={rotulo} placement="bottom">
      {/* O `span` existe porque um botão desabilitado não dispara eventos, e sem
          ele a dica sumiria justo quando explica por que a ação não está ativa. */}
      <Box component="span" sx={{ display: 'flex' }}>
        <IconButton
          size="small"
          disabled={desabilitada}
          onClick={onClick}
          aria-label={rotulo}
          sx={{ p: 0.5, borderRadius: 0.5 }}
        >
          <Icon name={icone} size={13} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

/** Ação que aparece na linha da árvore ao passar o mouse. */
function AcaoDaLinha({
  icone, rotulo, onClick,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip title={rotulo} placement="bottom">
      <IconButton
        size="small"
        aria-label={rotulo}
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

/** Data curta e local — o horário exato não ajuda em nada aqui. */
function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function ConnectionsPanel({
  painel,
  ctrl,
  onMenuNo,
  onMenuConexao,
  onAbrirQuery,
  onNovaConexao,
  onRenomearGrupo,
  onErro,
}: ConnectionsPanelProps) {
  const aceita = (tipo: string): boolean => {
    const driver = ctrl.drivers.get(tipo);
    // Tipo desconhecido (driver removido, conexão antiga) cai em Service, para
    // a conexão continuar visível em vez de sumir sem explicação.
    return (driver?.panel ?? 'service') === painel;
  };

  /**
   * Um grupo só aparece se houver, nele ou abaixo, conexão deste painel — sem
   * isso, "ACME" apareceria vazio no Service só porque tem bancos dentro.
   */
  const temConteudo = (grupo: GroupNode): boolean =>
    grupo.connections.some((c) => aceita(c.type)) || grupo.groups.some(temConteudo);

  const comErro = (acao: () => Promise<void>) => () => {
    acao().catch(onErro);
  };

  const renderNos = (id: string, caminho: string[], nivel: number): React.ReactNode => {
    const chave = ctrl.chaveDe(id, caminho);
    const nos = ctrl.filhos.get(chave);

    if (nos === undefined) {
      return (
        <TreeRow
          nivel={nivel}
          rotulo={ctrl.carregando.has(chave) ? 'carregando…' : '…'}
          icone="lucide:circle"
          esmaecido
        />
      );
    }
    if (nos.length === 0) {
      return <TreeRow nivel={nivel} rotulo="(vazio)" icone="lucide:circle" esmaecido />;
    }

    return nos.map((no) => {
      const filho = [...caminho, no.id];
      const aberto = ctrl.expandidos.has(`no:${ctrl.chaveDe(id, filho)}`);
      return (
        <Box key={no.id}>
          <TreeRow
            nivel={nivel}
            rotulo={no.label}
            icone={no.icon}
            detalhe={no.detail}
            expansivel={no.hasChildren}
            aberto={aberto}
            titulo={no.hasChildren ? undefined : 'Clique duplo abre uma query'}
            onClick={
              no.hasChildren ? comErro(() => ctrl.alternarNo(id, filho)) : () => onAbrirQuery(id, no)
            }
            onDoubleClick={() => onAbrirQuery(id, no)}
            onContextMenu={(e) => onMenuNo(e, id, filho, no)}
          />
          {aberto && renderNos(id, filho, nivel + 1)}
        </Box>
      );
    });
  };

  const renderConexao = (conexao: PublicConnection, nivel: number): React.ReactNode => {
    const aberto = ctrl.expandidos.has(`conn:${conexao.id}`);
    const viva = ctrl.estado?.openIds.includes(conexao.id) === true;
    const driver = ctrl.drivers.get(conexao.type);

    return (
      <Box key={conexao.id}>
        <TreeRow
          nivel={nivel}
          rotulo={conexao.label}
          icone={driver?.icon ?? 'connection'}
          conectado={viva}
          detalhe={conexao.readOnly ? 'RO' : undefined}
          titulo={`${conexao.type}${conexao.fields.host === undefined ? '' : ` · ${String(conexao.fields.host)}`}`}
          expansivel
          aberto={aberto}
          ativo={viva}
          onClick={comErro(() => ctrl.abrirConexao(conexao))}
          onContextMenu={(e) => onMenuConexao(e, conexao)}
          acoes={
            <>
              <AcaoDaLinha
                icone="lucide:refresh-cw"
                rotulo="Recarregar metadados"
                onClick={comErro(() => ctrl.recarregarMetadados(conexao.id))}
              />
              <AcaoDaLinha
                icone="lucide:trash-2"
                rotulo="Excluir conexão"
                onClick={comErro(() => ctrl.excluir(conexao))}
              />
            </>
          }
        />
        {aberto && renderNos(conexao.id, [], nivel + 1)}
      </Box>
    );
  };

  const renderGrupo = (grupo: GroupNode, nivel: number): React.ReactNode => (
    <>
      {grupo.groups.filter(temConteudo).map((sub) => {
        const aberto = ctrl.expandidos.has(`grupo:${sub.path}`);
        return (
          <Box key={sub.path}>
            <TreeRow
              nivel={nivel}
              rotulo={sub.name}
              icone="folder"
              expansivel
              aberto={aberto}
              onClick={() => ctrl.alternarGrupo(sub.path)}
              acoes={
                <>
                  <AcaoDaLinha
                    icone="lucide:pencil"
                    rotulo={`Renomear "${sub.name}"`}
                    onClick={() => onRenomearGrupo(sub.path)}
                  />
                  <AcaoDaLinha
                    icone="lucide:plus"
                    rotulo={`Nova conexão em "${sub.path}"`}
                    onClick={() => onNovaConexao(sub.path)}
                  />
                </>
              }
            />
            {aberto && renderGrupo(sub, nivel + 1)}
          </Box>
        );
      })}
      {grupo.connections.filter((c) => aceita(c.type)).map((c) => renderConexao(c, nivel))}
    </>
  );

  if (ctrl.erro !== null) {
    return <Box sx={{ p: 1.25, color: 'error.main', fontSize: 11 }}>{ctrl.erro}</Box>;
  }
  if (ctrl.estado === null) {
    return <Box sx={{ p: 1.25, color: 'text.secondary', fontSize: 11 }}>carregando…</Box>;
  }

  const { vault, tree } = ctrl.estado;
  const visiveis = tree.groups.filter(temConteudo).length + tree.connections.filter((c) => aceita(c.type)).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Cabeçalho no padrão do VS Code: título à esquerda, ações só de ícone à
          direita. Ação indisponível fica desabilitada em vez de sumir — some o
          "pisca-pisca" de botões aparecendo e desaparecendo conforme o cofre. */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.25,
          px: 1, pb: 0.5, borderBottom: 1, borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            flex: 1, minWidth: 0, fontSize: 11, letterSpacing: 0.5,
            textTransform: 'uppercase', color: 'text.secondary',
          }}
        >
          {painel === 'database' ? 'Database' : 'Service'}
        </Box>

        <AcaoDoPainel
          icone="lucide:refresh-cw"
          rotulo="Recarregar"
          desabilitada={!vault.exists}
          onClick={comErro(ctrl.recarregar)}
        />
        <AcaoDoPainel
          icone="lucide:chevrons-down-up"
          rotulo="Recolher tudo"
          desabilitada={!vault.unlocked}
          onClick={() => ctrl.recolherTudo()}
        />
        <AcaoDoPainel
          icone="lucide:plus"
          rotulo="Nova conexão"
          desabilitada={!vault.unlocked}
          onClick={onNovaConexao}
        />
        <AcaoDoPainel
          icone={vault.unlocked ? 'lucide:lock' : 'lucide:unlock'}
          rotulo={
            !vault.exists
              ? 'Criar cofre'
              : vault.unlocked
                ? 'Trancar o cofre (fecha as sessões)'
                : 'Destrancar o cofre'
          }
          onClick={comErro(
            !vault.exists ? ctrl.criarCofre : vault.unlocked ? ctrl.trancar : ctrl.destrancar
          )}
        />
      </Box>


      {vault.exists && !vault.unlocked && (
        <Box sx={{ px: 1.25, py: 1, color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
          🔒 Cofre trancado — clicar numa conexão pede a senha mestra.
        </Box>
      )}
      {vault.unlocked && vault.rememberedUntil !== null && (
        // Avisar antes é o que impede o vencimento de chegar como surpresa.
        <Box sx={{ px: 1.25, py: 0.75, color: 'text.secondary', fontSize: 11 }}>
          Destrancamento lembrado até {formatarData(vault.rememberedUntil)}.
        </Box>
      )}
      {!vault.exists && (
        <Box sx={{ px: 1.25, py: 1, color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
          Nenhum cofre ainda. Crie um para guardar credenciais cifradas.
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {visiveis === 0 && vault.exists ? (
          <Box sx={{ px: 1.25, py: 1, color: 'text.secondary', fontSize: 11 }}>
            Nenhuma conexão deste tipo.
          </Box>
        ) : (
          renderGrupo(tree, 0)
        )}
      </Box>
    </Box>
  );
}
