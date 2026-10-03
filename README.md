# Painel Saúde — front-end

Painel web para consultar os **estabelecimentos de saúde do CNES** (Ministério da Saúde) por estado e cidade, com indicadores, gráficos, lista, mapa e busca "perto de mim".

É um front-end estático (**HTML + CSS + JavaScript puro**, sem framework e sem build) que consome a API do projeto **Orchestra** (back-end Laravel, pasta `orchestra-laravel`).

```
┌──────────────────────┐   fetch (JSON)   ┌───────────────────────┐   importação   ┌──────────────┐
│  orchestra-painel    │ ───────────────▶ │  orchestra-laravel    │ ◀───────────── │  API do CNES │
│  (este projeto)      │   /api/saude/*   │  API + banco SQLite   │   (workflow)   │  + IBGE      │
│  127.0.0.1:5500      │ ◀─────────────── │  127.0.0.1:8001       │                └──────────────┘
└──────────────────────┘                  └───────────────────────┘
```

---

## Sumário
1. [Funcionalidades](#1-funcionalidades)
2. [Como rodar](#2-como-rodar)
3. [Configuração](#3-configuração)
4. [Estrutura de arquivos](#4-estrutura-de-arquivos)
5. [Como o código funciona](#5-como-o-código-funciona)
6. [API consumida](#6-api-consumida)
7. [Estilos e tema](#7-estilos-e-tema)
8. [Publicação (produção)](#8-publicação-produção)
9. [Problemas comuns](#9-problemas-comuns)
10. [Repositórios e versionamento (Git)](#10-repositórios-e-versionamento-git)

---

## 1. Funcionalidades

| Área | O que faz |
|---|---|
| **Filtros** (coluna lateral) | **Estado** (os 27: 26 + DF) → **Município** (todas as cidades do estado, segundo o IBGE) → **Gestão** (pública, privada, filantrópica) → **Tipo de unidade** (só os tipos que existem na cidade para a gestão escolhida) → **Busca** por nome da clínica ou código CNES. |
| **Barra de filtros ativos** | Mostra cada filtro aplicado (ex.: `Cidade: Palmas (TO) ×`). O "×" remove só aquele filtro. Tudo abaixo (indicadores, gráficos, lista, mapa) segue esses filtros. |
| **Indicadores** | Total de estabelecimentos e quantos são públicos, privados e filantrópicos. |
| **Gráficos** | Barras com os 10 tipos de unidade mais comuns e rosca por gestão. |
| **Lista** | Cartões com nome, tipo, selo de gestão, endereço, telefone e e-mail clicáveis, botões **Google Maps** e **Waze**. Paginação de 12 em 12. |
| **Mapa** | Pontos coloridos por gestão (OpenStreetMap + Leaflet). O balão de cada ponto tem "Ver detalhes" e "Como chegar". |
| **Detalhe** | Janela com CNPJ, razão social, esfera, atendimento SUS, turno, endereço, CEP, telefone e e-mail. Fecha só pelo "×". |
| **Perto de mim** | Usa a localização do navegador e mostra o que há num raio de 10 km, com a distância de cada um. |
| **Responsivo e tema escuro** | Funciona no celular e segue o tema claro/escuro do sistema. |

A busca ignora acentos e maiúsculas e aceita as palavras em qualquer ordem: `clínica mulher` encontra "3L CLINICA DA MULHER". Ela procura no nome fantasia, na razão social e no código CNES.

---

## 2. Como rodar

**Pré-requisitos:** a API do Orchestra rodando e PHP (vem com o Laravel Herd) ou outra forma de servir arquivos estáticos.

1. **Suba a API**, na pasta `orchestra-laravel`:
   ```
   php artisan serve --port=8001
   ```
2. **Sirva esta pasta por HTTP**, na pasta `orchestra-painel`:
   ```
   php -S 127.0.0.1:5500
   ```
   Alternativas: extensão **Live Server** do VS Code (botão direito no `index.html` → *Open with Live Server*) ou `npx serve -l 5500`.
3. Abra **http://127.0.0.1:5500**.

> Não abra o `index.html` com duplo clique (`file://`): o "Perto de mim" só funciona em `http://` ou `https://`.

**O painel fica vazio?** Os dados vêm do banco do Orchestra. Só aparecem as cidades já importadas do CNES (ex.: `php artisan cnes:buscar --uf=TO --max-pages=1000 --salvar` no back-end).

---

## 3. Configuração

### Front-end: `js/config.js`
```js
window.PAINEL_CONFIG = {
    apiUrl: 'http://127.0.0.1:8001',   // endereço do back-end, sem /api no final
};
```

### Back-end: `.env` do `orchestra-laravel`
O navegador só deixa o painel chamar a API se o endereço do painel estiver liberado (CORS):
```
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5500,http://localhost:5500
```
Depois de mudar o `.env`, reinicie o `php artisan serve`.

---

## 4. Estrutura de arquivos

```
orchestra-painel/
├── index.html        estrutura da página: cabeçalho, filtros, indicadores, gráficos, lista/mapa, janela de detalhe
├── css/
│   └── painel.css    estilos: variáveis de cor, layout em grade, componentes, tema escuro, responsivo
├── js/
│   ├── config.js     endereço da API (único arquivo a mudar entre ambientes)
│   └── painel.js     toda a lógica da tela
└── README.md         esta documentação
```

Bibliotecas externas, carregadas por CDN no `index.html` (não há nada para instalar):

| Biblioteca | Uso |
|---|---|
| [Leaflet 1.9.4](https://leafletjs.com/) (cdnjs) | mapa interativo |
| OpenStreetMap | imagens do mapa |
| Fonte **Inter** (Google Fonts) | tipografia |

---

## 5. Como o código funciona

### 5.1 Estado da tela
Tudo o que o usuário escolheu fica num único objeto, `state`, em `js/painel.js`. As funções leem desse objeto e redesenham a tela:

```js
const state = {
    mode: 'cidade',     // 'cidade' (filtros) | 'perto' (GPS)
    uf: '',             // sigla, ex.: 'TO'
    municipio: null,    // { municipality_code, municipality_name, total }
    tipo: '',           // gestão: publico | privado | filantropico
    typeCode: '',       // tipo de unidade
    q: '',              // busca por nome/CNES
    page: 1,
    view: 'lista',      // 'lista' | 'mapa'
    coords: null,       // { lat, lng } no modo "perto de mim"
    mapDirty: true,     // mapa precisa recarregar quando a aba abrir
};
```

### 5.2 Fluxo
```
carregarUfs() ─▶ usuário escolhe o Estado ─▶ mudarUf() ─▶ carregarMunicipios()
                                                │
usuário escolhe a Cidade ─▶ escolherMunicipio() ─▶ carregarTipos() + atualizar()
                                                                        │
qualquer filtro mudou ─────────────────────────────────────────▶ atualizar()
                                                                        ├─ renderChips()          barra de filtros
                                                                        ├─ carregarEstatisticas() indicadores e gráficos
                                                                        ├─ carregarLista()        cartões e paginação
                                                                        └─ carregarMapa()         se a aba Mapa estiver aberta
"Perto de mim" ─▶ GPS ─▶ state.mode = 'perto' ─▶ atualizar() ─▶ carregarProximos()
```

### 5.3 Funções por seção (`js/painel.js`)

| Seção | Funções | Papel |
|---|---|---|
| Utilidades | `api()`, `filtros()`, `esc()`, `titleCase()`, `fmt()`, `debounce()`, `showAlert()`, `linkTelefone()`, `linkEmail()` | `api()` faz o `fetch` e transforma erro da API em mensagem; `filtros()` monta os parâmetros a partir do `state`; `esc()` protege contra HTML vindo da API. |
| Estado | `carregarUfs()`, `mudarUf()` | Preenche o select com os 27 estados; seleciona sozinho se só um tiver dados. |
| Município | `carregarMunicipios()`, `escolherMunicipio()`, `limparMunicipio()` | Lista as cidades do estado (com dados primeiro). |
| Tipos/gestão/busca | `carregarTipos()` + ouvintes dos campos | Os tipos se ajustam à gestão; a busca espera 400 ms de pausa na digitação. |
| Barra de filtros | `renderChips()` | Desenha os filtros ativos e trata o "×". |
| Indicadores | `carregarEstatisticas()`, `renderEstatisticas()`, `estatisticasLocais()` | No modo "perto de mim" os números são calculados no próprio navegador. |
| Lista | `carregarLista()`, `renderCards()`, `renderPaginacao()`, `botoesRota()` | 12 por página; clicar no cartão abre o detalhe. |
| Perto de mim | `carregarProximos()` | Raio de 10 km, até 50 resultados. |
| Mapa | `iniciarMapa()`, `carregarMapa()`, `limparMarcadores()` | O mapa só é criado quando a aba abre pela primeira vez. |
| Detalhe | `abrirDetalhe()` | Busca o estabelecimento completo e mostra numa `<dialog>`. |

### 5.4 Decisões importantes
- **Código do município, não o nome:** o select guarda o `municipality_code` e é ele que vai para a API, evitando confusão entre cidades de nomes parecidos.
- **Formatação no back-end:** telefone (`(63) 3215-2393`, `(63) 98429-6008`) e e-mail (minúsculo, sem lixo) já chegam padronizados da API; o front-end só os transforma em links `tel:` e `mailto:`.
- **Segurança:** todo texto vindo da API passa por `esc()` antes de entrar no HTML.
- **Lista e mapa exigem estado + cidade** (regra da API); sem cidade, só os indicadores do estado aparecem.

---

## 6. API consumida

Todos os endereços abaixo são relativos a `<apiUrl>/api/saude`. Documentação completa no back-end: `orchestra-laravel/docs/DOCUMENTACAO.md`, seção 8.

| Chamada | Quando o painel usa |
|---|---|
| `GET /filtros/ufs?todos=1` | ao abrir: os 27 estados |
| `GET /filtros/municipios?uf=TO&todos=1` | ao escolher o estado |
| `GET /filtros/tipos?uf=TO&municipio=172100&tipo=publico` | ao escolher a cidade ou a gestão |
| `GET /estatisticas?uf=…&municipio=…&tipo=…&type_code=…&q=…` | indicadores e gráficos |
| `GET /estabelecimentos?…&page=1&per_page=12` | lista |
| `GET /mapa?…` | aba Mapa (até 2.000 pontos) |
| `GET /estabelecimentos/{cnes}` | janela de detalhe |
| `GET /proximos?lat=…&lng=…&raio=10&limite=50` | "Perto de mim" |

Erros de validação (422) aparecem na tela com a mensagem da API, ex.: "Selecione o município.".

---

## 7. Estilos e tema

As cores ficam em variáveis no topo de `css/painel.css` — mude ali para trocar o visual inteiro:

| Variável | Uso |
|---|---|
| `--primary`, `--primary-2`, `--primary-soft` | cor principal (verde-azulado), destaques e filtros ativos |
| `--publico`, `--privado`, `--filantropico` | cores da gestão (selos, indicadores, rosca e mapa) |
| `--bg`, `--surface`, `--border`, `--text`, `--muted` | fundo, cartões, bordas e textos |
| `--radius`, `--shadow`, `--font` | cantos, sombra e fonte |

- **Tema escuro:** automático, pelo bloco `@media (prefers-color-scheme: dark)`, que redefine as mesmas variáveis.
- **Responsivo:** abaixo de 1100 px os gráficos empilham; abaixo de 900 px os filtros vão para cima; abaixo de 520 px tudo vira uma coluna.
- As cores do mapa ficam em `corGestao`, em `js/painel.js` (o Leaflet precisa da cor em hexadecimal).

---

## 8. Publicação (produção)

1. Publique esta pasta em qualquer hospedagem de arquivos estáticos (Nginx, Apache, Netlify, GitHub Pages, S3…). Não há build.
2. Em `js/config.js`, troque `apiUrl` pelo endereço público da API (com `https`).
3. No `.env` do back-end, coloque o endereço público do painel em `CORS_ALLOWED_ORIGINS`.
4. Use `https` nos dois: o "Perto de mim" (GPS) não funciona em `http` fora do `localhost`.

---

## 9. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| "Failed to fetch" / nada carrega | API desligada ou `apiUrl` errado | suba o `php artisan serve --port=8001` e confira `js/config.js` |
| Erro de CORS no console do navegador | endereço do painel não liberado | adicione-o em `CORS_ALLOWED_ORIGINS` no `.env` e reinicie a API |
| Cidade sem estabelecimentos | cidade ainda não importada do CNES | importe no back-end (`php artisan cnes:buscar … --salvar`) |
| "Perto de mim" não funciona | página aberta por `file://` ou permissão negada | sirva por `http://` e permita a localização no navegador |
| Mapa cinza | sem internet (o mapa vem do OpenStreetMap) | verifique a conexão |

---

## 10. Repositórios e versionamento (Git)

O sistema é formado por **dois projetos independentes**, cada um com o seu repositório, publicados no **GitLab** e no **GitHub**:

| Projeto | O que é | GitLab (principal) | GitHub (espelho) |
|---|---|---|---|
| `orchestra-laravel` | back-end: API + workflows + banco | https://gitlab.com/valber-code/orchestra-laravel | https://github.com/valbersp/orchestra-laravel |
| `orchestra-painel` | front-end: painel web (HTML/CSS/JS) | https://gitlab.com/valber-code/orchestra-painel | https://github.com/valbersp/orchestra-painel |

Os dois se comunicam só pela API (`/api/saude/*`). Dá para alterar e publicar um sem mexer no outro, mas, quando a API muda, confira se o painel continua funcionando.

### 10.1 Baixar os projetos numa máquina nova
```powershell
git clone https://gitlab.com/valber-code/orchestra-laravel.git
git clone https://gitlab.com/valber-code/orchestra-painel.git
```
Depois siga o "Como rodar" de cada um. No back-end é preciso criar o `.env` e rodar `composer install`, porque `.env` e `vendor/` não vão para o git.

### 10.2 Um `git push`, dois destinos
Em cada projeto, o remoto `origin` está configurado para **enviar ao GitLab e ao GitHub ao mesmo tempo**. O download (`git pull`) vem do GitLab.
```
origin  https://gitlab.com/valber-code/<projeto>.git (fetch)
origin  https://gitlab.com/valber-code/<projeto>.git (push)
origin  https://github.com/valbersp/<projeto>.git    (push)
github  https://github.com/valbersp/<projeto>.git    (só GitHub)
```
Numa máquina nova (depois do `git clone`), para repetir essa configuração:
```powershell
git remote set-url --add --push origin https://gitlab.com/valber-code/<projeto>.git
git remote set-url --add --push origin https://github.com/valbersp/<projeto>.git
git config user.email "valbersilvapinto@gmail.com"
```

### 10.3 Dia a dia
```powershell
git status                       # o que mudou
git add -A                       # prepara tudo para o commit
git commit -m "O que mudou"      # salva uma "foto" com mensagem
git push                         # envia para GitLab e GitHub
git log --oneline                # histórico
```
- Os commits usam o e-mail `valbersilvapinto@gmail.com` (configurado em cada projeto com `git config user.email`).
- O branch `main` é protegido no GitLab: não aceita reescrita de histórico (force push), a não ser que a proteção seja liberada em *Settings → Repository → Protected branches*.
- O `.gitignore` impede que `.env`, `vendor/` e o banco SQLite sejam enviados. Nunca coloque senhas no código.
