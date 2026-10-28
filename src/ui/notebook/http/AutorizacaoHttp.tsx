// A aba Authorization da célula HTTP (spec 120): No Auth, Bearer Token, Basic
// Auth e API Key (etapa 2), e OAuth 2.0 (etapa 5, em `OAuthHttp.tsx`).
import Box from '@mui/material/Box';
import { CampoDeSegredo, estiloDoCampo } from './CampoDeSegredo';
import { estiloDoSeletor } from './estilos';
import { OAuthHttp } from './OAuthHttp';
import { novaReferencia } from './segredosPendentes';
import {
  oauthVazio, type AutorizacaoHttp as Autorizacao, type RequisicaoHttp, type TipoDeAutorizacao,
} from '../../../shared/notebook/http';

const TIPOS: readonly (readonly [TipoDeAutorizacao, string])[] = [
  ['nenhuma', 'No Auth'], ['bearer', 'Bearer Token'], ['basic', 'Basic Auth'], ['apikey', 'API Key'],
  ['oauth2', 'OAuth 2.0'],
];

function vazia(tipo: TipoDeAutorizacao): Autorizacao {
  switch (tipo) {
    case 'bearer': return { tipo, token: { texto: '' } };
    case 'basic': return { tipo, usuario: '', senha: { texto: '' } };
    case 'apikey': return { tipo, chave: '', valor: { texto: '' }, onde: 'header' };
    // Os tokens ganham a referência do cofre JÁ: o motor guarda neles sem a tela esperar.
    case 'oauth2': return oauthVazio(novaReferencia());
    default: return { tipo: 'nenhuma' };
  }
}

function Linha({ rotulo, children }: { readonly rotulo: string; readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, fontSize: 11 }}>
      <Box sx={{ width: 90, pt: 0.75, color: 'text.secondary', flexShrink: 0 }}>{rotulo}</Box>
      {children}
    </Box>
  );
}

export interface AutorizacaoHttpProps {
  readonly autorizacao: Autorizacao;
  /** O OAuth pede o token com o proxy e o certificado da requisição. */
  readonly requisicao: RequisicaoHttp;
  readonly caminho: string | null;
  readonly contador: number | null;
  onMudar(autorizacao: Autorizacao): void;
}

export function AutorizacaoHttp({ autorizacao: a, requisicao, caminho, contador, onMudar }: AutorizacaoHttpProps) {
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

  return (
    <Box data-autorizacao-http sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Linha rotulo="Tipo">
        <Box
          component="select"
          aria-label="Tipo de autorização"
          value={a.tipo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onMudar(vazia(e.target.value as TipoDeAutorizacao))}
          sx={estiloDoSeletor}
        >
          {TIPOS.map(([tipo, rotulo]) => <option key={tipo} value={tipo}>{rotulo}</option>)}
        </Box>
      </Linha>

      {a.tipo === 'nenhuma' && (
        <Box sx={{ fontSize: 11, color: 'text.secondary' }}>Esta requisição não usa autorização.</Box>
      )}
      {a.tipo === 'bearer' && (
        <Linha rotulo="Token">
          <CampoDeSegredo rotulo="Token" campo={a.token} onMudar={(token) => onMudar({ ...a, token })} />
        </Linha>
      )}
      {a.tipo === 'basic' && (
        <>
          <Linha rotulo="Username">{texto('Username', a.usuario, (usuario) => onMudar({ ...a, usuario }))}</Linha>
          <Linha rotulo="Password">
            <CampoDeSegredo rotulo="Password" campo={a.senha} onMudar={(senha) => onMudar({ ...a, senha })} />
          </Linha>
        </>
      )}
      {a.tipo === 'apikey' && (
        <>
          <Linha rotulo="Key">{texto('Key', a.chave, (chave) => onMudar({ ...a, chave }), 'X-API-Key')}</Linha>
          <Linha rotulo="Value">
            <CampoDeSegredo rotulo="Value" campo={a.valor} onMudar={(valor) => onMudar({ ...a, valor })} />
          </Linha>
          <Linha rotulo="Add to">
            <Box
              component="select"
              aria-label="Onde vai a API Key"
              value={a.onde}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onMudar({ ...a, onde: e.target.value as 'header' | 'query' })}
              sx={estiloDoSeletor}
            >
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </Box>
          </Linha>
        </>
      )}

      {a.tipo === 'oauth2' && (
        <OAuthHttp oauth={a} requisicao={requisicao} caminho={caminho} contador={contador} onMudar={onMudar} />
      )}

      {a.tipo !== 'nenhuma' && (
        <Box sx={{ fontSize: 11, color: 'text.secondary' }}>
          O segredo fica no cofre deste computador; o .brnb guarda só uma referência — pode ir para um git. Um
          {' {{variavel}} '}no campo fica no arquivo como texto. Um header com o mesmo nome na aba Headers vale mais.
        </Box>
      )}
    </Box>
  );
}
