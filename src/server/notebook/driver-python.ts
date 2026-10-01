// O programa que roda DENTRO do Python do notebook (spec 112, etapa 2).
//
// Um driver nosso, e não o kernel oficial do Jupyter: aquele exigiria
// `ipykernel` em cada `.venv` e ZeroMQ nativo, que já custou caro de empacotar
// no Windows. Este só precisa de Python 3.8+ — sem pacote nenhum.
//
// Fala o protocolo de `shared/notebook/protocolo.ts`: pedidos chegam pelo
// `stdin`, uma linha JSON cada; respostas saem pelo `stdout` com a MARCA na
// frente, e o `print` do usuário passa no meio, como texto.
//
// Três decisões que moram aqui:
// - **Parar sem matar**: vira `KeyboardInterrupt` NA CÉLULA, e as variáveis
//   sobrevivem. No Linux e no Mac o motor manda SIGINT de verdade — é o único
//   jeito de acordar um `time.sleep` ou uma chamada bloqueada. No Windows o
//   Node só sabe MATAR, então vai uma mensagem, e a thread que lê o `stdin`
//   chama `_thread.interrupt_main()`: cobre laço de Python, não `sleep`.
// - **A última expressão aparece**, como no Jupyter: `df.head()` sozinho numa
//   linha mostra a tabela.
// - **`input()` é recusado com recado**: o `stdin` é o canal da conversa, e uma
//   célula lendo dele roubaria os pedidos do motor.
//
// `String.raw` para os `\x1e` e `\n` chegarem ao Python como estão escritos.
export const DRIVER_PYTHON = String.raw`
import ast, base64, builtins, hashlib, importlib.util, io, json, queue, sys, threading, traceback, types, warnings, _thread

MARCA = '\x1eBRNB\x1f'
MAX_LINHAS = 500
MAX_TEXTO = 200000

for fluxo in (sys.stdout, sys.stderr, sys.stdin):
    try:
        fluxo.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

_canal = sys.stdout
# O canal de pedidos fica guardado A PARTE, e o sys.stdin da celula vira uma
# entrada vazia. O exit() do Python fecha o sys.stdin antes de sair - e fechar
# o canal com a thread de leitura parada nele travava o kernel inteiro.
_entrada = sys.stdin
sys.stdin = io.StringIO('')
_trava = threading.Lock()
_executando = False
_pedidos = queue.Queue()
ns = {'__name__': '__main__', '__builtins__': builtins}


def enviar(dados):
    with _trava:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        _canal.write(MARCA + json.dumps(dados, default=str, ensure_ascii=False) + '\n')
        _canal.flush()


class _ErroPeloCanal(io.TextIOBase):
    # O stderr da celula viaja NO MESMO canal das mensagens: por outro cano
    # ele podia chegar depois do "fim", e a celula ja teria sido dada por
    # encerrada - o texto sumia.
    def writable(self):
        return True

    def write(self, texto):
        if texto:
            enviar({'tipo': 'texto', 'fluxo': 'erro', 'texto': texto})
        return len(texto)

    def flush(self):
        pass


sys.stderr = _ErroPeloCanal()


def _sem_input(*_a, **_k):
    raise RuntimeError('input() não funciona no notebook: o stdin é o canal com a IDE.')


builtins.input = _sem_input


def ler_pedidos():
    for linha in _entrada:
        try:
            pedido = json.loads(linha)
        except Exception:
            continue
        if pedido.get('tipo') == 'interromper':
            if _executando:
                _thread.interrupt_main()
        else:
            _pedidos.put(pedido)
    _pedidos.put(None)


def _eh_lista_de_artistas(v):
    # plt.plot(...) devolve [Line2D]: o Jupyter mostra o texto disso, e
    # ninguem quer ler. A figura ja aparece.
    return isinstance(v, list) and v != [] and all(
        type(x).__module__.startswith('matplotlib') for x in v)


def _eh_dataframe(v):
    t = type(v)
    return t.__name__ in ('DataFrame', 'Series') and t.__module__.startswith('pandas')


def tabela_de(valor):
    if _eh_dataframe(valor):
        df = valor.to_frame() if type(valor).__name__ == 'Series' else valor
        # Indice que nao e a numeracao padrao carrega INFORMACAO: num groupby,
        # e o nome de quem cada total e. Sem isto a tabela mostrava so os
        # numeros, sem dizer de quem.
        if type(df.index).__name__ != 'RangeIndex':
            df = df.reset_index()
        cabeca = df.head(MAX_LINHAS).astype(object)
        cabeca = cabeca.where(cabeca.notna(), None)
        return {'tipo': 'tabela', 'colunas': [str(c) for c in df.columns],
                'linhas': cabeca.values.tolist(), 'total': len(df)}
    if isinstance(valor, list) and valor and all(isinstance(x, dict) for x in valor):
        colunas = []
        for x in valor:
            for k in x:
                if k not in colunas:
                    colunas.append(k)
        linhas = [[x.get(k) for k in colunas] for x in valor[:MAX_LINHAS]]
        return {'tipo': 'tabela', 'colunas': [str(c) for c in colunas], 'linhas': linhas, 'total': len(valor)}
    return None


def _imagem_de(valor):
    # A convencao do Jupyter: quem sabe se desenhar, diz como.
    try:
        png = getattr(valor, '_repr_png_', None)
        if callable(png):
            dados = png()
            if dados:
                return {'tipo': 'imagem', 'mime': 'image/png', 'dados': base64.b64encode(dados).decode('ascii')}
        svg = getattr(valor, '_repr_svg_', None)
        if callable(svg):
            dados = svg()
            if dados:
                return {'tipo': 'imagem', 'mime': 'image/svg+xml',
                        'dados': base64.b64encode(dados.encode('utf-8')).decode('ascii')}
    except Exception:
        return None
    # Figura do matplotlib como ultima expressao (ex.: plt.gcf()).
    if type(valor).__name__ == 'Figure' and type(valor).__module__.startswith('matplotlib'):
        return _png_da_figura(valor)
    return None


def _png_da_figura(figura):
    buffer = io.BytesIO()
    figura.savefig(buffer, format='png', bbox_inches='tight')
    return {'tipo': 'imagem', 'mime': 'image/png', 'dados': base64.b64encode(buffer.getvalue()).decode('ascii')}


def _figuras_abertas(execucao):
    # Toda figura do matplotlib que a celula deixou aberta vira imagem, e fecha:
    # e o que o Jupyter faz com o 'inline'.
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    for numero in plt.get_fignums():
        try:
            enviar({'tipo': 'resultado', 'exec': execucao, 'saida': _png_da_figura(plt.figure(numero))})
        except Exception as e:
            enviar({'tipo': 'texto', 'fluxo': 'erro', 'texto': 'Figura %s nao desenhou: %s\n' % (numero, e)})
    plt.close('all')


_execucao_atual = None

# O show() do modo sem janela so reclama ("FigureCanvasAgg is non-interactive").
# No Jupyter ele DESENHA ali; aqui tambem: vira "mostre as figuras abertas agora".
warnings.filterwarnings('ignore', message='.*non-interactive.*')


def _show_no_lugar(*_a, **_k):
    _figuras_abertas(_execucao_atual)


def _trocar_show():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is not None and getattr(plt, 'show', None) is not _show_no_lugar:
        plt.show = _show_no_lugar


def display(*valores):
    # O display() do Jupyter: mostra no meio da celula, nao so no fim.
    for v in valores:
        mostrar(_execucao_atual, v)


ns['display'] = display


def mostrar(execucao, valor):
    imagem = _imagem_de(valor)
    if imagem is not None:
        enviar({'tipo': 'resultado', 'exec': execucao, 'saida': imagem})
        return
    saida = tabela_de(valor)
    if saida is None:
        texto = repr(valor)
        if len(texto) > MAX_TEXTO:
            texto = texto[:MAX_TEXTO] + '\n… (cortado)'
        saida = {'tipo': 'texto', 'fluxo': 'saida', 'texto': texto + '\n'}
    enviar({'tipo': 'resultado', 'exec': execucao, 'saida': saida})


def traceback_da_celula(nome):
    # Só os quadros da CÉLULA: os do driver são ruído para quem lê.
    tipo, erro, tb = sys.exc_info()
    quadros = [q for q in traceback.extract_tb(tb) if q.filename == nome]
    linhas = traceback.format_list(quadros) + traceback.format_exception_only(tipo, erro)
    return ''.join(linhas)


def executar(execucao, codigo):
    global _executando
    nome = '<célula>'
    ok = False
    try:
        try:
            arvore = ast.parse(codigo, filename=nome, mode='exec')
        except SyntaxError:
            enviar({'tipo': 'erro', 'exec': execucao,
                    'mensagem': ''.join(traceback.format_exception_only(*sys.exc_info()[:2]))})
            return
        ultima = None
        if arvore.body and isinstance(arvore.body[-1], ast.Expr):
            ultima = ast.Expression(arvore.body.pop().value)
        global _execucao_atual
        _execucao_atual = execucao
        _executando = True
        try:
            _trocar_show()
            exec(compile(arvore, nome, 'exec'), ns)
            _trocar_show()
            valor = None
            if ultima is not None:
                valor = eval(compile(ultima, nome, 'eval'), ns)
            # As figuras abertas vem ANTES do valor, como no Jupyter; e uma
            # figura que ja e o valor nao sai duas vezes.
            eh_figura = type(valor).__name__ == 'Figure' and type(valor).__module__.startswith('matplotlib')
            if not eh_figura:
                _figuras_abertas(execucao)
            if valor is not None and not (type(valor).__name__ in ('Axes', 'AxesSubplot') or _eh_lista_de_artistas(valor)):
                mostrar(execucao, valor)
            if eh_figura:
                sys.modules['matplotlib.pyplot'].close('all')
            ok = True
        except KeyboardInterrupt:
            enviar({'tipo': 'erro', 'exec': execucao, 'mensagem': 'Interrompido.'})
        except SystemExit:
            enviar({'tipo': 'erro', 'exec': execucao,
                    'mensagem': 'exit() foi ignorado: ele encerraria o kernel. Use Reiniciar.'})
        except BaseException:
            enviar({'tipo': 'erro', 'exec': execucao, 'mensagem': traceback_da_celula(nome)})
    finally:
        _executando = False
        # Um interromper que chegue AGORA não pode engolir o "fim": sem ele o
        # motor esperaria para sempre por uma célula que já acabou.
        while True:
            try:
                enviar({'tipo': 'fim', 'exec': execucao, 'ok': ok})
                break
            except KeyboardInterrupt:
                continue


_definindo = None


def definir(pedido):
    global _definindo
    tipo = pedido['tipo']
    if tipo == 'definir-inicio':
        _definindo = {'nome': pedido['nome'], 'colunas': pedido['colunas'], 'linhas': []}
    elif tipo == 'definir-lote' and _definindo is not None:
        _definindo['linhas'].extend(pedido['linhas'])
    elif tipo == 'definir-fim' and _definindo is not None:
        d, _definindo = _definindo, None
        forma = 'lista'
        valor = [dict(zip(d['colunas'], l)) for l in d['linhas']]
        if importlib.util.find_spec('pandas') is not None:
            import pandas
            valor = pandas.DataFrame(d['linhas'], columns=d['colunas'])
            forma = 'DataFrame'
        ns[d['nome']] = valor
        # Chegou igual em todas as linguagens: nao e "mudanca" a exportar.
        _lembrar(d['nome'])
        enviar({'tipo': 'definido', 'nome': d['nome'], 'linhas': len(d['linhas']), 'forma': forma})


# ---- A cascata entre linguagens (spec 113) ----
# O motor pede "o que mudou?" (exportar) e entrega o que outra linguagem mudou
# (importar). So DADO passa: numeros, textos, listas, dicionarios, datas e
# DataFrames (como tabela). A impressao digital (sha1 do JSON) diz o que mudou,
# inclusive por dentro, como df['x'] = 1, que nao e reatribuicao.
TABELA = '__braytech_tabela__'
_impressoes = {}
_iniciais = set()


class _NaoSerializavel(Exception):
    pass


def _dado(v, ancestrais):
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if v == v and v not in (float('inf'), float('-inf')) else None
    t = type(v)
    modulo = t.__module__ or ''
    if t.__name__ in ('NaTType', 'NAType'):
        return None
    if modulo.startswith('numpy') and hasattr(v, 'tolist'):
        return _dado(v.tolist(), ancestrais)
    if t.__name__ == 'Decimal':
        return float(v)
    if hasattr(v, 'isoformat') and not isinstance(v, type):
        return v.isoformat()
    if modulo.startswith('pandas') and t.__name__ == 'Series':
        return _dado(v.tolist(), ancestrais)
    if id(v) in ancestrais:
        raise _NaoSerializavel()
    ancestrais.add(id(v))
    try:
        if isinstance(v, (list, tuple, set, frozenset)):
            return [_dado(x, ancestrais) for x in v]
        if isinstance(v, dict):
            return {str(k): _dado(x, ancestrais) for k, x in v.items()}
        raise _NaoSerializavel()
    finally:
        ancestrais.discard(id(v))


def _exportavel(v):
    if _eh_dataframe(v):
        df = v if type(v.index).__name__ == 'RangeIndex' else v.reset_index()
        colunas = [str(c) for c in df.columns]
        linhas = [[_dado(x, set()) for x in linha] for linha in df.astype(object).itertuples(index=False, name=None)]
        return {TABELA: True, 'colunas': colunas, 'linhas': linhas}
    if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
        colunas = []
        for x in v:
            for k in x.keys():
                if str(k) not in colunas:
                    colunas.append(str(k))
        linhas = [[_dado(x.get(c), set()) for c in colunas] for x in v]
        return {TABELA: True, 'colunas': colunas, 'linhas': linhas}
    return _dado(v, set())


def _eh_do_usuario(nome, v):
    if nome.startswith('_') or nome in _iniciais:
        return False
    if isinstance(v, (types.ModuleType, type)) or (callable(v) and not _eh_dataframe(v)):
        return False
    return True


def _serializado(nome):
    try:
        return json.dumps(_exportavel(ns[nome]), ensure_ascii=False, allow_nan=False)
    except Exception:
        return None


def _impressao(texto):
    return hashlib.sha1(texto.encode('utf-8')).hexdigest()


def _lembrar(nome):
    s = _serializado(nome)
    if s is not None:
        _impressoes[nome] = _impressao(s)


def exportar(pedido):
    partes = []
    for nome, v in list(ns.items()):
        if not _eh_do_usuario(nome, v):
            continue
        s = _serializado(nome)
        if s is None:
            continue
        h = _impressao(s)
        if _impressoes.get(nome) == h:
            continue
        _impressoes[nome] = h
        partes.append(json.dumps(nome) + ':' + s)
    # Montado a mao: o valor ja e JSON, e serializar de novo dobraria o custo.
    with _trava:
        _canal.write(MARCA + '{"tipo":"exportado","pedido":' + str(int(pedido.get('pedido') or 0)) +
                     ',"valores":{' + ','.join(partes) + '}}\n')
        _canal.flush()


def _de_tabela(v):
    if isinstance(v, dict) and v.get(TABELA) is True:
        if importlib.util.find_spec('pandas') is not None:
            import pandas
            return pandas.DataFrame(v['linhas'], columns=v['colunas'])
        return [dict(zip(v['colunas'], linha)) for linha in v['linhas']]
    return v


def importar(pedido):
    for nome, v in (pedido.get('valores') or {}).items():
        ns[nome] = _de_tabela(v)
        _lembrar(nome)
    enviar({'tipo': 'importado', 'pedido': pedido.get('pedido')})


def _como_parametro(v):
    # Para o {{nome}} do SQL: so valores que um banco aceita como parametro.
    t = type(v)
    if t.__name__ == 'DataFrame' and t.__module__.startswith('pandas'):
        if len(v.columns) != 1:
            raise ValueError('e um DataFrame com %d colunas; guarde a coluna numa variavel (ids = list(df["id"]))' % len(v.columns))
        v = v.iloc[:, 0]
    if hasattr(v, 'tolist') and not isinstance(v, (str, bytes)):
        v = v.tolist()
    elif hasattr(v, 'item') and callable(v.item) and t.__module__.startswith('numpy'):
        v = v.item()
    if isinstance(v, (set, tuple, frozenset)):
        v = list(v)
    if isinstance(v, list):
        return [_como_parametro(x) for x in v]
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    return str(v)


def obter(pedido):
    valores, faltando, erros = {}, [], {}
    for nome in pedido.get('nomes', []):
        if nome not in ns:
            faltando.append(nome)
            continue
        try:
            valores[nome] = _como_parametro(ns[nome])
        except Exception as e:
            erros[nome] = str(e)
    enviar({'tipo': 'valores', 'pedido': pedido.get('pedido'), 'valores': valores,
            'faltando': faltando, 'erros': erros})


def principal():
    _iniciais.update(ns.keys())
    threading.Thread(target=ler_pedidos, daemon=True).start()
    enviar({'tipo': 'pronto', 'versao': sys.version.split()[0], 'executavel': sys.executable,
            'pandas': importlib.util.find_spec('pandas') is not None})
    while True:
        try:
            pedido = _pedidos.get()
        except KeyboardInterrupt:
            # Um interromper que chegou entre duas células: nada a interromper.
            continue
        if pedido is None:
            return
        try:
            if pedido.get('tipo') == 'executar':
                executar(pedido.get('exec'), pedido.get('codigo', ''))
            elif str(pedido.get('tipo', '')).startswith('definir'):
                definir(pedido)
            elif pedido.get('tipo') == 'obter':
                obter(pedido)
            elif pedido.get('tipo') == 'exportar':
                exportar(pedido)
            elif pedido.get('tipo') == 'importar':
                importar(pedido)
        except KeyboardInterrupt:
            continue


principal()
`;
