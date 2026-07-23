/* ==========================================================================
   TrendMart — Dossiê de Lucratividade — lógica do dashboard
   ========================================================================== */

const COLORS = {
  ink: '#1B2B22', inkSoft: '#48594A', inkFaint: '#8A9284',
  green: '#2F6B4F', red: '#A33B2E', gold: '#B8873A',
  paper: '#EDE7D9', paperDeep: '#E3DBC7', card: '#F7F3E8', line: '#C9BFA4',
};

const FONT_MONO = 'IBM Plex Mono, monospace';
const FONT_BODY = 'IBM Plex Sans, sans-serif';

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let DATA = null;
let filters = { region: new Set(), segment: new Set(), category: new Set() };

const fmtBRL = (v) => 'US$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtPct = (v) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const sum = (arr, key) => arr.reduce((a, r) => a + (r[key] || 0), 0);
const uniq = (arr, key) => new Set(arr.map(r => r[key]));

function baseLayout(extra) {
  return Object.assign({
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT_BODY, color: COLORS.inkSoft, size: 12 },
    margin: { t: 10, r: 20, l: 50, b: 40 },
    xaxis: { gridcolor: COLORS.line, zerolinecolor: COLORS.line, linecolor: COLORS.line },
    yaxis: { gridcolor: COLORS.line, zerolinecolor: COLORS.line, linecolor: COLORS.line },
    hoverlabel: { font: { family: FONT_MONO, size: 11 }, bgcolor: COLORS.ink, bordercolor: COLORS.ink },
  }, extra || {});
}
const PLOTLY_CONFIG = { responsive: true, displayModeBar: false };

/* ---------------------------------- Boot ---------------------------------- */

fetch('data.json')
  .then(r => r.json())
  .then(data => { DATA = data; init(); })
  .catch(err => {
    document.querySelector('main').innerHTML =
      '<p style="padding:40px;font-family:monospace;">Não foi possível carregar data.json — rode um servidor local (ex: <code>python3 -m http.server</code>) na pasta do projeto.</p>';
    console.error(err);
  });

function init() {
  document.getElementById('today').textContent = new Date().toLocaleDateString('pt-BR');
  buildFilterChips();
  buildTabs();
  renderAll();
}

/* -------------------------------- Filter UI -------------------------------- */

function buildFilterChips() {
  const regions = [...uniq(DATA.transactions, 'region')].sort();
  const segments = [...uniq(DATA.transactions, 'segment')].sort();
  const categories = [...uniq(DATA.transactions, 'category')].sort();

  renderChipGroup('filterRegion', regions, 'region');
  renderChipGroup('filterSegment', segments, 'segment');
  renderChipGroup('filterCategory', categories, 'category');

  document.getElementById('resetFilters').addEventListener('click', () => {
    filters = { region: new Set(), segment: new Set(), category: new Set() };
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    renderAll();
  });
}

function renderChipGroup(containerId, values, filterKey) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  values.forEach(v => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = v;
    chip.addEventListener('click', () => {
      if (filters[filterKey].has(v)) { filters[filterKey].delete(v); chip.classList.remove('active'); }
      else { filters[filterKey].add(v); chip.classList.add('active'); }
      renderAll();
    });
    el.appendChild(chip);
  });
}

function getFilteredTx() {
  return DATA.transactions.filter(r =>
    (filters.region.size === 0 || filters.region.has(r.region)) &&
    (filters.segment.size === 0 || filters.segment.has(r.segment)) &&
    (filters.category.size === 0 || filters.category.has(r.category))
  );
}

/* -------------------------------- Tabs -------------------------------- */

function buildTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('page-' + btn.dataset.page).classList.add('active');
      window.dispatchEvent(new Event('resize')); // let Plotly resize on show
    });
  });
}

/* -------------------------------- Master render -------------------------------- */

function renderAll() {
  const tx = getFilteredTx();
  renderKPIs(tx);
  renderOverview(tx);
  renderSegments(tx);
  renderRegional(tx);
  renderCustomers();       // full-history RFM, independent of filters
  renderSeasonality(tx);
  renderProducts();        // full-history product clusters, independent of filters
}

/* -------------------------------- 00 KPIs -------------------------------- */

