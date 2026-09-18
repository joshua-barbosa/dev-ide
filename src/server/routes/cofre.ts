// As rotas do COFRE: criar, abrir, trancar, pôr e tirar a senha.
//
// Saíram de `connections.ts` quando ele passou do teto de 800 linhas do Artigo
// IV. O corte é o natural: aqui está tudo que decide QUEM PODE ABRIR, e lá
// ficou o que faz com as conexões depois de abertas.
//
// A decisão que molda este arquivo é dele, 18/09/2026: *"é melhor remover essa
// senha mesmo e deixar sempre aberto, não ter essa tranca"*. Daí o cofre poder
// nascer sem senha, e daí as duas rotas de ida e volta — `/vault/sem-tranca` e
// `/vault/tranca` —, porque uma decisão que não se desfaz não é uma escolha.
import type { Router } from 'express';
import type { VaultState } from '../../shared/contracts';
import type { RememberedKey } from '../connections/remember';
import type { SessionPool } from '../connections/pool';
import type { Vault } from '../connections/vault';
import { requireString, wrap } from '../http/handlers';

/** O mesmo envelope das demais rotas. */
const ok = (data: unknown) => ({ success: true, data, error: null });

export interface DepsDoCofre {
  readonly vault: Vault;
  readonly remember: RememberedKey;
  readonly pool: SessionPool;
  readonly estadoDoCofre: () => VaultState;
  /** Guarda a chave quando o pedido traz `remember: true`. */
  readonly talvezLembrar: (pedido: unknown) => void;
}

export function rotasDoCofre(
  router: Router,
  { vault, remember, pool, estadoDoCofre, talvezLembrar }: DepsDoCofre
): void {
/**
 * Cria o cofre. SEM `password`, ele nasce sem tranca (spec 109).
 *
 * Sem senha é o padrão da tela desde a decisão dele; a senha continua
 * aceita aqui porque quem quiser pôr uma não pode ficar sem caminho.
 */
router.post('/vault', wrap((req, res) => {
  const senha = req.body?.password;
  if (senha === undefined || senha === '') {
    vault.criarSemTranca();
  } else {
    vault.create(requireString(senha, 'password'));
    talvezLembrar(req.body?.remember);
  }
  res.status(201).json(ok(estadoDoCofre()));
}));

/**
 * Tirar a tranca de um cofre que tem senha (spec 109).
 *
 * Pede a senha atual uma última vez: sem ela não há como decifrar os segredos
 * que já estão lá, e tirar a tranca perdendo as conexões não seria tirar a
 * tranca — seria apagar o cofre.
 */
router.post('/vault/sem-tranca', wrap(async (req, res) => {
  vault.removerTranca(requireString(req.body?.password, 'password'));
  // A lembrança de 15 dias perde o sentido: não há mais o que lembrar.
  remember.clear();
  await Promise.resolve();
  res.json(ok(estadoDoCofre()));
}));

/** Pôr uma senha num cofre sem tranca — o caminho de volta. */
router.post('/vault/tranca', wrap((req, res) => {
  vault.porTranca(requireString(req.body?.password, 'password'));
  remember.clear();
  talvezLembrar(req.body?.remember);
  res.json(ok(estadoDoCofre()));
}));

router.post('/vault/unlock', wrap((req, res) => {
  vault.unlock(requireString(req.body?.password, 'password'));
  talvezLembrar(req.body?.remember);
  res.json(ok(estadoDoCofre()));
}));

/**
 * Trocar a senha mestra (T100).
 *
 * A lembrança de 15 dias é APAGADA junto: ela guarda a chave cifrada, e a
 * chave acabou de mudar. Manter a antiga faria o próximo início destrancar o
 * cofre com uma chave que não abre mais nada — erro sem causa aparente.
 */
router.post('/vault/password', wrap((req, res) => {
  vault.trocarSenhaMestra(
    requireString(req.body?.atual, 'atual'),
    requireString(req.body?.nova, 'nova')
  );
  remember.clear();
  talvezLembrar(req.body?.remember);
  res.json(ok(estadoDoCofre()));
}));

router.post('/vault/lock', wrap(async (_req, res) => {
  if (vault.semTranca()) {
    throw new Error('Este cofre não tem senha: trancá-lo deixaria a porta sem chave.');
  }
  vault.lock();
  // Trancar é um pedido explícito de fechar: a lembrança some junto, senão o
  // próximo início desfaria o que o usuário acabou de mandar fazer.
  remember.clear();
  // Sessões abertas seguram credenciais resolvidas: trancar o cofre fecha tudo.
  await pool.closeAll();
  res.json(ok(estadoDoCofre()));
}));
}
