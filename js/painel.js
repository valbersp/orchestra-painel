/* =========================================================
   PAINEL SAÚDE — lógica da tela
   Consome a API do Orchestra (Laravel) em <apiUrl>/api/saude/*.
   O endereço da API fica em js/config.js.

   Fluxo:
     Estado → Município → lista, mapa, tipos
     "Perto de mim" → usa o GPS e chama /proximos
   ========================================================= */

const API = `${(window.PAINEL_CONFIG?.apiUrl ?? 'http://127.0.0.1:8001').replace(/\/+$/, '')}/api/saude`;

const GESTAO = {
    publico: { label: 'Pública', color: 'var(--publico)' },
    privado: { label: 'Privada', color: 'var(--privado)' },
    filantropico: { label: 'Filantrópica', color: 'var(--filantropico)' },
};

// Tudo o que o usuário escolheu fica aqui; a tela é redesenhada a partir deste objeto.
const state = {
    mode: 'cidade',        // 'cidade' | 'perto'
    uf: '',
    municipio: null,       // { municipality_code, municipality_name }
    tipo: '',
    typeCode: '',
    q: '',
    page: 1,
    view: 'lista',         // 'lista' | 'mapa'
    coords: null,          // { lat, lng } no modo "perto de mim"
    mapDirty: true,        // mapa precisa ser recarregado quando a aba abrir
};

const $ = (sel) => document.querySelector(sel);
const el = {
    uf: $('#f-uf'),
    municipio: $('#f-municipio'),
    tipo: $('#f-tipo'),
    typeCode: $('#f-type-code'),
    q: $('#f-q'),
    lista: $('#lista'),
    paginacao: $('#paginacao'),
    alert: $('#alert'),
    resultsTitle: $('#results-title'),
    resultsSub: $('#results-sub'),
    viewLista: $('#view-lista'),
    viewMapa: $('#view-mapa'),
    detalhe: $('#detalhe'),
};

/* ---------------- utilidades ---------------- */

/** Escapa texto vindo da API antes de pôr no HTML (evita injeção de HTML/JS). */
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "HOSPITAL GERAL DE PALMAS" → "Hospital Geral de Palmas" */
function titleCase(s) {
    const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);
    return String(s ?? '').toLowerCase().replace(/\S+/g, (w, i) =>
        i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));
}

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

/** "(63) 3215-2393 / (63) 98429-6008" → um link tel: para cada número */
const linkTelefone = (tel) => tel.split(' / ').map((t) =>
    `<a href="tel:+55${t.replace(/\D/g, '')}">${esc(t)}</a>`).join(' / ');
const linkEmail = (email) => `<a href="mailto:${esc(email)}">${esc(email)}</a>`;

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** GET na API. Em erro, lança a mensagem que o Laravel devolve (ex.: "Selecione o município."). */
async function api(path, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const res = await fetch(`${API}/${path}${qs.size ? '?' + qs : ''}`, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `Erro ${res.status} ao consultar a API.`);
    return body;
}

/** Filtros atuais no formato que a API espera. */
function filtros() {
    return {
        uf: state.uf,
        municipio: state.municipio?.municipality_code,
        tipo: state.tipo,
        type_code: state.typeCode,
        q: state.q,
    };
}

function showAlert(msg, kind = 'error') {
    el.alert.textContent = msg;
    el.alert.className = 'alert' + (kind === 'info' ? ' alert--info' : '');
    el.alert.hidden = !msg;
}

const icon = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>',
};

/* ---------------- filtros: Estado ---------------- */

/** Os 27 estados (26 + DF) vêm da API com o total de estabelecimentos importados de cada um. */
async function carregarUfs() {
    try {
        const ufs = await api('filtros/ufs', { todos: 1 });
        el.uf.innerHTML = '<option value="">Selecione o estado</option>' + ufs.map((u) =>
            `<option value="${esc(u.sigla)}">${esc(u.nome)} (${esc(u.sigla)})</option>`).join('');
        const comDados = ufs.filter((u) => u.total > 0);
        if (comDados.length === 1) {      // só um estado com dados? já seleciona
            el.uf.value = comDados[0].sigla;
            await mudarUf(comDados[0].sigla);
        }
    } catch (e) {
        el.uf.innerHTML = '<option value="">Erro ao carregar</option>';
        showAlert(e.message);
    }
}

