/**
 * auto-scraper.js
 * Scrapea Liga MVD y genera liga-data.js para actualizar la web de El Inter FC.
 * Uso: node auto-scraper.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'liga-data.js');

// Equipos de Divisional B (para normalizar nombres)
const TEAM_ALIASES = {
  'El Inter': 'El Inter',
  'EL INTER': 'El Inter',
  'Capitol F.C.': 'Capitol F.C.',
  'CAPITOL F.C.': 'Capitol F.C.',
  'Dep. Comandiyú': 'Dep. Comandiyú',
  'DEP. COMANDIYÚ': 'Dep. Comandiyú',
  'La Rotonda': 'La Rotonda',
  'La Rotonda ': 'La Rotonda',
  'LA ROTONDA': 'La Rotonda',
  'Blue Label FC': 'Blue Label FC',
  'BLUE LABEL FC': 'Blue Label FC',
  'C.A Tigre Uruguay': 'C.A Tigre Uruguay',
  'C.A. Tigre Uruguay': 'C.A Tigre Uruguay',
  'Club Montero': 'Club Montero',
  'CLUB MONTERO': 'Club Montero',
  'Revolucion Futbolistica': 'Revolución Futbolística',
  'Revolución Futbolística': 'Revolución Futbolística',
  'La Favela FC': 'La Favela FC',
  'LA FAVELA FC': 'La Favela FC',
  'Malasia F.C.': 'Malasia F.C.',
  'MALASIA F.C.': 'Malasia F.C.',
  'Palestino': 'Palestino',
  'PALESTINO': 'Palestino',
  'Defensor United': 'Defensor United',
  'DEFENSOR UNITED': 'Defensor United',
};

function normName(n) {
  return (TEAM_ALIASES[n?.trim()] || n?.trim() || '');
}

// Apertura 2026 terminó el 20/6 (11 fechas) — tabla final congelada, ya no se scrapea.
const APERTURA_FINAL_STANDINGS = [
  { pos: 1, name: 'La Rotonda', pj: 11, g: 8, e: 3, p: 0, pts: 27 },
  { pos: 2, name: 'Dep. Comandiyú', pj: 11, g: 8, e: 2, p: 1, pts: 26 },
  { pos: 3, name: 'El Inter', pj: 11, g: 8, e: 1, p: 2, pts: 25, isUs: true },
  { pos: 4, name: 'Capitol F.C.', pj: 11, g: 7, e: 3, p: 1, pts: 24 },
  { pos: 5, name: 'Revolución Futbolística', pj: 11, g: 5, e: 1, p: 5, pts: 16 },
  { pos: 6, name: 'C.A Tigre Uruguay', pj: 11, g: 4, e: 2, p: 5, pts: 14 },
  { pos: 7, name: 'Blue Label FC', pj: 11, g: 4, e: 1, p: 6, pts: 13 },
  { pos: 8, name: 'Club Montero', pj: 11, g: 3, e: 3, p: 5, pts: 12 },
  { pos: 9, name: 'Malasia F.C.', pj: 11, g: 3, e: 2, p: 6, pts: 11 },
  { pos: 10, name: 'La Favela FC', pj: 11, g: 3, e: 0, p: 8, pts: 9 },
  { pos: 11, name: 'Palestino', pj: 11, g: 0, e: 5, p: 6, pts: 5 },
  { pos: 12, name: 'Defensor United', pj: 11, g: 0, e: 3, p: 8, pts: 3 },
];

(async () => {
  console.log('=== SCRAPER INTER FC — Liga MVD ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();


  // ----------------------------------------------------------------
  // 1. Cargar home para inicializar el SPA
  // ----------------------------------------------------------------
  console.log('\n1. Cargando home...');
  await page.goto('https://www.ligamvd.com/home/1/1/', { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // ----------------------------------------------------------------
  // 2. Detectar último resultado de El Inter en las noticias del home
  // ----------------------------------------------------------------
  console.log('2. Buscando últimos resultados de El Inter en noticias...');
  const headlines = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.extra_noticia_titulo, .caption-title, .title-xs').forEach(el => {
      const txt = el.innerText.trim();
      if (/EL INTER|El Inter/i.test(txt) && /\d\s*[-–]\s*\d/.test(txt)) {
        results.push(txt.replace(/\s+/g,' ').trim());
      }
    });
    return [...new Set(results)];
  });
  console.log('  Headlines El Inter:', headlines);

  // Parsear resultados de las noticias: "EL INTER 2 - CLUB MONTERO 1"
  const parsedResults = [];
  for (const h of headlines) {
    // Formato: "TEAM A X - TEAM B Y" con escudos como <img>
    const clean = h.replace(/<[^>]+>/g, ' ').trim();
    const m = clean.match(/EL INTER\s+(\d+)\s*[-–]\s*(\d+)\s+(.+)/i)
      || clean.match(/(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+EL INTER/i);
    if (m) {
      if (/^EL INTER/i.test(clean)) {
        // El Inter anotó primero → local
        parsedResults.push({ homeIsInter: true, gf: parseInt(m[1]), gc: parseInt(m[2]), rival: normName(m[3]) });
      } else {
        // Rival anotó primero → visitante
        parsedResults.push({ homeIsInter: false, gf: parseInt(m[3]||'0'), gc: parseInt(m[2]), rival: normName(m[1]) });
      }
    }
  }
  console.log('  Resultados parseados:', JSON.stringify(parsedResults));

  // ----------------------------------------------------------------
  // 3. Abrir el modal de Torneos/Posiciones para standings completas
  // ----------------------------------------------------------------
  console.log('\n3. Cargando tabla de posiciones COMPLETA (Divisional B, Clausura)...');
  let standings = [];

  // Tabla completa con PJ/PG/PE/PP/GF/GC/PTS del Clausura (torneo en curso).
  // El Apertura ya terminó y su tabla final quedó congelada en APERTURA_FINAL_STANDINGS.
  const STANDINGS_URL = 'https://www.ligamvd.com/posiciones/divisional_b_clausura/834/1/';
  await page.goto(STANDINGS_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Extract standings: preferir la tabla COMPLETA (con PJ/G/E/P) que contenga a El Inter
  const _res = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const candidates = [];
    for (const table of tables) {
      const rows = [];
      table.querySelectorAll('tr').forEach(tr => {
        const link = tr.querySelector('a[href*="/equipos/"]');
        if (!link) return;
        const cells = Array.from(tr.querySelectorAll('td'));
        let pts = null;
        const ptsCell = cells.find(c => /\d+\s*PTS/i.test(c.innerText || ''));
        if (ptsCell) pts = parseInt(ptsCell.innerText.replace(/[^\d]/g, ''), 10);
        const nums = cells.map(c => (c.innerText || '').trim()).filter(t => /^-?\d+$/.test(t)).map(Number);
        if (pts == null && nums.length) pts = nums[nums.length - 1];
        if (pts == null || isNaN(pts) || pts < 0) return;
        const name = link.innerText.replace(/\s+/g, ' ').trim();
        let pj = null, g = null, e = null, p = null;
        if (nums.length >= 8) {
          const L = nums.slice(-8); // PJ, PG, PE, PP, GF, GC, DIF, PTS (ignora el ranking inicial)
          if (L[1] + L[2] + L[3] === L[0] && (3 * L[1] + L[2]) === L[7]) { pj = L[0]; g = L[1]; e = L[2]; p = L[3]; pts = L[7]; }
        }
        if (name) rows.push({ name, pj, g, e, p, pts });
      });
      const hasElInter = rows.some(r => r.name === 'El Inter') || table.innerHTML.includes('/1046/');
      if (hasElInter && rows.length >= 6) candidates.push(rows);
    }
    const full = candidates.find(rows => rows.some(r => r.pj != null));
    return full || candidates[0] || [];
  });
  standings = _res;
  console.log('  Standings encontrados:', standings.length, standings.slice(0,3));

  // If no standings yet from posiciones modal, fall back to fixture page sidebar
  if (standings.length === 0) {
    console.log('  Fallback: buscando en fixture page...');
    await page.goto('https://www.ligamvd.com/home/1/1/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const fixLink = await page.$('a[href="/torneos/fixtures/"]').catch(() => null);
    if (fixLink) { await page.evaluate(el => el.click(), fixLink); await page.waitForTimeout(4000); }
    standings = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const table of tables) {
        const rows = [];
        table.querySelectorAll('tr').forEach(tr => {
          const link = tr.querySelector('a[href*="/equipos/"]');
          if (!link) return;
          const cells = Array.from(tr.querySelectorAll('td'));
          let pts = null;
          const ptsCell = cells.find(c => /\d+\s*PTS/i.test(c.innerText || ''));
          if (ptsCell) pts = parseInt(ptsCell.innerText.replace(/[^\d]/g, ''), 10);
          const nums = cells.map(c => (c.innerText || '').trim()).filter(t => /^-?\d+$/.test(t)).map(Number);
          if (pts == null && nums.length) pts = nums[nums.length - 1];
          if (pts == null || isNaN(pts) || pts < 0) return;
          const name = link.innerText.replace(/\s+/g, ' ').trim();
          let pj = null, g = null, e = null, p = null;
          if (nums.length >= 8) {
            const L = nums.slice(-8);
            if (L[1] + L[2] + L[3] === L[0] && (3 * L[1] + L[2]) === L[7]) { pj = L[0]; g = L[1]; e = L[2]; p = L[3]; pts = L[7]; }
          }
          if (name) rows.push({ name, pj, g, e, p, pts });
        });
        if (rows.some(r => r.name === 'El Inter' || table.innerHTML.includes('/1046/')) && rows.length >= 6)
          return rows;
      }
      return [];
    });
    console.log('  Fallback standings:', standings.length);
  }

  // NOTA: ya no se scrapea la página de fixtures de Liga MVD para el "próximo partido" —
  // el Clausura repite el mismo orden de rivales del Apertura, así que index.html lo calcula
  // solo en el cliente (FIXTURE_ORDER + cantidad de partidos de Clausura ya cargados en MATCHES).
  // Esa página además venía devolviendo datos rotos (home:"00:00", dateStr:null) hacía tiempo.

  // ----------------------------------------------------------------
  // 4. Construir objeto de datos
  // ----------------------------------------------------------------
  console.log('\n4. Construyendo liga-data.js...');

  // Process standings: keep only Divisional B teams (12 known teams)
  const DIV_B = new Set([
    'El Inter','Capitol F.C.','Dep. Comandiyú','La Rotonda','Blue Label FC',
    'C.A Tigre Uruguay','Club Montero','Revolución Futbolística','La Favela FC',
    'Malasia F.C.','Palestino','Defensor United',
  ]);
  const filteredStandingsClausura = standings
    .filter(s => DIV_B.has(normName(s.name)) || DIV_B.has(s.name.trim()))
    .sort((a, b) => b.pts - a.pts)
    .map((s, i) => {
      const name = normName(s.name) || s.name.trim();
      const full = (s.pj != null && s.g != null && s.e != null && s.p != null) ? { pj: s.pj, g: s.g, e: s.e, p: s.p } : {};
      return { pos: i + 1, name, ...full, pts: s.pts, ...(name === 'El Inter' ? { isUs: true } : {}) };
    });

  const data = {
    lastUpdated: new Date().toISOString(),
    standingsApertura: APERTURA_FINAL_STANDINGS,
    standingsClausura: filteredStandingsClausura,
    latestResults: parsedResults,
  };

  // ----------------------------------------------------------------
  // 5. Escribir liga-data.js
  // ----------------------------------------------------------------
  const js = `// AUTO-GENERADO — no editar manualmente
// Última actualización: ${data.lastUpdated}
const LIGA_DATA = ${JSON.stringify(data, null, 2)};
`;
  fs.writeFileSync(OUTPUT, js, 'utf8');
  console.log('\n✓ liga-data.js generado');
  console.log('  Standings Clausura:', data.standingsClausura.length, 'equipos');
  console.log('  Últimos resultados encontrados:', data.latestResults.length);

  await browser.close();
  console.log('\n=== SCRAPER COMPLETO ===');
})();