function renderKPIs(tx) {
  const totalSales = sum(tx, 'sales');
  const totalProfit = sum(tx, 'profit');
  const margin = totalSales ? totalProfit / totalSales : 0;
  const orders = uniq(tx, 'order_id').size;
  const customers = uniq(tx, 'customer_id').size;
  const avgShip = tx.length ? sum(tx, 'ship_days') / tx.length : 0;

  const items = [
    ['Vendas Totais', fmtBRL(totalSales)],
    ['Lucro Total', fmtBRL(totalProfit)],
    ['Margem', fmtPct(margin)],
    ['Pedidos', orders.toLocaleString('pt-BR')],
    ['Clientes', customers.toLocaleString('pt-BR')],
    ['Envio Médio', avgShip.toFixed(1) + ' dias'],
  ];
  document.getElementById('kpiStrip').innerHTML = items.map(([label, val]) =>
    `<div class="kpi"><p class="kpi-label">${label}</p><p class="kpi-value">${val}</p></div>`
  ).join('');
}

/* -------------------------------- 01 Overview -------------------------------- */

function renderOverview(tx) {
  const byMonth = {};
  tx.forEach(r => {
    const ym = r.date.slice(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { sales: 0, profit: 0 };
    byMonth[ym].sales += r.sales;
    byMonth[ym].profit += r.profit;
  });
  const months = Object.keys(byMonth).sort();
  const sales = months.map(m => byMonth[m].sales);
  const profit = months.map(m => byMonth[m].profit);
  const margin = months.map(m => byMonth[m].sales ? byMonth[m].profit / byMonth[m].sales : 0);

  Plotly.newPlot('chartMonthly', [
    { x: months, y: sales, name: 'Vendas', type: 'bar', marker: { color: COLORS.paperDeep, line: { color: COLORS.ink, width: 1 } } },
    { x: months, y: profit, name: 'Lucro', type: 'scatter', mode: 'lines+markers', line: { color: COLORS.green, width: 2.5 }, marker: { size: 5 } },
  ], baseLayout({ legend: { orientation: 'h', y: 1.12 }, barmode: 'overlay' }), PLOTLY_CONFIG);

  Plotly.newPlot('chartMonthlyMargin', [
    { x: months, y: margin, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: COLORS.gold, width: 2 }, fillcolor: 'rgba(184,135,58,0.18)' },
  ], baseLayout({ yaxis: { tickformat: '.0%', gridcolor: COLORS.line } }), PLOTLY_CONFIG);

  const byRegion = {};
  tx.forEach(r => { byRegion[r.region] = (byRegion[r.region] || 0) + r.sales; });
  const regions = Object.keys(byRegion);
  Plotly.newPlot('chartRegionShare', [{
    labels: regions, values: regions.map(r => byRegion[r]), type: 'pie', hole: 0.55,
    marker: { colors: [COLORS.green, COLORS.gold, COLORS.inkSoft, COLORS.red], line: { color: COLORS.card, width: 2 } },
    textfont: { family: FONT_MONO, color: COLORS.card },
  }], baseLayout({ showlegend: true, legend: { font: { size: 10.5 } } }), PLOTLY_CONFIG);

  const bestMonth = months[margin.indexOf(Math.max(...margin))];
  const worstMonth = months[margin.indexOf(Math.min(...margin))];
  document.getElementById('insightOverview').innerHTML =
    `No período filtrado, a margem consolidada foi <b>${fmtPct(sum(tx,'profit')/Math.max(sum(tx,'sales'),1))}</b>.
     Melhor mês de margem: <b>${bestMonth || '—'}</b> (${fmtPct(margin[months.indexOf(bestMonth)] || 0)}).
     Pior mês: <b>${worstMonth || '—'}</b> (${fmtPct(margin[months.indexOf(worstMonth)] || 0)}).`;
}

/* -------------------------------- 02 Segments -------------------------------- */

