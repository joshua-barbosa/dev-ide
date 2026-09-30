// Os databases de uma conexão, para o seletor de vínculo.
//
// Onde eles moram depende do driver: MySQL e PostgreSQL penduram os databases
// num nó `server`; o SQLite traz o `main` direto na RAIZ. Os DOIS seletores (o
// da IDE, em `useVinculo`, e o da extensão, em `acoes.ts`) só olhavam `server`,
// e com SQLite diziam que não havia database nenhum — achado pela guarda do
// notebook (spec 112). Eram cópias da mesma lógica: por isso o defeito existia
// duas vezes, e por isso agora a lógica mora num lugar só.
//
// A lista vem do DRIVER, viva — não de um cache nosso, que ficaria velho no dia
// em que alguém criasse um banco.
import { Api } from '../api';
import type { TreeNode } from '../../shared/contracts';

const temBanco = (n: TreeNode): boolean => typeof n.meta?.database === 'string';

export async function bancosDaConexao(connectionId: string): Promise<readonly TreeNode[]> {
  const doServidor = (await Api.children(connectionId, ['server'])).filter(temBanco);
  if (doServidor.length > 0) return doServidor;
  return (await Api.children(connectionId, [])).filter(temBanco);
}
