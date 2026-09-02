// Liga a aba de processos ao servidor (spec 047, T069, T071).
//
// Componente próprio pelo mesmo motivo do `TabelaHost`: o estado é um hook, e
// hook não pode ser chamado dentro de um `map`. Uma instância por aba mantém a
// lista de cada conexão separada.
//
// **A atualização automática nasce DESLIGADA** (T069). Uma consulta por segundo
// contra um banco de produção é ruído que a IDE criaria sozinha; quem está
// caçando um processo travado liga o interruptor, e quem não está não paga
// nada. É a mesma escolha que o Monitor faz por estar à vista, e aqui ela é
// explícita porque o custo cai no banco DELE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { ProcessosPanel } from './ProcessosPanel';
import { ManagerPanel } from '../manager/ManagerPanel';
import type { ProcessoDoBanco } from '../../shared/contracts';
import type { Tab } from '../../shared/tabs';

export interface ProcessosHostProps {
  readonly aba: Tab;
  /**
   * Está à vista? Escondida, a aba PARA de atualizar sozinha (T069).
   *
   * A aba fica montada quando some de vista (emenda constitucional), e um
   * relógio que sobrevive a isso consultaria um banco que ninguém está olhando
   * — a cada dois segundos, para sempre.
   */
  readonly ativa: boolean;
  /** Os bancos desta conexão, para o Structure Sync (T070). */
  readonly bancos: readonly string[];
  /** Abre o SQL gerado numa aba do editor — quem executa é ele. */
  onAbrirSql(titulo: string, sql: string): void;
  /** A conexão é somente-leitura: matar não aparece. */
  readonly somenteLeitura: boolean;
  /** Mostra o que vai ser morto e espera o sim. Quem desenha é o App. */
  readonly onConfirmar: (mensagem: string, titulo: string) => Promise<boolean>;
  readonly onErro: (erro: unknown) => void;
}

