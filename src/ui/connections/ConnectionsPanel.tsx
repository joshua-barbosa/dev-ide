// Painel Database ou Service.
//
// O mesmo componente, montado duas vezes com um `painel` diferente. Quem decide
// onde cada serviço aparece é o driver, pelo campo `panel` — não dá para
// derivar do protocolo, já que Redis é chave-valor e Pinecone é vetorial, mas
// os dois são armazenamento e vão para Database.
import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { DriverPanel, GroupNode, PublicConnection, TreeNode } from '../../shared/contracts';
import { Api } from '../api';
import { noRemotoDe, type NoRemoto as NoRemotoDaLinha } from '../acoes/useAcoesRemotas';
import type { Vinculo } from '../../shared/sql/vinculo';
import { Icon } from '../Icon';
import { AcaoDoImportar } from './AcaoDoImportar';
import { AcaoDoPainel } from './AcaoDoPainel';
import { TreeRow } from '../tree/TreeRow';
import { DialogoDeFiltro, type PedidoDeFiltro } from './DialogoDeFiltro';
import { DialogoDeCriacao, type PedidoDeCriacao } from './DialogoDeCriacao';
import type { Criterio } from '../../shared/tree/filtro-da-arvore';
import type { ConnectionsController } from './useConnections';

export interface ConnectionsPanelProps {
  readonly painel: DriverPanel;
  /** Abre um arquivo que mora no servidor (spec 053). */
  onAbrirArquivoRemoto(conexaoId: string, caminho: string): Promise<void>;
  /** Abre a aba do servidor, com as sub-abas (spec 055). */
  onAbrirServidor(conexao: PublicConnection): void;
  /** As ações de passar o mouse num nó remoto (spec 053). */
  acoesRemotas: {
    favoritar(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
    baixar(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
    executarScript(conexaoId: string, remoto: NoRemotoDaLinha): Promise<void>;
  };
  somenteLeitura(conexaoId: string): boolean;
  readonly ctrl: ConnectionsController;
  readonly onMenuNo: (
    e: React.MouseEvent,
    id: string,
    caminho: string[],
    no: TreeNode,
    database: string | null
  ) => void;
  readonly onMenuConexao: (e: React.MouseEvent, conexao: PublicConnection) => void;
  readonly onAbrirQuery: (id: string, no: TreeNode, database: string | null) => void;
  /** Abre a aba de uma CHAVE de chave-valor (spec 089). */
  readonly onAbrirChave: (id: string, chave: string) => void;
  /** Recebe o grupo quando vem do botão de uma pasta, para já vir preenchido. */
  readonly onNovaConexao: (grupo?: string) => void;
  readonly onRenomearGrupo: (caminho: string) => void;
  readonly onAbrirTerminal: (conexao: PublicConnection) => void;
  /** Desenha o diagrama ER daquele schema (T064). */
  readonly onDiagramaEr: (id: string, caminho: readonly string[], rotulo: string) => Promise<void>;
  readonly onNovoObjeto: (
    id: string,
    caminho: readonly string[],
    nomeBase: string,
    sql: string,
    database: string | null
  ) => void;
  // ---- Arquivos de query (spec 038) ----
  readonly onAbrirQueryDoDatabase: (connectionId: string, no: TreeNode) => Promise<void>;
  readonly onAbrirTabela: (
    connectionId: string,
    nodePath: readonly string[],
    titulo: string,
    database: string | null
  ) => Promise<void>;
  readonly onAbrirArquivoDeQuery: (no: TreeNode) => Promise<void>;
  readonly onNovaQuery: (vinculo: Vinculo | null) => Promise<void>;
  readonly onRenomearQuery: (vinculo: Vinculo | null, no: TreeNode) => Promise<void>;
  readonly onApagarQuery: (vinculo: Vinculo | null, no: TreeNode) => Promise<void>;
  readonly onErro: (erro: unknown) => void;
  /** Pergunta antes de aplicar — a importação mostra o plano primeiro (N001). */
  readonly confirmar: (o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
  }) => Promise<boolean>;
  readonly avisar: (mensagem: string, titulo?: string) => Promise<void>;
}

/** O vínculo do nó `Query`, que carrega o database no `meta`. */
function vinculoDoNo(connectionId: string, no: TreeNode): Vinculo | null {
  const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
  return database === null ? null : { connectionId, database };
}

/**
 * O vínculo de um ARQUIVO, lido do caminho da árvore.
 *
 * O nó do arquivo não carrega o database — quem carrega é a pasta `Query` acima
 * dele, e o caminho da árvore é `[server, <database>, __queries__]`. Pegar dali
 * evita repetir o database em cada arquivo listado.
 */
function vinculoDaPasta(connectionId: string, caminho: readonly string[]): Vinculo | null {
  const database = caminho[caminho.length - 2];
  return database === undefined ? null : { connectionId, database };
}

/** Ação que aparece na linha da árvore ao passar o mouse. */
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

/** Data curta e local — o horário exato não ajuda em nada aqui. */
function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * O que este nó declara que sabe filtrar.
 *
 * Nó sem declaração cai em "só nome", que é o que a árvore sempre soube fazer —
 * um driver antigo continua funcionando sem ganhar campos que ele ignoraria.
 */
function criteriosDoNo(no: TreeNode): readonly Criterio[] {
  const bruto = no.meta?.criterios;
  if (!Array.isArray(bruto)) return ['nome'];
  const validos = bruto.filter((c): c is Criterio =>
    c === 'nome' || c === 'dono' || c === 'tamanho' || c === 'data'
  );
  return validos.length === 0 ? ['nome'] : validos;
}

export function ConnectionsPanel({
  painel,
  ctrl,
  onMenuNo,
  onMenuConexao,
  onAbrirQuery,
  onAbrirChave,
  onNovaConexao,
  onRenomearGrupo,
  onAbrirTerminal,
  onDiagramaEr,
  onNovoObjeto,
  onAbrirQueryDoDatabase,
  onAbrirTabela,
  onAbrirArquivoDeQuery,
  onAbrirArquivoRemoto,
  onAbrirServidor,
  acoesRemotas,
  somenteLeitura,
  onNovaQuery,
  onRenomearQuery,
  onApagarQuery,
  onErro, confirmar, avisar,}: ConnectionsPanelProps) {
  // O diálogo do filtro mora AQUI, e não no `App`: a lateral não é desmontada
  // ao trocar de painel (a emenda do `display: none`), então ele sobrevive ao
  // mesmo gesto que o diálogo do cofre precisou sair de dentro para sobreviver.
  const [pedidoDeFiltro, setPedidoDeFiltro] = useState<PedidoDeFiltro | null>(null);
  const [pedidoDeCriacao, setPedidoDeCriacao] = useState<PedidoDeCriacao | null>(null);

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

  /**
   * @param database O database declarado por um ancestral, herdado subárvore
   * abaixo. É o que faz uma tabela saber em que banco ela vive sem que a
   * interface precise conhecer a forma do caminho de cada driver — que difere:
   * `[main, ...]` no SQLite, `[server, servidor-2, ...]` no MySQL.
   */
  const renderNos = (
    id: string,
    caminho: string[],
    nivel: number,
    database: string | null = null
  ): React.ReactNode => {
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
      const bancoAqui = typeof no.meta?.database === 'string' ? no.meta.database : database;
      return (
        <Box key={no.id}>
          <TreeRow
            nivel={nivel}
            rotulo={no.label}
            icone={no.icon}
            detalhe={no.detail}
            expansivel={no.hasChildren}
            aberto={aberto}
            // O nó remoto traz o próprio tooltip: datas, permissão e dono
            // (spec 052, AC-10). Onde ele existe, manda — dizer "clique duplo
            // abre uma query" sobre um arquivo de servidor seria mentira.
            titulo={
              typeof no.meta?.tooltip === 'string'
                ? no.meta.tooltip
                : no.hasChildren
                  ? undefined
                  : 'Clique duplo abre uma query'
            }
            onClick={
              // O arquivo de query abre no editor; o resto segue como antes.
              no.meta?.arquivoDeQuery === true
                ? comErro(() => onAbrirArquivoDeQuery(no))
                : no.hasChildren
                  ? comErro(() => ctrl.alternarNo(id, filho, no))
                  : typeof no.meta?.remotePath === 'string'
                    ? // Arquivo do SERVIDOR (spec 053): um clique abre, como na
                      // árvore de arquivos local. Não há query para montar aqui.
                      comErro(() => onAbrirArquivoRemoto(id, String(no.meta?.remotePath)))
                    : no.meta?.atalho !== undefined
                      ? // `Users` e `Favorites` são atalhos da própria IDE
                        // (spec 052): não são objeto de banco, e clicar neles
                        // chegou a abrir `SELECT * FROM Favorites` — visto no
                        // navegador.
                        comErro(() => ctrl.alternarNo(id, filho, no))
                      // **Uma CHAVE não abre uma query** (spec 089): num banco
                      // de chave-valor, `SELECT * FROM` não é uma consulta
                      // ruim — é impossível. Quem diz que o nó é uma chave é o
                      // driver, pelo `meta.chave`; a tela só obedece.
                      : typeof no.meta?.chave === 'string'
                        ? () => onAbrirChave(id, String(no.meta?.chave))
                        : () => onAbrirQuery(id, no, bancoAqui)
            }
            // O duplo clique continua abrindo a QUERY, como desde a spec 009.
            // Chegou a abrir a aba de tabela durante a spec 041, e foi um passo
            // além do que o usuário pediu: as anotações dele descrevem o ÍCONE
            // da linha, não o duplo clique. Trocar um gesto que ele já tem na
            // mão precisa ser decisão dele, não efeito colateral.
            onDoubleClick={
              no.meta?.arquivoDeQuery === true ||
              typeof no.meta?.remotePath === 'string' ||
              typeof no.meta?.chave === 'string' ||
              no.meta?.atalho !== undefined
                ? undefined
                : () => onAbrirQuery(id, no, bancoAqui)
            }
            onContextMenu={(e) => onMenuNo(e, id, filho, no, bancoAqui)}
            acoes={
              // Só nas categorias: bancos e schemas já são controlados pelos
              // campos "Bancos visíveis" e "excluídos" da conexão.
              // A categoria `Query` tem ações próprias: nela se CRIA arquivo, e
              // não objeto de banco. Filtrar não faz sentido numa pasta com
              // meia dúzia de arquivos.
              // Nó do SERVIDOR (spec 053): recarregar, favoritar, baixar, e
              // executar quando o arquivo tem o bit. É a barra do print dele.
              noRemotoDe(no) !== null ? (
                <AcoesDoNoRemoto
                  conexaoId={id}
                  no={no}
                  trancada={somenteLeitura(id)}
                  acoes={acoesRemotas}
                  onRecarregar={comErro(() => ctrl.recarregarNo(id, filho))}
                  aoFalhar={onErro}
                />
              ) : no.meta?.queries === true ? (
                <AcaoDaLinha
                  icone="lucide:plus"
                  rotulo="Nova query — SQL ou Query Book"
                  // `recarregarNo` e não `recarregar`: o segundo recarrega a
                  // lista de CONEXÕES, e os arquivos são filhos deste nó. Sem
                  // isto o arquivo novo só aparecia no F5 seguinte.
                  onClick={comErro(async () => {
                    await onNovaQuery(vinculoDoNo(id, no));
                    await ctrl.recarregarNo(id, filho);
                  })}
                />
              ) : no.meta?.arquivoDeQuery === true ? (
                <>
                  <AcaoDaLinha
                    icone="lucide:pencil"
                    rotulo={`Renomear ${no.label}`}
                    onClick={comErro(async () => {
                      await onRenomearQuery(vinculoDaPasta(id, caminho), no);
                      await ctrl.recarregarNo(id, caminho);
                    })}
                  />
                  <AcaoDaLinha
                    icone="lucide:trash-2"
                    rotulo={`Apagar ${no.label}`}
                    onClick={comErro(async () => {
                      await onApagarQuery(vinculoDaPasta(id, caminho), no);
                      await ctrl.recarregarNo(id, caminho);
                    })}
                  />
                </>
              ) : no.meta?.category === 'tables' || no.meta?.category === 'views' ? (
                // Spec 041: o terceiro ícone das anotações do usuário — abre a
                // tabela numa aba própria, com paginação e total de verdade.
                <AcaoDaLinha
                  icone="lucide:table-2"
                  rotulo={`Abrir tabela ${no.label}`}
                  onClick={comErro(() => onAbrirTabela(id, filho, no.label, bancoAqui))}
                />
              ) : typeof no.meta?.database === 'string' ? (
                // `Abrir Query` no database — o botão que o usuário anotou da
                // ferramenta de referência. Aparece porque o DRIVER declarou que
                // este nó é um database; quem decide que isso vira botão é a
                // interface (Artigo III).
                <>
                  <AcaoDaLinha
                    icone="lucide:file-plus-2"
                    rotulo={`Abrir Query em ${no.label}`}
                    onClick={comErro(() => onAbrirQueryDoDatabase(id, no))}
                  />
                  {no.meta?.diagramaEr === true && (
                    <AcaoDaLinha
                      icone="diagrama"
                      rotulo={`Diagrama ER de ${no.label}`}
                      onClick={comErro(() => onDiagramaEr(id, filho, no.label))}
                    />
                  )}
                </>
              ) : no.meta?.diagramaEr === true ? (
                // O nó de SCHEMA do PostgreSQL: não abre query (o database é o
                // pai), mas é dele que sai o diagrama. Ele perguntou onde
                // estava o botão — estava só no menu de contexto, e menu de
                // contexto não se descobre passando o mouse.
                <AcaoDaLinha
                  icone="diagrama"
                  rotulo={`Diagrama ER de ${no.label}`}
                  onClick={comErro(() => onDiagramaEr(id, filho, no.label))}
                />
              ) : no.meta?.categoria === true ? (
                <>
                  <AcaoDaLinha
                    icone="lucide:refresh-cw"
                    rotulo={`Recarregar ${no.label}`}
                    onClick={comErro(() => ctrl.recarregarNo(id, filho))}
                  />
                  <AcaoDaLinha
                    icone="lucide:list-filter"
                    rotulo={`Filtrar ${no.label}`}
                    ativa={ctrl.filtroDe(id, filho) !== null}
                    // Os critérios vêm do NÓ: `Tables` filtra por tamanho e
                    // `Types` não, e a interface não precisa saber por quê.
                    onClick={() =>
                      setPedidoDeFiltro({
                        id,
                        caminho: filho,
                        rotulo: no.label,
                        criterios: criteriosDoNo(no),
                        atual: ctrl.filtroDe(id, filho),
                      })
                    }
                  />
                  {typeof no.meta?.template === 'string' && (
                    <AcaoDaLinha
                      icone="lucide:plus"
                      rotulo={`Criar em ${no.label}`}
                      // T113: o `+` abre a janela com o esqueleto, e de lá
                      // saem os DOIS caminhos — executar ou abrir no editor.
                      onClick={() =>
                        setPedidoDeCriacao({
                          id,
                          caminho: filho,
                          rotulo: no.label,
                          nomeBase: no.id,
                          esqueleto: typeof no.meta?.template === 'string' ? no.meta.template : '',
                          database: bancoAqui,
                          somenteLeitura: somenteLeitura(id),
                        })
                      }
                    />
                  )}
                </>
              ) : undefined
            }
          />
          {aberto && renderNos(id, filho, nivel + 1, bancoAqui)}
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
          // A distro do servidor ao lado do nome (spec 052), como na
          // ferramenta de referência. O `RO` continua vindo junto quando for o
          // caso: são duas informações, e esconder uma pela outra seria perder
          // justamente a que avisa que a conexão não escreve.
          detalhe={
            [ctrl.descricaoDe(conexao.id), conexao.readOnly ? 'RO' : null]
              .filter((p) => p !== null)
              .join(' · ') || undefined
          }
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
              {/* Só aparece onde o driver declara cliente — SQLite não tem. */}
              {/*
                A aba do SERVIDOR (spec 055): SFTP em tabela e o que mais a
                sessão souber. Só onde há arquivos remotos — num banco a aba
                não teria nada dentro.
              */}
              {driver?.kind === 'files' && (
                <AcaoDaLinha
                  icone="lucide:server"
                  rotulo={`Abrir ${conexao.label} numa aba`}
                  onClick={() => onAbrirServidor(conexao)}
                />
              )}
              {driver?.hasTerminal === true && (
                <AcaoDaLinha
                  icone="lucide:square-terminal"
                  rotulo="Abrir no terminal"
                  onClick={() => onAbrirTerminal(conexao)}
                />
              )}
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
          // `list-collapse`, como a árvore de arquivos: os dois chevrons
          // convergindo do `chevrons-down-up` desenham um X em 14px, e X ao
          // lado de outros botões lê como "fechar". A decisão está registrada
          // em `shared/icons.ts` desde a spec 012 — este painel tinha
          // divergido, e o ícone saía como bolinha por não estar empacotado.
          icone="lucide:list-collapse"
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
        {/* Exportar TUDO com as senhas (N001). Só com o cofre destrancado,
            como tudo que decifra. Ele escolheu JSON em claro, sabendo o que é —
            e por isso o arquivo carrega o aviso dentro. */}
        {/* Trocar a senha mestra (T100). Não existia caminho nenhum para isso. */}
        <AcaoDoPainel
          icone="lucide:key-round"
          rotulo="Trocar a senha mestra"
          desabilitada={!vault.unlocked}
          onClick={comErro(ctrl.trocarSenha)}
        />
        <AcaoDoImportar ctrl={ctrl} confirmar={confirmar} avisar={avisar} onErro={onErro} />
        <AcaoDoPainel
          icone="lucide:hard-drive-download"
          rotulo="Exportar conexões COM as senhas"
          desabilitada={!vault.unlocked}
          onClick={comErro(async () => {
            const tudo = await Api.exportarConexoes();
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(tudo, null, 2)], { type: 'application/json' })
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = 'conexoes-com-senhas.json';
            a.click();
            URL.revokeObjectURL(url);
          })}
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

      <DialogoDeCriacao
        pedido={pedidoDeCriacao}
        onCancelar={() => setPedidoDeCriacao(null)}
        onAbrirNoEditor={(sql) => {
          const pedido = pedidoDeCriacao;
          if (pedido === null) return;
          setPedidoDeCriacao(null);
          onNovoObjeto(pedido.id, pedido.caminho, pedido.nomeBase, sql, pedido.database);
        }}
        onExecutar={async (sql) => {
          const pedido = pedidoDeCriacao;
          if (pedido === null) return;
          await Api.execute(pedido.id, {
            statement: sql,
            database: pedido.database ?? undefined,
          });
          // Sem isto o objeto criado só apareceria no F5 seguinte — o mesmo
          // defeito que a spec 038 teve com arquivo de query.
          await ctrl.recarregarNo(pedido.id, pedido.caminho);
          setPedidoDeCriacao(null);
        }}
      />

      <DialogoDeFiltro
        pedido={pedidoDeFiltro}
        onCancelar={() => setPedidoDeFiltro(null)}
        onAplicar={async (filtro) => {
          const pedido = pedidoDeFiltro;
          if (pedido === null) return;
          // Fecha ANTES de listar: com muitas tabelas a consulta demora, e um
          // diálogo que fica de pé esperando parece travado.
          setPedidoDeFiltro(null);
          try {
            await ctrl.definirFiltro(pedido.id, pedido.caminho, filtro);
          } catch (e) {
            onErro(e as Error);
          }
        }}
      />
    </Box>
  );
}

/**
 * A barra de ações de um nó da árvore remota (spec 053, AC-7 e AC-8).
 *
 * Pasta e arquivo oferecem coisas diferentes, e é isso que o print do usuário
 * mostra: pasta tem recarregar; arquivo executável tem executar. O que escreve
 * some com a conexão trancada — a trava de valer está na rota.
 */
function AcoesDoNoRemoto({
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
