// O formulário de conexão, quando ele é a aba ativa.
//
// Saiu do `App` na spec 081, quando o arquivo chegou a duas linhas do teto do
// Artigo IV. É um bloco coeso — montar o formulário exige conhecer os drivers, e
// mais nada do `App` participa disso.
import { ConnectionForm } from './ConnectionForm';
import type { ConnectionsController } from './useConnections';
import type { Workspace } from '../useWorkspace';

export interface FormularioDaAbaProps {
  readonly ws: Workspace;
  readonly conexoes: ConnectionsController;
}

/** `null` quando a aba ativa não é de conexão. */
export function FormularioDaAba({ ws, conexoes }: FormularioDaAbaProps) {
  const aba = ws.active;
  if (aba?.type !== 'conexao') return null;
  const abaId = aba.id;

  return (
    <ConnectionForm
      // Remonta ao trocar de conexão: o formulário guarda estado próprio, e
      // reaproveitar a instância misturaria os campos de duas conexões.
      key={abaId}
      drivers={[...conexoes.drivers.values()]}
      gruposConhecidos={conexoes.grupos}
      conexao={conexoes.acharConexao(aba.meta.connectionId)}
      grupoInicial={typeof aba.meta.grupoInicial === 'string' ? aba.meta.grupoInicial : ''}
      onSujar={(sujo) => ws.marcarAbaSuja(abaId, sujo)}
      onCancelar={() => ws.fechar(abaId)}
      onSalvar={async (input, conectar) => {
        const id = aba.meta.connectionId;
        await conexoes.salvarConexao(input, typeof id === 'string' ? id : null, conectar);
        ws.marcarAbaSuja(abaId, false);
        ws.fechar(abaId);
      }}
    />
  );
}
