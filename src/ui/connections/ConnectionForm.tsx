// Aba de cadastro e edição de conexão.
//
// É aba, e não modal, porque um driver como o MySQL declara treze campos em
// quatro seções — isso não cabe numa caixa sem rolagem dentro de rolagem.
//
// Todo o conteúdo vem dos metadados do driver: os campos, seus rótulos, seus
// grupos e a grade de tipos. Este arquivo não conhece o nome de nenhum campo.
import { useMemo, useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import {
  agruparPorSecao,
  camposParaEnviar,
  camposVisiveis,
  validar,
  valoresIniciais,
  type ErrosDoFormulario,
  type ValoresDoFormulario,
} from '../../shared/connections/form';
import type { ConnectionInput, PublicConnection } from '../../shared/contracts';
import { Api, type DriverInfo } from '../api';
import { Icon } from '../Icon';
import { CampoDinamico } from './CampoDinamico';
import { TypeGrid } from './TypeGrid';

export interface ConnectionFormProps {
  readonly drivers: readonly DriverInfo[];
  readonly gruposConhecidos: readonly string[];
  /** Nula ao criar. */
  readonly conexao: PublicConnection | null;
  /** Preenchido quando o formulário vem do botão "+" de uma pasta. */
  readonly grupoInicial?: string;
  readonly onSalvar: (input: ConnectionInput, conectar: boolean) => Promise<void>;
  readonly onCancelar: () => void;
  readonly onSujar: (sujo: boolean) => void;
}

export function ConnectionForm({
  drivers, gruposConhecidos, conexao, grupoInicial = '', onSalvar, onCancelar, onSujar,
}: ConnectionFormProps) {
  const editando = conexao !== null;

  const [tipo, setTipo] = useState<string | null>(conexao?.type ?? null);
  const [rotulo, setRotulo] = useState(conexao?.label ?? '');
  const [grupo, setGrupo] = useState(conexao?.group ?? grupoInicial);
  const [somenteLeitura, setSomenteLeitura] = useState(conexao?.readOnly ?? false);
  const [valores, setValores] = useState<ValoresDoFormulario>({});
  const [erros, setErros] = useState<ErrosDoFormulario>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [testado, setTestado] = useState<{ readonly ok: boolean; readonly texto: string } | null>(null);

  /**
   * Abre a conexão com o que está no FORMULÁRIO e fecha, sem gravar nada.
   *
   * Numa conexão que já existe, o campo de senha em branco significa "mantenha
   * a guardada" — e aqui não há cofre para manter de onde. Por isso o teste
   * exige a senha digitada quando ela está vazia: testar com senha vazia daria
   * um erro de autenticação que não é o que o usuário quer saber.
   */
  const testar = async (): Promise<void> => {
    setTestando(true);
    setTestado(null);
    try {
      if (driver === null) return;
      const r = await Api.testarConexao({
        // O id vai junto quando a conexão já existe: é o que deixa o SERVIDOR
        // completar a senha guardada quando o campo está em branco. Sem isso o
        // teste dizia `using password: NO` numa conexão perfeitamente boa.
        ...(conexao === undefined || conexao === null ? {} : { id: conexao.id }),
        type: driver.type,
        label: rotulo.trim() === '' ? 'teste' : rotulo.trim(),
        group: '',
        readOnly: somenteLeitura,
        fields: camposParaEnviar(driver.fields, valores),
      });
      setTestado({
        ok: true,
        texto: r.descricao === null ? 'Conectou.' : `Conectou — ${r.descricao}`,
      });
    } catch (e) {
      setTestado({ ok: false, texto: (e as Error).message });
    } finally {
      setTestando(false);
    }
  };

  const driver = useMemo(
    () => drivers.find((d) => d.type === tipo) ?? null,
    [drivers, tipo]
  );

  // O estado dos campos nasce junto com o tipo: sem tipo escolhido não há campos.
  const [tipoMontado, setTipoMontado] = useState<string | null>(null);
  if (driver !== null && tipoMontado !== driver.type) {
    setTipoMontado(driver.type);
    setValores(valoresIniciais(driver.fields, conexao));
    setErros({});
  }

  // Depende dos VALORES, e não só do driver: desde a spec 052 um campo pode
  // existir por causa de outro (`Auth` decide se há senha, chave ou agente), e
  // memoizar só pelo driver congelaria o formulário no primeiro `Auth`.
  const secoes = useMemo(
    () => (driver === null ? [] : agruparPorSecao(camposVisiveis(driver.fields, valores))),
    [driver, valores]
  );

  const mudar = (nome: string, valor: string | boolean): void => {
    setValores((atual) => ({ ...atual, [nome]: valor }));
    setErros((atual) => ({ ...atual, [nome]: undefined }));
    onSujar(true);
  };

  const salvar = async (conectar: boolean): Promise<void> => {
    if (driver === null) return;

    const achados = validar(driver.fields, valores);
    const semRotulo = rotulo.trim() === '';
    setErros(achados);
    if (semRotulo) setErroGeral('Dê um nome à conexão.');
    if (Object.keys(achados).length > 0 || semRotulo) {
      if (!semRotulo) setErroGeral('Confira os campos destacados.');
      return;
    }

    setSalvando(true);
    setErroGeral(null);
    try {
      await onSalvar(
        {
          type: driver.type,
          label: rotulo.trim(),
          group: grupo.trim(),
          readOnly: somenteLeitura,
          fields: camposParaEnviar(driver.fields, valores),
        },
        conectar
      );
    } catch (e) {
      // Mantém tudo preenchido: perder o formulário por um erro do servidor
      // custaria redigitar treze campos.
      setErroGeral((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Box
      role="form"
      aria-label="Formulário de conexão"
      sx={{ flex: 1, overflow: 'auto', p: 2.5, minHeight: 0 }}
    >
      <Box sx={{ maxWidth: 720, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 18 }}>
          <Icon name={driver?.icon ?? 'connection'} size={22} />
          {editando ? `Editar ${conexao.label}` : 'Nova conexão'}
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <TextField
            label="Nome *"
            value={rotulo}
            onChange={(e) => { setRotulo(e.target.value); onSujar(true); }}
            sx={{ flex: '1 1 240px' }}
            slotProps={{ htmlInput: { 'aria-label': 'Nome' } }}
          />
          <Autocomplete
            freeSolo
            options={[...gruposConhecidos]}
            value={grupo}
            onInputChange={(_, valor) => { setGrupo(valor); onSujar(true); }}
            sx={{ flex: '1 1 240px' }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Grupo"
                placeholder="ex.: ACME/Bancos"
                slotProps={{
                  htmlInput: { ...params.slotProps?.htmlInput, 'aria-label': 'Grupo' },
                }}
              />
            )}
          />
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={somenteLeitura}
              onChange={(e) => { setSomenteLeitura(e.target.checked); onSujar(true); }}
            />
          }
          label={
            <Box sx={{ fontSize: 12 }}>
              Somente leitura
              <Box sx={{ color: 'text.secondary', fontSize: 11 }}>
                O próprio servidor recusa escrita — não é filtro no texto do comando.
              </Box>
            </Box>
          }
        />

        <Box>
          <Box sx={{ fontSize: 13, mb: 1 }}>
            Tipo{editando && (
              <Box component="span" sx={{ color: 'text.secondary', fontSize: 11, ml: 1 }}>
                não pode mudar depois de criada — os campos de um tipo não valem para outro
              </Box>
            )}
          </Box>
          <TypeGrid
            drivers={drivers}
            selecionado={tipo}
            onEscolher={editando ? undefined : (t) => { setTipo(t); onSujar(true); }}
          />
        </Box>

        {driver === null && editando ? (
          // O driver sumiu (removido, ou cofre trazido de outra instalação). Não
          // dá para montar os campos sem os metadados — mas some com a conexão
          // seria pior: o usuário perderia a credencial sem entender por quê.
          <Alert severity="warning" sx={{ fontSize: 12 }}>
            O tipo <strong>{conexao.type}</strong> não existe mais nesta instalação, então os
            campos não podem ser montados. A conexão continua guardada e pode ser excluída
            pelo menu de contexto.
          </Alert>
        ) : driver === null ? (
          <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
            Escolha um tipo para ver os campos.
          </Box>
        ) : (
          secoes.map((secao) => (
            <Accordion key={secao.titulo} defaultExpanded={secao.aberta} disableGutters>
              <AccordionSummary expandIcon={<Icon name="lucide:chevron-down" size={14} />}>
                <Box sx={{ fontSize: 13 }}>{secao.titulo}</Box>
              </AccordionSummary>
              <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {secao.campos.map((campo) => (
                  <CampoDinamico
                    key={campo.name}
                    campo={campo}
                    valor={valores[campo.name] ?? ''}
                    erro={erros[campo.name]}
                    segredoGuardado={
                      campo.secret === true && conexao?.secretFields.includes(campo.name) === true
                    }
                    // Só há o que revelar quando o segredo JÁ ESTÁ no cofre —
                    // numa conexão nova não existe nada guardado ainda (N001).
                    revelar={
                      conexao === undefined || conexao === null || campo.secret !== true
                        ? undefined
                        : () => Api.revelarSegredo(conexao.id, campo.name)
                    }
                    onChange={(valor) => mudar(campo.name, valor)}
                  />
                ))}
              </AccordionDetails>
            </Accordion>
          ))
        )}

        {erroGeral !== null && <Alert severity="error" sx={{ fontSize: 12 }}>{erroGeral}</Alert>}
        {testado !== null && (
          <Alert
            data-resultado-do-teste
            severity={testado.ok ? 'success' : 'error'}
            sx={{ fontSize: 12 }}
          >
            {testado.texto}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, pb: 2 }}>
          {/* Testar SEM salvar (T103): antes, se a senha estivesse errada, a
              conexão já estava no cofre quando o erro aparecia. */}
          <Button onClick={() => void testar()} disabled={driver === null || salvando || testando}>
            <Icon name="lucide:plug-zap" size={13} />&nbsp;{testando ? 'testando…' : 'testar'}
          </Button>
          <Button onClick={() => void salvar(false)} disabled={driver === null || salvando}>
            <Icon name="lucide:save" size={13} />&nbsp;salvar
          </Button>
          <Button
            color="success"
            onClick={() => void salvar(true)}
            disabled={driver === null || salvando}
          >
            <Icon name="lucide:plug" size={13} />&nbsp;salvar e conectar
          </Button>
          <Button onClick={onCancelar} disabled={salvando}>cancelar</Button>
        </Box>
      </Box>
    </Box>
  );
}