function renderSegments(tx) {
  const bySeg = {};
  tx.forEach(r => {
    if (!bySeg[r.segment]) bySeg[r.segment] = { sales: 0, profit: 0 };
    bySeg[r.segment].sales += r.sales; bySeg[r.segment].profit += r.profit;
  });
  const segs = Object.keys(bySeg).sort((a,b) => (bySeg[b].profit/bySeg[b].sales) - (bySeg[a].profit/bySeg[a].sales));
  const segMargin = segs.map(s => bySeg[s].sales ? bySeg[s].profit / bySeg[s].sales : 0);

  Plotly.newPlot('chartSegmentMargin', [{
    x: segs, y: segMargin, type: 'bar',
    marker: { color: COLORS.green, line: { color: COLORS.ink, width: 1 } },
  }], baseLayout({ yaxis: { tickformat: '.0%' } }), PLOTLY_CONFIG);

  const bySub = {};
  tx.forEach(r => {
    const k = r.subcategory;
    if (!bySub[k]) bySub[k] = { sales: 0, profit: 0, category: r.category };
    bySub[k].sales += r.sales; bySub[k].profit += r.profit;
  });
  const subs = Object.keys(bySub).map(k => ({ name: k, margin: bySub[k].sales ? bySub[k].profit/bySub[k].sales : 0, sales: bySub[k].sales, profit: bySub[k].profit }));
  subs.sort((a,b) => a.margin - b.margin);
  const extremes = [...subs.slice(0, 3), ...subs.slice(-3)];

  Plotly.newPlot('chartSubExtremes', [{
    x: extremes.map(s => s.name), y: extremes.map(s => s.margin), type: 'bar',
    marker: { color: extremes.map(s => s.margin < 0 ? COLORS.red : COLORS.green), line: { color: COLORS.ink, width: 1 } },
  }], baseLayout({ yaxis: { tickformat: '.0%' } }), PLOTLY_CONFIG);

  Plotly.newPlot('chartSubScatter', [{
    x: subs.map(s => s.sales), y: subs.map(s => s.margin), text: subs.map(s => s.name),
    mode: 'markers+text', textposition: 'top center', textfont: { family: FONT_MONO, size: 10, color: COLORS.inkSoft },
    marker: {
      size: subs.map(s => Math.max(14, Math.sqrt(Math.abs(s.profit)) * 1.4)),
      color: subs.map(s => s.margin < 0 ? COLORS.red : (s.margin < 0.1 ? COLORS.gold : COLORS.green)),
      opacity: 0.75, line: { color: COLORS.ink, width: 1 },
    },
    type: 'scatter',
  }], baseLayout({ xaxis: { title: 'Vendas Totais (US$)' }, yaxis: { title: 'Margem', tickformat: '.0%' } }), PLOTLY_CONFIG);

  const worst = subs[0], best = subs[subs.length - 1];
  document.getElementById('insightSegments').innerHTML =
    `<b>${segs[0] || '—'}</b> é o segmento mais rentável (${fmtPct(segMargin[0] || 0)}).
     A sub-categoria mais crítica é <b>${worst ? worst.name : '—'}</b> (${fmtPct(worst ? worst.margin : 0)}),
     enquanto <b>${best ? best.name : '—'}</b> lidera com ${fmtPct(best ? best.margin : 0)} de margem.`;
}

/* -------------------------------- 03 Regional -------------------------------- */

function renderRegional(tx) {
  const byRegion = {};
  tx.forEach(r => {
    if (!byRegion[r.region]) byRegion[r.region] = { sales: 0, profit: 0, discSum: 0, n: 0 };
    const b = byRegion[r.region];
    b.sales += r.sales; b.profit += r.profit; b.discSum += r.discount; b.n += 1;
  });
  const regions = Object.keys(byRegion);
  const discAvg = regions.map(r => byRegion[r].discSum / byRegion[r].n);
  const marginR = regions.map(r => byRegion[r].sales ? byRegion[r].profit / byRegion[r].sales : 0);

  Plotly.newPlot('chartRegionScatter', [{
    x: discAvg, y: marginR, text: regions, mode: 'markers+text', textposition: 'top center',
    textfont: { family: FONT_MONO, size: 11, color: COLORS.inkSoft },
    marker: { size: 16, color: COLORS.green, line: { color: COLORS.ink, width: 1.5 } }, type: 'scatter',
  }], baseLayout({ xaxis: { title: 'Desconto Médio', tickformat: '.0%' }, yaxis: { title: 'Margem', tickformat: '.0%' } }), PLOTLY_CONFIG);

  const tables = tx.filter(r => r.subcategory === 'Tables');
  const comDesc = tables.filter(r => r.discount > 0);
  const semDesc = tables.filter(r => r.discount === 0);
  const mComDesc = sum(comDesc,'sales') ? sum(comDesc,'profit')/sum(comDesc,'sales') : 0;
  const mSemDesc = sum(semDesc,'sales') ? sum(semDesc,'profit')/sum(semDesc,'sales') : 0;

  Plotly.newPlot('chartTablesDiscount', [{
    x: ['Sem Desconto', 'Com Desconto'], y: [mSemDesc, mComDesc], type: 'bar',
    marker: { color: [COLORS.green, COLORS.red], line: { color: COLORS.ink, width: 1 } },
  }], baseLayout({ yaxis: { tickformat: '.0%' } }), PLOTLY_CONFIG);

  const rows = regions.map((r,i) => `<tr><td>${r}</td><td>${fmtBRL(byRegion[r].sales)}</td><td>${fmtBRL(byRegion[r].profit)}</td><td>${fmtPct(marginR[i])}</td><td>${fmtPct(discAvg[i])}</td></tr>`).join('');
  document.getElementById('tableRegion').innerHTML =
    `<table class="data-table"><thead><tr><th>Região</th><th>Vendas</th><th>Lucro</th><th>Margem</th><th>Desconto Médio</th></tr></thead><tbody>${rows}</tbody></table>`;

  const worstIdx = marginR.indexOf(Math.min(...marginR));
  document.getElementById('insightRegional').innerHTML =
    `A região <b>${regions[worstIdx] || '—'}</b> combina o maior desconto médio com a menor margem —
     evidência de que desconto agressivo está corroendo a rentabilidade ali.
     Em <b>Tables</b>, vender sem desconto entrega ${fmtPct(mSemDesc)} de margem contra ${fmtPct(mComDesc)} com desconto.`;
}