async function mudarUf(uf) {
    state.mode = 'cidade';
    state.uf = uf;
    limparMunicipio(false);
    renderChips();
    carregarEstatisticas();
    renderAguardando();
    await carregarMunicipios();
}

/* ---------------- filtros: Município (cidades do estado escolhido) ---------------- */

let municipios = [];

async function carregarMunicipios() {
    municipios = [];
    el.municipio.disabled = true;
    if (!state.uf) {
        el.municipio.innerHTML = '<option value="">Escolha o estado</option>';
        return;
    }
    el.municipio.innerHTML = '<option value="">Carregando cidades…</option>';
    try {
        const uf = state.uf;
        const lista = await api('filtros/municipios', { uf, todos: 1 });
        if (uf !== state.uf) return;     // o usuário trocou de estado enquanto carregava

        municipios = lista;
        const opcao = (m) => `<option value="${esc(m.municipality_code)}">${esc(m.municipality_name)} (${esc(uf)})</option>`;
        const comDados = lista.filter((m) => m.total > 0);
        const semDados = lista.filter((m) => !m.total);
        // com dados primeiro; se todas (ou nenhuma) tiverem, uma lista só
        el.municipio.innerHTML = '<option value="">Selecione a cidade</option>' +
            (comDados.length && semDados.length
                ? `<optgroup label="Com estabelecimentos importados">${comDados.map(opcao).join('')}</optgroup>
                   <optgroup label="Outras cidades">${semDados.map(opcao).join('')}</optgroup>`
                : lista.map(opcao).join(''));
        el.municipio.disabled = !lista.length;
    } catch (e) {
        el.municipio.innerHTML = '<option value="">Erro ao carregar cidades</option>';
        showAlert(e.message);
    }
}

function escolherMunicipio(m) {
    state.mode = 'cidade';
    state.municipio = m;
    state.typeCode = '';
    el.municipio.value = m.municipality_code;
    carregarTipos();
    atualizar();
}

function limparMunicipio(recarregar = true) {
    state.municipio = null;
    state.typeCode = '';
    el.municipio.value = '';
    el.typeCode.innerHTML = '<option value="">Escolha o município</option>';
    el.typeCode.disabled = true;
    if (recarregar) { renderChips(); carregarEstatisticas(); renderAguardando(); }
}

el.municipio.addEventListener('change', () => {
    const m = municipios.find((x) => x.municipality_code === el.municipio.value);
    m ? escolherMunicipio(m) : limparMunicipio();
});

/* ---------------- filtros: tipo de unidade, gestão, busca ---------------- */

/** Tipos de unidade da cidade, já considerando a gestão escolhida (ex.: só os tipos que têm unidade pública). */
async function carregarTipos() {
    if (!state.municipio) return;
    el.typeCode.disabled = true;
    try {
        const tipos = await api('filtros/tipos', { uf: state.uf, municipio: state.municipio.municipality_code, tipo: state.tipo });
        el.typeCode.innerHTML = '<option value="">Todos os tipos</option>' +
            tipos.map((t) => `<option value="${esc(t.type_code)}">${esc(t.type_name)}</option>`).join('');
        // o tipo escolhido não existe para esta gestão? volta para "Todos"
        if (state.typeCode && !tipos.some((t) => t.type_code === state.typeCode)) state.typeCode = '';
        el.typeCode.value = state.typeCode;
        el.typeCode.disabled = false;
    } catch (e) {
        showAlert(e.message);
    }
}

el.uf.addEventListener('change', () => mudarUf(el.uf.value));
el.tipo.addEventListener('change', async () => {
    state.tipo = el.tipo.value;
    await carregarTipos(); // pode limpar o tipo de unidade, então vem antes de atualizar
    atualizar();
});
el.typeCode.addEventListener('change', () => { state.typeCode = el.typeCode.value; atualizar(); });
el.q.addEventListener('input', debounce(() => { state.q = el.q.value.trim(); atualizar(); }, 400));

