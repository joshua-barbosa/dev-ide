// OAuth 2.0 na aba Authorization (spec 120, etapa 5).
//
// Os campos mudam com o fluxo. Embaixo, o TOKEN: se há um, até quando vale e
// se renova sozinho — nunca o token em si, que fica no cofre. "Pegar token
// novo" pede na hora (Client Credentials, Password) ou abre o login do
// provedor no navegador (Authorization Code) e espera ele voltar.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { CampoDeSegredo, estiloDoCampo } from './CampoDeSegredo';
import { estiloDoSeletor } from './estilos';
import { aguardarSegredos } from './segredosPendentes';
import { ApiDoNotebook, type EstadoDoOAuth } from '../../api-notebook';
import { abrirNoNavegador } from '../../abrirNoNavegador';
import {
  referenciasDoCofre, type AutorizacaoOAuth, type FluxoOAuth, type RequisicaoHttp,
} from '../../../shared/notebook/http';

const FLUXOS: readonly (readonly [FluxoOAuth, string])[] = [
  ['client_credentials', 'Client Credentials'], ['password', 'Password'], ['authorization_code', 'Authorization Code (com login)'],
];

function Linha({ rotulo, children }: { readonly rotulo: string; readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, fontSize: 11 }}>
      <Box sx={{ width: 110, pt: 0.75, color: 'text.secondary', flexShrink: 0 }}>{rotulo}</Box>
      {children}
    </Box>
  );
}

const hora = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function descreverToken(e: EstadoDoOAuth | null, fluxo: FluxoOAuth): string {
  if (e === null) return '…';
  if (!e.tem) {
    return fluxo === 'authorization_code'
      ? 'Nenhum token ainda: clique em "Pegar token novo" para fazer o login.'
      : 'Nenhum token ainda: ele é pedido sozinho na primeira requisição.';
  }
  const renova = e.temRefresh ? ' · renova sozinho (refresh token)' : '';
  if (e.expiraEm === null) return `Token no cofre (o provedor não disse até quando vale)${renova}.`;
  return e.expiraEm > Date.now()
    ? `Token no cofre, válido até ${hora(e.expiraEm)}${renova}.`
    : `Token vencido às ${hora(e.expiraEm)}${e.temRefresh ? ': renova na próxima requisição' : ''}.`;
}

export interface OAuthHttpProps {
  readonly oauth: AutorizacaoOAuth;
  /** A requisição inteira: o "Pegar token" usa o proxy e o certificado dela. */
  readonly requisicao: RequisicaoHttp;
  readonly caminho: string | null;
  /** O `[n]` da célula: mudou, a célula rodou — e pode ter pegado ou renovado o token. */
  readonly contador: number | null;
  onMudar(oauth: AutorizacaoOAuth): void;
}

