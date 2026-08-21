// Liga uma ABA de tabela ao gancho que busca as páginas (spec 041).
//
// Existe como componente próprio porque o gancho `useTabela` é um hook, e hook
// não pode ser chamado dentro de um `map`. Com uma aba de tabela por instância,
// cada uma guarda a sua página, a sua ordenação e os seus filtros — que é
// exatamente o que se perderia se elas dividissem um gancho só.
import { TablePanel } from './TablePanel';
import { useTabela } from './useTabela';
import type { Tab } from '../../shared/tabs';

export interface TabelaHostProps {
  readonly aba: Tab;
  readonly onExportar: (conteudo: string, linguagem: string) => void;
}

export function TabelaHost({ aba, onExportar }: TabelaHostProps) {
  const meta = aba.meta as { connectionId?: string; nodePath?: readonly string[] };
  const estado = useTabela({
    connectionId: meta.connectionId ?? '',
    nodePath: meta.nodePath ?? [],
  });
  return <TablePanel estado={estado} titulo={aba.title} onExportar={onExportar} />;
}