$('#btn-limpar').addEventListener('click', () => {
    state.tipo = state.q = '';
    el.tipo.value = el.q.value = '';
    if (state.mode === 'perto') { state.mode = 'cidade'; state.coords = null; }
    limparMunicipio();
});

/* ---------------- barra de filtros ativos ---------------- */

/** Mostra, acima dos indicadores, cada filtro aplicado com um "×" para removê-lo. */
function renderChips() {
    const nomeUf = el.uf.selectedOptions[0]?.text;
    const chips = state.mode === 'perto'
        ? [['perto', 'Perto de mim (10 km)']]
        : [
            state.uf && ['uf', `Estado: ${nomeUf}`],
            state.municipio && ['municipio', `Cidade: ${state.municipio.municipality_name} (${state.uf})`],
        ];
    chips.push(
        state.tipo && ['tipo', `Gestão: ${GESTAO[state.tipo].label}`],
        state.typeCode && ['typeCode', `Tipo: ${el.typeCode.selectedOptions[0]?.text}`],
        state.q && ['q', `Busca: “${state.q}”`],
    );
    const ativos = chips.filter(Boolean);
    $('#chips').innerHTML = ativos.length
        ? '<span class="chips__label">Filtros:</span>' + ativos.map(([k, txt]) =>
            `<span class="chip">${esc(txt)}<button type="button" data-remove="${k}" aria-label="Remover filtro">×</button></span>`).join('')
        : '<span class="chips__label">Nenhum filtro aplicado — mostrando todos os estados.</span>';
}

$('#chips').addEventListener('click', async (ev) => {
    const k = ev.target.closest('[data-remove]')?.dataset.remove;
    if (!k) return;
    if (k === 'uf') { el.uf.value = ''; return mudarUf(''); }
    if (k === 'municipio') return limparMunicipio();
    if (k === 'perto') { state.mode = 'cidade'; state.coords = null; }
    if (k === 'tipo') { state.tipo = el.tipo.value = ''; await carregarTipos(); }
    if (k === 'typeCode') state.typeCode = el.typeCode.value = '';
    if (k === 'q') state.q = el.q.value = '';
    atualizar();
});

/** Recarrega tudo que depende dos filtros. */
function atualizar() {
    renderChips();
    state.page = 1;
    state.mapDirty = true;
    if (state.mode === 'perto') return carregarProximos();
    carregarEstatisticas();
    if (!state.municipio) return renderAguardando();
    carregarLista();
    if (state.view === 'mapa') carregarMapa();
}

/* ---------------- indicadores e gráficos ---------------- */

async function carregarEstatisticas() {
    if (!state.uf) return renderEstatisticas(null);
    try {
        renderEstatisticas(await api('estatisticas', filtros()));
    } catch (e) {
        showAlert(e.message);
    }
}

function renderEstatisticas(s) {
    const g = s?.by_management ?? {};
    $('#k-total').textContent = s ? fmt(s.total) : '–';
    for (const k of Object.keys(GESTAO)) $(`#k-${k}`).textContent = s ? fmt(g[k]) : '–';

    // barras: tipos mais comuns
    const tipos = Object.entries(s?.by_type ?? {});
    const max = Math.max(1, ...tipos.map(([, v]) => v));
    $('#chart-tipos').innerHTML = tipos.length
        ? tipos.map(([nome, v]) => `
            <div class="bar" title="${esc(nome)}: ${fmt(v)}">
                <span class="bar__name">${esc(nome)}</span><span class="bar__value">${fmt(v)}</span>
                <div class="bar__track"><div class="bar__fill" data-w="${(v / max) * 100}"></div></div>
            </div>`).join('')
        : `<p class="muted">${s ? 'Sem dados para estes filtros.' : 'Escolha um estado.'}</p>`;
    // anima as barras no próximo quadro
    requestAnimationFrame(() => document.querySelectorAll('.bar__fill').forEach((b) => { b.style.width = b.dataset.w + '%'; }));

    // rosca: gestão (conic-gradient com as fatias)
    const total = Object.keys(GESTAO).reduce((t, k) => t + (g[k] || 0), 0);
    let acc = 0;
    const fatias = Object.entries(GESTAO).map(([k, { color }]) => {
        const ini = acc; acc += total ? ((g[k] || 0) / total) * 100 : 0;
        return `${color} ${ini}% ${acc}%`;
    });
    $('#chart-gestao').style.setProperty('--gestao', total ? fatias.join(', ') : 'var(--border) 0 100%');
    $('#donut-total').textContent = s ? fmt(total) : '–';
    $('#legend-gestao').innerHTML = Object.entries(GESTAO).map(([k, { label, color }]) => `
        <li><i style="background:${color}"></i>${label}<b>${s ? fmt(g[k]) : '–'}</b></li>`).join('');
}