/* -------------------------------- 04 Customers (RFM, full history) -------------------------------- */

function renderCustomers() {
  const clusters = DATA.customer_clusters_summary;
  const stampClass = { 'Campeões': 'ok', 'Fiéis': 'ok', 'Em Risco': 'bad', 'Ocasionais': 'warn' };
  const stampLabel = { 'Campeões': 'Prioridade', 'Fiéis': 'Reter', 'Em Risco': 'Reativar', 'Ocasionais': 'Nutrir' };

  document.getElementById('customerClusterCards').innerHTML = clusters.map(c => `
    <div class="verdict-card">
      <span class="stamp ${stampClass[c.cluster_name] || 'warn'}">${stampLabel[c.cluster_name] || ''}</span>
      <p class="name">${c.cluster_name}</p>
      <div class="metric-row"><span>Clientes</span><b>${c.n_clientes}</b></div>
      <div class="metric-row"><span>Recência média</span><b>${c.recencia_media.toFixed(0)}d</b></div>
      <div class="metric-row"><span>Frequência média</span><b>${c.frequencia_media.toFixed(1)}x</b></div>
      <div class="metric-row"><span>Valor médio</span><b>${fmtBRL(c.monetario_medio)}</b></div>
      <div class="metric-row"><span>Margem média</span><b>${fmtPct(c.margem_media)}</b></div>
    </div>`).join('');

  const clusterColor = { 'Campeões': COLORS.green, 'Fiéis': COLORS.inkSoft, 'Em Risco': COLORS.red, 'Ocasionais': COLORS.gold };
  const rfm = DATA.customers_rfm;
  const traces = [...new Set(rfm.map(r => r.cluster_name))].map(cn => {
    const pts = rfm.filter(r => r.cluster_name === cn);
    return {
      x: pts.map(r => r.frequency), y: pts.map(r => r.monetary), name: cn,
      text: pts.map(r => `${r.customer_name}<br>Recência: ${r.recency}d`),
      mode: 'markers', type: 'scatter',
      marker: { color: clusterColor[cn], size: 8, opacity: 0.65, line: { color: COLORS.ink, width: 0.5 } },
    };
  });

  Plotly.newPlot('chartRFMScatter', traces, baseLayout({
    xaxis: { title: 'Frequência (pedidos)' }, yaxis: { title: 'Valor Monetário (US$)', type: 'log' },
    legend: { orientation: 'h', y: 1.1 },
  }), PLOTLY_CONFIG);

  const top = clusters.slice().sort((a,b) => b.n_clientes - a.n_clientes)[0];
  const totalClientes = clusters.reduce((a, c) => a + c.n_clientes, 0);
  document.getElementById('insightCustomers').innerHTML =
    `O maior grupo é <b>${top.cluster_name}</b>, com ${top.n_clientes} clientes (${(top.n_clientes/totalClientes*100).toFixed(0)}% da base).
     Clientes <b>Em Risco</b> não compram há mais tempo e merecem campanhas de reativação antes de migrarem para churn definitivo.
     <span style="color:${COLORS.inkFaint}">RFM calculado sobre o histórico completo do cliente (não é afetado pelos filtros acima).</span>`;
}

/* -------------------------------- 05 Seasonality -------------------------------- */