export function ProcessosHost({
  aba, ativa, bancos, somenteLeitura, onConfirmar, onAbrirSql, onErro,
}: ProcessosHostProps) {
  /** Qual das quatro divisórias da aba `Manager` está à vista (T070). */
  const [divisoria, setDivisoria] = useState<'processos' | 'manager'>('processos');
  const connectionId = (aba.meta as { connectionId?: string }).connectionId ?? '';
  const [processos, setProcessos] = useState<readonly ProcessoDoBanco[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  /** De quantos em quantos segundos recarregar sozinho. `0` = desligado (T069). */
  const [intervalo, setIntervalo] = useState(0);
  /** Os que estão marcados para o kill em lote (T071). */
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  /** Há uma leitura em voo? Sem isto, um banco lento empilha um pedido por segundo. */
  const emVoo = useRef(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    emVoo.current = true;
    Api.processList(connectionId)
      .then((dados) => {
        if (!vivo) return;
        setProcessos(dados);
        setErro(null);
        // Some da seleção quem já não está na lista: o processo terminou, e
        // manter a marca faria o kill em lote pedir por um id que não existe.
        setMarcados((atual) => {
          if (atual.size === 0 || dados === null) return atual;
          const vivos = new Set(dados.map((p) => p.id));
          const proximo = new Set([...atual].filter((id) => vivos.has(id)));
          return proximo.size === atual.size ? atual : proximo;
        });
      })
      .catch((e: Error) => {
        if (vivo) setErro(e.message);
      })
      .finally(() => {
        emVoo.current = false;
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [connectionId, versao]);

  /**
   * O relógio da atualização automática (T069).
   *
   * **Pula a batida quando a anterior ainda não voltou**, e não enfileira: num
   * banco lento a fila cresceria um pedido por segundo até estourar o limite de
   * conexões do navegador — o defeito que derrubou a IDE inteira na spec 078.
   */
  useEffect(() => {
    // Escondida ou fora da divisória de processos, o relógio não corre: medir
    // um banco que ninguém está olhando é ruído que a IDE criaria sozinha.
    if (intervalo === 0 || !ativa || divisoria !== 'processos') return;
    const relogio = setInterval(() => {
      if (emVoo.current) return;
      setVersao((v) => v + 1);
    }, intervalo * 1_000);
    return () => clearInterval(relogio);
  }, [intervalo, ativa, divisoria]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const matar = async (p: ProcessoDoBanco): Promise<void> => {
    // A confirmação mostra QUEM e O QUÊ: matar o processo errado numa produção
    // derruba o trabalho de outra pessoa, e o id sozinho não diz nada.
    const ok = await onConfirmar(
      `Matar o processo ${p.id}?\n\n` +
        `Usuário: ${p.usuario ?? '(desconhecido)'}\n` +
        `Banco: ${p.banco ?? '(nenhum)'}\n` +
        `Rodando há: ${p.segundos ?? '?'}s\n\n` +
        `${p.sql ?? '(sem SQL)'}`,
      'Matar processo'
    );
    if (!ok) return;
    await Api.killProcess(connectionId, p.id);
    recarregar();
  };

  /**
   * Mata os marcados, um por um (T071).
   *
   * **Um a um, e não numa chamada só**: cada `KILL` é um comando separado no
   * banco, e um que falhe — o processo já terminou, falta permissão — não pode
   * levar os outros junto. No fim, a IDE diz quantos foram e quais não deram.
   */
  const matarLote = async (): Promise<void> => {
    const alvos = (processos ?? []).filter((p) => marcados.has(p.id) && !p.euMesmo);
    if (alvos.length === 0) return;

    const ok = await onConfirmar(
      `Matar ${alvos.length} processo(s)?\n\n` +
        alvos
          .slice(0, 10)
          .map((p) => `${p.id} · ${p.usuario ?? '?'} · ${(p.sql ?? '(sem SQL)').slice(0, 60)}`)
          .join('\n') +
        (alvos.length > 10 ? `\n… e mais ${alvos.length - 10}.` : ''),
      'Matar processos'
    );
    if (!ok) return;

    const falhas: string[] = [];
    for (const alvo of alvos) {
      try {
        await Api.killProcess(connectionId, alvo.id);
      } catch (e) {
        falhas.push(`${alvo.id}: ${(e as Error).message}`);
      }
    }
    setMarcados(new Set());
    recarregar();
    if (falhas.length > 0) {
      // Dizer QUAIS falharam, e não só que houve falha: um processo que já
      // tinha terminado é normal, e falta de permissão é outro assunto.
      setErro(`${falhas.length} de ${alvos.length} não morreram:\n${falhas.join('\n')}`);
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex', gap: 0.25, px: 0.5, borderBottom: 1, borderColor: 'divider',
          bgcolor: 'background.paper', flexShrink: 0,
        }}
      >
        {([
          { id: 'processos', rotulo: 'Processos', icone: 'lucide:activity' },
          { id: 'manager', rotulo: 'Manager', icone: 'lucide:gauge' },
        ] as const).map((d) => (
          <Box
            key={d.id}
            component="button"
            type="button"
            data-divisoria-do-banco={d.id}
            aria-selected={divisoria === d.id}
            onClick={() => setDivisoria(d.id)}
            sx={{
              border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit',
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.6, fontSize: 11.5,
              color: divisoria === d.id ? 'text.primary' : 'text.secondary',
              borderBottom: 2,
              borderColor: divisoria === d.id ? 'primary.main' : 'transparent',
            }}
          >
            <Icon name={d.icone} size={13} />
            {d.rotulo}
          </Box>
        ))}
      </Box>

      {/* Escondida com `display: none`, nunca desmontada: o Structure Sync
          guarda uma comparação que custou duas varreduras do banco. */}
      <Box sx={{ flex: 1, minHeight: 0, display: divisoria === 'manager' ? 'flex' : 'none' }}>
        <ManagerPanel
          conexaoId={connectionId}
          ativo={ativa && divisoria === 'manager'}
          bancos={bancos}
          onAbrirSql={onAbrirSql}
          onErro={onErro}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: divisoria === 'processos' ? 'flex' : 'none' }}>
    <ProcessosPanel
      processos={processos}
      carregando={carregando}
      erro={erro}
      podeMatar={!somenteLeitura}
      onRecarregar={recarregar}
      onMatar={(p) => void matar(p).catch(onErro)}
      intervalo={intervalo}
      onIntervalo={setIntervalo}
      marcados={marcados}
      onMarcar={setMarcados}
      onMatarLote={() => void matarLote().catch(onErro)}
    />
      </Box>
    </Box>
  );
}