/** No modo "perto de mim" as estatísticas são calculadas aqui, a partir dos resultados. */
function estatisticasLocais(itens) {
    const by_management = {}, by_type = {};
    for (const e of itens) {
        by_management[e.management] = (by_management[e.management] || 0) + 1;
        if (e.type_name) by_type[e.type_name] = (by_type[e.type_name] || 0) + 1;
    }
    const top = Object.fromEntries(Object.entries(by_type).sort((a, b) => b[1] - a[1]).slice(0, 10));
    return { total: itens.length, by_management, by_type: top };
}

/* ---------------- lista ---------------- */

function renderAguardando() {
    showAlert('');
    el.resultsTitle.textContent = 'Estabelecimentos';
    el.resultsSub.textContent = state.uf ? 'Agora escolha o município.' : 'Escolha o estado e o município para ver a lista.';
    el.lista.innerHTML = `<div class="empty-state">${icon.search}<p>${state.uf
        ? 'Agora escolha a cidade no filtro <b>Município</b>.'
        : 'Comece escolhendo um <b>Estado</b> ou use <b>Perto de mim</b>.'}</p></div>`;
    el.paginacao.innerHTML = '';
    limparMarcadores();
}

function renderCarregando() {
    el.lista.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
    el.paginacao.innerHTML = '';
}

async function carregarLista() {
    showAlert('');
    renderCarregando();
    try {
        const r = await api('estabelecimentos', { ...filtros(), page: state.page, per_page: 12 });
        el.resultsTitle.textContent = `${state.municipio.municipality_name} — ${state.uf}`;
        el.resultsSub.textContent = r.total
            ? `${fmt(r.total)} estabelecimento(s) · mostrando ${fmt(r.from)}–${fmt(r.to)}`
            : state.municipio.total
                ? 'Nenhum estabelecimento com estes filtros.'
                : 'Ainda não há estabelecimentos importados desta cidade.';
        renderCards(r.data);
        renderPaginacao(r.current_page, r.last_page);
    } catch (e) {
        el.lista.innerHTML = '';
        showAlert(e.message);
    }
}

function renderCards(itens) {
    if (!itens.length) {
        el.lista.innerHTML = `<div class="empty-state">${icon.search}<p>Nada encontrado. Tente outros filtros.</p></div>`;
        return;
    }
    el.lista.innerHTML = itens.map((e) => {
        const g = GESTAO[e.management];
        return `
        <article class="place" tabindex="0" data-cnes="${esc(e.cnes_code)}">
            <div class="place__top">
                <div>
                    <h4 class="place__name">${esc(titleCase(e.name))}</h4>
                    <div class="place__type">${esc(e.type_name || 'Tipo não informado')}</div>
                </div>
                ${g ? `<span class="badge badge--${esc(e.management)}">${g.label}</span>` : ''}
            </div>
            <div class="place__info">
                ${e.distancia_km != null ? `<span class="distance">${icon.pin} ${e.distancia_km.toLocaleString('pt-BR')} km de você</span>` : ''}
                ${e.address ? `<span>${icon.pin}${esc(titleCase(e.address))}</span>` : ''}
                ${e.phone ? `<span>${icon.phone}${linkTelefone(e.phone)}</span>` : ''}
                ${e.email ? `<span>${icon.mail}${linkEmail(e.email)}</span>` : ''}
            </div>
            <div class="place__actions">${botoesRota(e.rotas)}</div>
        </article>`;
    }).join('');
}

