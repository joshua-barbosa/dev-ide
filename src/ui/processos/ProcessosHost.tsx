// Liga a aba de processos ao servidor (spec 047).
//
// Componente próprio pelo mesmo motivo do `TabelaHost`: o estado é um hook, e
// hook não pode ser chamado dentro de um `map`. Uma instância por aba mantém a
// lista de cada conexão separada.
import { useCallback, useEffect, useState } from 'react';
import { Api } from '../api';
import { ProcessosPanel } from './ProcessosPanel';
import type { ProcessoDoBanco } from '../../shared/contracts';
import type { Tab } from '../../shared/tabs';

export interface ProcessosHostProps {
  readonly aba: Tab;
  /** A conexão é somente-leitura: matar não aparece. */
  readonly somenteLeitura: boolean;
  /** Mostra o que vai ser morto e espera o sim. Quem desenha é o App. */
  readonly onConfirmar: (mensagem: string, titulo: string) => Promise<boolean>;
  readonly onErro: (erro: unknown) => void;
}

export function ProcessosHost({
  aba, somenteLeitura, onConfirmar, onErro,
}: ProcessosHostProps) {
  const connectionId = (aba.meta as { connectionId?: string }).connectionId ?? '';
  const [processos, setProcessos] = useState<readonly ProcessoDoBanco[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    Api.processList(connectionId)
      .then((dados) => {
        if (!vivo) return;
        setProcessos(dados);
        setErro(null);
      })
      .catch((e: Error) => {
        if (vivo) setErro(e.message);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [connectionId, versao]);

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

  return (
    <ProcessosPanel
      processos={processos}
      carregando={carregando}
      erro={erro}
      podeMatar={!somenteLeitura}
      onRecarregar={recarregar}
      onMatar={(p) => void matar(p).catch(onErro)}
    />
  );
}
