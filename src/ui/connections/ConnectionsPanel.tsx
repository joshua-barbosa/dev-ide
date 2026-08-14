// Painel Database ou Service.
//
// O mesmo componente, montado duas vezes com um `painel` diferente. Quem decide
// onde cada serviço aparece é o driver, pelo campo `panel` — não dá para
// derivar do protocolo, já que Redis é chave-valor e Pinecone é vetorial, mas
// os dois são armazenamento e vão para Database.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
}

export function ConnectionsPanel({
  painel,
  ctrl,
  onMenuNo,
  onMenuConexao,
  onAbrirQuery,
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
    acao().catch((e: Error) => window.alert(e.message));
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
          icone={viva ? 'lucide:plug' : (driver?.icon ?? 'connection')}
          detalhe={conexao.readOnly ? 'RO' : undefined}
          titulo={`${conexao.type}${conexao.fields.host === undefined ? '' : ` · ${String(conexao.fields.host)}`}`}
          expansivel
          aberto={aberto}
          ativo={viva}
          onClick={comErro(() => ctrl.abrirConexao(conexao))}
          onContextMenu={(e) => onMenuConexao(e, conexao)}
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
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          px: 0.75,
          pb: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
      >
        {!vault.exists && (
          <Button onClick={comErro(ctrl.criarCofre)} startIcon={<Icon name="lucide:lock" size={12} />}>
            Criar cofre
          </Button>
        )}
        {vault.exists && !vault.unlocked && (
          <Button onClick={comErro(ctrl.destrancar)} startIcon={<Icon name="lucide:unlock" size={12} />}>
            Destrancar
          </Button>
        )}
        {vault.unlocked && (
          <>
            <Button
              onClick={() => window.alert('Formulário de conexão — próxima spec.')}
              startIcon={<Icon name="lucide:plus" size={12} />}
            >
              conexão
            </Button>
            <Button onClick={comErro(ctrl.recarregar)} title="Recarregar">
              <Icon name="lucide:refresh-cw" size={12} />
            </Button>
            <Button onClick={comErro(ctrl.trancar)} title="Trancar o cofre (fecha as sessões)">
              <Icon name="lucide:lock" size={12} />
            </Button>
          </>
        )}
      </Box>

      {vault.exists && !vault.unlocked && (
        <Box sx={{ px: 1.25, py: 1, color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
          🔒 Cofre trancado — clicar numa conexão pede a senha mestra.
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