function renderSeasonality(tx) {
  const grid = {}; // year -> month -> sales
  tx.forEach(r => {
    const [y, m] = r.date.split('-');
    grid[y] = grid[y] || {};
    grid[y][m] = (grid[y][m] || 0) + r.sales;
  });
  const years = Object.keys(grid).sort();
  const z = years.map(y => Array.from({ length: 12 }, (_, i) => grid[y][String(i+1).padStart(2,'0')] || 0));

  Plotly.newPlot('chartHeatmap', [{
    z, x: MONTH_NAMES, y: years, type: 'heatmap',
    colorscale: [[0, COLORS.card], [0.5, COLORS.gold], [1, COLORS.green]],
    hoverongaps: false, showscale: true,
  }], baseLayout({ yaxis: { type: 'category' } }), PLOTLY_CONFIG);

  const monthAvg = Array.from({ length: 12 }, (_, i) => {
    const vals = years.map(y => grid[y][String(i+1).padStart(2,'0')] || 0).filter(v => v > 0);
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
  });
  Plotly.newPlot('chartSeasonAvg', [{
    x: MONTH_NAMES, y: monthAvg, type: 'bar',
    marker: { color: COLORS.paperDeep, line: { color: COLORS.ink, width: 1 } },
  }], baseLayout({}), PLOTLY_CONFIG);

  const peakIdx = monthAvg.indexOf(Math.max(...monthAvg));
  document.getElementById('insightSeasonality').innerHTML =
    `<b>${MONTH_NAMES[peakIdx]}</b> é consistentemente o mês de pico de vendas — provável efeito de datas comerciais de fim de ano.
     O primeiro trimestre é o mais fraco em todos os anos observados, um padrão útil para planejar estoque e caixa.`;
}

/* -------------------------------- 06 Products (clustering, full history) -------------------------------- */

function renderProducts() {
  const subs = DATA.subcategory_clusters;
  const clusterColor = { 'Estrelas': COLORS.green, 'Alavancáveis': COLORS.gold, 'Críticas': COLORS.red };
  const names = [...new Set(subs.map(s => s.cluster_name))];
  const traces = names.map(cn => {
    const pts = subs.filter(s => s.cluster_name === cn);
    return {
      x: pts.map(s => s.desconto_medio), y: pts.map(s => s.margem), name: cn,
      text: pts.map(s => s.subcategory), mode: 'markers+text', textposition: 'top center',
      textfont: { family: FONT_MONO, size: 10.5, color: COLORS.inkSoft },
      marker: { color: clusterColor[cn], size: pts.map(s => Math.max(16, Math.sqrt(s.total_vendas)/9)), opacity: 0.78, line: { color: COLORS.ink, width: 1 } },
      type: 'scatter',
    };
  });
  Plotly.newPlot('chartProductCluster', traces, baseLayout({
    xaxis: { title: 'Desconto Médio', tickformat: '.0%' }, yaxis: { title: 'Margem', tickformat: '.0%' },
    legend: { orientation: 'h', y: 1.1 },
  }), PLOTLY_CONFIG);

  const stampClass = { 'Estrelas': 'ok', 'Alavancáveis': 'warn', 'Críticas': 'bad' };
  const stampLabel = { 'Estrelas': 'Saudável', 'Alavancáveis': 'Atenção', 'Críticas': 'Crítico' };
  const sorted = subs.slice().sort((a,b) => a.margem - b.margem);
  document.getElementById('productVerdictGrid').innerHTML = sorted.map(s => `
    <div class="verdict-card">
      <span class="stamp ${stampClass[s.cluster_name]}">${stampLabel[s.cluster_name]}</span>
      <p class="name">${s.subcategory}</p>
      <div class="metric-row"><span>Categoria</span><b>${s.category}</b></div>
      <div class="metric-row"><span>Margem</span><b>${fmtPct(s.margem)}</b></div>
      <div class="metric-row"><span>Desconto médio</span><b>${fmtPct(s.desconto_medio)}</b></div>
      <div class="metric-row"><span>Vendas totais</span><b>${fmtBRL(s.total_vendas)}</b></div>
    </div>`).join('');

  const critical = subs.filter(s => s.cluster_name === 'Críticas');
  document.getElementById('insightProducts').innerHTML =
    `${critical.length} de ${subs.length} sub-categorias caem no grupo <b>Críticas</b> — margem baixa combinada a desconto médio alto.
     São as primeiras candidatas a revisão de política comercial ou descontinuação.
     <span style="color:${COLORS.inkFaint}">Clustering calculado sobre o histórico completo (não é afetado pelos filtros acima).</span>`;
}