export function OAuthHttp({ oauth: o, requisicao, caminho, contador, onMudar }: OAuthHttpProps) {
  const [estado, setEstado] = useState<EstadoDoOAuth | null>(null);
  const [recado, setRecado] = useState<{ texto: string; erro: boolean } | null>(null);
  const [login, setLogin] = useState<string | null>(null);

  const reler = useCallback(() => {
    if (o.tokens === '') return;
    ApiDoNotebook.oauthEstado(o.tokens).then(setEstado).catch(() => setEstado(null));
  }, [o.tokens]);
  // Relê ao abrir e a cada execução da célula: o token pode ter sido pedido
  // sozinho (Client Credentials) ou renovado pelo refresh no meio dela.
  useEffect(reler, [reler, contador]);

  const texto = (rotulo: string, valor: string, mudar: (v: string) => void, dica = '') => (
    <Box
      component="input"
      aria-label={rotulo}
      value={valor}
      placeholder={dica}
      spellCheck={false}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => mudar(e.target.value)}
      sx={estiloDoCampo}
    />
  );

  /** Espera o login voltar ao motor (o navegador está com a pessoa). */
  const esperarLogin = async (id: string): Promise<void> => {
    for (let i = 0; i < 600; i += 1) {
      const r = await ApiDoNotebook.oauthLogin(id);
      if (r.estado === 'pronto') {
        setRecado({ texto: 'Login concluído: token no cofre.', erro: false });
        setLogin(null);
        reler();
        return;
      }
      if (r.estado === 'erro') {
        setRecado({ texto: r.erro ?? 'O login falhou.', erro: true });
        setLogin(null);
        return;
      }
      await new Promise((resolver) => setTimeout(resolver, 1000));
    }
  };

  const pegarToken = async (): Promise<void> => {
    setRecado(null);
    try {
      // O client secret digitado agora há pouco pode estar a caminho do cofre.
      const falhas = await aguardarSegredos(referenciasDoCofre(requisicao));
      if (falhas.length > 0) throw new Error(`não deu para guardar no cofre: ${falhas[0]}`);
      const r = await ApiDoNotebook.oauthToken(requisicao, caminho);
      if (r.login !== undefined) {
        setLogin(r.login.url);
        setRecado({ texto: 'Esperando o login no navegador…', erro: false });
        await abrirNoNavegador(r.login.url).catch(() => undefined);
        await esperarLogin(r.login.id);
        return;
      }
      setRecado({ texto: 'Token novo no cofre.', erro: false });
      reler();
    } catch (e) {
      setRecado({ texto: e instanceof Error ? e.message : String(e), erro: true });
    }
  };

  const limpar = async (): Promise<void> => {
    if (o.tokens === '') return;
    await ApiDoNotebook.oauthLimpar(o.tokens).catch(() => undefined);
    setRecado({ texto: 'Token esquecido.', erro: false });
    reler();
  };

  const botao = { border: 0, bgcolor: 'transparent', cursor: 'pointer', fontSize: 11, color: 'primary.main', px: 0.5 } as const;

  return (
    <Box data-oauth-http sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Linha rotulo="Fluxo">
        <Box
          component="select"
          aria-label="Fluxo do OAuth 2.0"
          value={o.fluxo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onMudar({ ...o, fluxo: e.target.value as FluxoOAuth })}
          sx={estiloDoSeletor}
        >
          {FLUXOS.map(([f, rotulo]) => <option key={f} value={f}>{rotulo}</option>)}
        </Box>
      </Linha>
      {o.fluxo === 'authorization_code' && (
        <Linha rotulo="URL de login">
          {texto('URL de autorização', o.urlDeAutorizacao, (urlDeAutorizacao) => onMudar({ ...o, urlDeAutorizacao }), 'https://provedor/oauth/authorize')}
        </Linha>
      )}
      <Linha rotulo="URL do token">
        {texto('URL do token', o.urlDoToken, (urlDoToken) => onMudar({ ...o, urlDoToken }), 'https://provedor/oauth/token')}
      </Linha>
      {o.fluxo === 'authorization_code' && (
        <Linha rotulo="URL de retorno">
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 0.25 }}>
            {texto('URL de retorno', o.urlDeRetorno, (urlDeRetorno) => onMudar({ ...o, urlDeRetorno }))}
            <Box sx={{ color: 'text.secondary' }}>
              Registre esta URL no provedor. O motor desta máquina espera o login voltar nela.
            </Box>
          </Box>
        </Linha>
      )}
      <Linha rotulo="Client ID">{texto('Client ID', o.clientId, (clientId) => onMudar({ ...o, clientId }))}</Linha>
      <Linha rotulo="Client Secret">
        <CampoDeSegredo rotulo="Client Secret" campo={o.clientSecret} onMudar={(clientSecret) => onMudar({ ...o, clientSecret })} />
      </Linha>
      {o.fluxo === 'password' && (
        <>
          <Linha rotulo="Username">{texto('Username do OAuth', o.usuario, (usuario) => onMudar({ ...o, usuario }))}</Linha>
          <Linha rotulo="Password">
            <CampoDeSegredo rotulo="Password do OAuth" campo={o.senha} onMudar={(senha) => onMudar({ ...o, senha })} />
          </Linha>
        </>
      )}
      <Linha rotulo="Scope">{texto('Scope', o.escopo, (escopo) => onMudar({ ...o, escopo }), 'separados por espaço')}</Linha>
      <Linha rotulo="Credenciais">
        <Box
          component="select"
          aria-label="Como o client se identifica"
          value={o.credenciaisNo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onMudar({ ...o, credenciaisNo: e.target.value as 'basic' | 'corpo' })}
          sx={estiloDoSeletor}
        >
          <option value="basic">Basic Auth header</option>
          <option value="corpo">No corpo (client_id / client_secret)</option>
        </Box>
        {o.fluxo === 'authorization_code' && (
          <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 2 }}>
            <input type="checkbox" aria-label="Usar PKCE" checked={o.pkce} onChange={(e) => onMudar({ ...o, pkce: e.target.checked })} />
            PKCE
          </Box>
        )}
      </Linha>

      <Box
        data-token-oauth
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', fontSize: 11, borderTop: 1, borderColor: 'divider', pt: 0.75 }}
      >
        <Box sx={{ color: 'text.secondary' }}>{descreverToken(estado, o.fluxo)}</Box>
        <Box sx={{ flex: 1 }} />
        <Box component="button" type="button" onClick={() => void pegarToken()} sx={botao}>Pegar token novo</Box>
        {estado?.tem === true && (
          <Box component="button" type="button" onClick={() => void limpar()} sx={{ ...botao, color: 'text.secondary' }}>Limpar token</Box>
        )}
      </Box>
      {login !== null && (
        <Box sx={{ fontSize: 11 }}>
          O navegador não abriu?{' '}
          <Box component="button" type="button" onClick={() => void abrirNoNavegador(login)} sx={botao}>Abrir o login</Box>
        </Box>
      )}
      {recado !== null && (
        <Box data-recado-oauth sx={{ fontSize: 11, color: recado.erro ? 'error.main' : 'text.secondary' }}>{recado.texto}</Box>
      )}
    </Box>
  );
}