function botoesRota(rotas) {
    if (!rotas) return '';
    return [
        rotas.google_maps && `<a class="btn btn--primary btn--sm" href="${esc(rotas.google_maps)}" target="_blank" rel="noopener">Google Maps</a>`,
        rotas.waze && `<a class="btn btn--ghost btn--sm" href="${esc(rotas.waze)}" target="_blank" rel="noopener">Waze</a>`,
    ].filter(Boolean).join('');
}

// clicar no card (fora dos botões) abre o detalhe
el.lista.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const card = ev.target.closest('.place');
    if (card) abrirDetalhe(card.dataset.cnes);
});
el.lista.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('place')) abrirDetalhe(ev.target.dataset.cnes);
});

function renderPaginacao(atual, ultima) {
    if (ultima <= 1) { el.paginacao.innerHTML = ''; return; }
    // mostra 1 … (atual-2 .. atual+2) … última
    const paginas = new Set([1, ultima]);
    for (let p = atual - 2; p <= atual + 2; p++) if (p > 1 && p < ultima) paginas.add(p);
    const lista = [...paginas].sort((a, b) => a - b);

    let html = `<button data-p="${atual - 1}" ${atual === 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>`;
    lista.forEach((p, i) => {
        if (i && p - lista[i - 1] > 1) html += '<span class="dots">…</span>';
        html += `<button data-p="${p}" class="${p === atual ? 'is-active' : ''}">${p}</button>`;
    });
    html += `<button data-p="${atual + 1}" ${atual === ultima ? 'disabled' : ''} aria-label="Próxima">›</button>`;
    el.paginacao.innerHTML = html;
}

el.paginacao.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.p);
    carregarLista();
    document.querySelector('.results').scrollIntoView({ behavior: 'smooth' });
});

/* ---------------- perto de mim (GPS) ---------------- */

$('#btn-perto').addEventListener('click', () => {
    if (!navigator.geolocation) return showAlert('Seu navegador não permite obter a localização.');
    showAlert('Obtendo sua localização…', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            state.mode = 'perto';
            state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            limparMunicipio(false); // a busca agora é pelo GPS, não pela cidade
            atualizar();
        },
        () => showAlert('Não foi possível obter sua localização. Verifique a permissão do navegador.'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

let ultimosProximos = [];

async function carregarProximos() {
    showAlert('');
    renderCarregando();
    try {
        const r = await api('proximos', {
            lat: state.coords.lat, lng: state.coords.lng, raio: 10, limite: 50,
            tipo: state.tipo, type_code: state.typeCode, q: state.q,
        });
        ultimosProximos = r.data;
        el.resultsTitle.textContent = 'Perto de você';
        el.resultsSub.textContent = r.total
            ? `${fmt(r.total)} estabelecimento(s) num raio de ${r.raio_km} km`
            : `Nenhum estabelecimento num raio de ${r.raio_km} km. Os dados cobrem só os municípios já importados.`;
        renderEstatisticas(estatisticasLocais(r.data));
        renderCards(r.data);
        el.paginacao.innerHTML = '';
        state.mapDirty = true;
        if (state.view === 'mapa') carregarMapa();
    } catch (e) {
        el.lista.innerHTML = '';
        showAlert(e.message);
    }
}

/* ---------------- mapa (Leaflet) ---------------- */

let mapa = null;
let camada = null;

function iniciarMapa() {
    if (mapa) return;
    mapa = L.map('mapa').setView([-14.2, -51.9], 4); // Brasil
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
    }).addTo(mapa);
    camada = L.featureGroup().addTo(mapa);
}

function limparMarcadores() {
    camada?.clearLayers();
}

const corGestao = { publico: '#2563eb', privado: '#f59e0b', filantropico: '#db2777' };

async function carregarMapa() {
    iniciarMapa();
    mapa.invalidateSize();
    if (!state.mapDirty) return;
    limparMarcadores();

    let pontos;
    try {
        if (state.mode === 'perto') pontos = ultimosProximos;
        else if (state.municipio) pontos = await api('mapa', filtros());
        else return;
    } catch (e) {
        return showAlert(e.message);
    }
    state.mapDirty = false;

    for (const p of pontos) {
        if (p.latitude == null || p.longitude == null) continue;
        L.circleMarker([p.latitude, p.longitude], {
            radius: 7, weight: 2, color: '#fff', fillOpacity: .9,
            fillColor: corGestao[p.management] || '#64748b',
        }).bindPopup(`
            <strong>${esc(titleCase(p.name))}</strong>
            ${esc(p.type_name || '')}<br>
            ${p.address ? esc(titleCase(p.address)) + '<br>' : ''}
            <a href="#" data-cnes="${esc(p.cnes_code)}" class="ver-detalhe">Ver detalhes</a>
            ${p.rotas?.google_maps ? ` · <a href="${esc(p.rotas.google_maps)}" target="_blank" rel="noopener">Como chegar</a>` : ''}
        `).addTo(camada);
    }
    if (state.mode === 'perto' && state.coords) {
        L.circleMarker([state.coords.lat, state.coords.lng], { radius: 9, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1 })
            .bindPopup('<strong>Você está aqui</strong>').addTo(camada);
    }
    if (camada.getLayers().length) mapa.fitBounds(camada.getBounds(), { padding: [30, 30], maxZoom: 16 });
}

// link "Ver detalhes" dentro do popup do mapa
document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.ver-detalhe');
    if (a) { ev.preventDefault(); abrirDetalhe(a.dataset.cnes); }
});

/* ---------------- abas Lista / Mapa ---------------- */

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab);
    });
    el.viewLista.hidden = state.view !== 'lista';
    el.viewMapa.hidden = state.view !== 'mapa';
    if (state.view === 'mapa') carregarMapa();
}));

/* ---------------- detalhe ---------------- */

async function abrirDetalhe(cnes) {
    $('#detalhe-titulo').textContent = 'Carregando…';
    $('#detalhe-corpo').innerHTML = '<div class="skeleton"></div>';
    el.detalhe.showModal();
    try {
        const e = await api(`estabelecimentos/${encodeURIComponent(cnes)}`);
        const raw = e.raw || {};
        const cep = e.cep || raw.codigo_cep_estabelecimento;
        const linhas = [
            ['CNES', e.cnes_code],
            ['Razão social', raw.nome_razao_social && titleCase(raw.nome_razao_social)],
            ['CNPJ', raw.numero_cnpj],
            ['Tipo', e.type_name],
            ['Gestão', GESTAO[e.management]?.label],
            ['Esfera', raw.descricao_esfera_administrativa && titleCase(raw.descricao_esfera_administrativa)],
            ['Atendimento SUS', raw.estabelecimento_faz_atendimento_ambulatorial_sus && titleCase(raw.estabelecimento_faz_atendimento_ambulatorial_sus)],
            ['Turno', raw.descricao_turno_atendimento && titleCase(raw.descricao_turno_atendimento)],
            ['Endereço', e.address && titleCase(e.address)],
            ['Município', e.municipality_name && `${e.municipality_name} — ${e.uf}`],
            ['CEP', cep && String(cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')],
        ].filter(([, v]) => v).map(([k, v]) => [k, esc(v)]);
        // telefone e e-mail já vêm padronizados da API; aqui só viram links
        if (e.phone) linhas.push(['Telefone', linkTelefone(e.phone)]);
        if (e.email) linhas.push(['E-mail', linkEmail(e.email)]);

        $('#detalhe-titulo').textContent = titleCase(e.name);
        $('#detalhe-corpo').innerHTML = `
            <dl class="details">${linhas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
            <div class="place__actions">${botoesRota(e.rotas)}</div>`;
    } catch (err) {
        $('#detalhe-titulo').textContent = 'Erro';
        $('#detalhe-corpo').innerHTML = `<div class="alert">${esc(err.message)}</div>`;
    }
}

// janela estática: fecha só no "×" (clique fora e tecla Esc não fecham)
el.detalhe.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) el.detalhe.close();
});
el.detalhe.addEventListener('cancel', (ev) => ev.preventDefault());

/* ---------------- início ---------------- */
renderChips();
renderEstatisticas(null);
renderAguardando();
carregarUfs();
