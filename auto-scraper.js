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

function monthName(n) {
  return ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][n-1] || '';
}

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
  console.log('\n3. Cargando tabla de posiciones COMPLETA (Divisional B)...');
  let standings = [];

  // Tabla completa con PJ/PG/PE/PP/GF/GC/PTS (cambia el slug/id por torneo: apertura/clausura).
  const STANDINGS_URL = 'https://www.ligamvd.com/posiciones/divisional_b_apertura/810/1/';
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

  // ----------------------------------------------------------------
  // 4. Cargar fixture page para obtener próxima fecha
  // ----------------------------------------------------------------
  console.log('\n4. Cargando fixture page...');
  await page.goto('https://www.ligamvd.com/home/1/1/', { waitUntil: 'networkidle', timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const fixLink2 = await page.$('a[href="/torneos/fixtures/"]').catch(() => null);
  if (fixLink2) { await page.evaluate(el => el.click(), fixLink2); await page.waitForTimeout(4500); }

  // Extract next match data by parsing tr innerText (reliable method)
  const nextMatchData = await page.evaluate(() => {
    const result = { fechaNum: null, home: null, away: null, dateStr: null, time: null, field: null };

    // Find "PROXIMA ETAPA" / "ETAPA N" heading
    document.querySelectorAll('h5, h4, h3').forEach(h => {
      const m = h.innerText.match(/ETAPA\s+(\d+)|FECHA\s+(\d+)/i);
      if (m) result.fechaNum = parseInt(m[1] || m[2]);
    });

    // Find all tr rows with El Inter using text parsing (same technique that worked before)
    document.querySelectorAll('tr').forEach(tr => {
      const raw = (tr.innerText || '').trim();
      if (!/El Inter|EL INTER/i.test(raw)) return;

      // Split by newlines → parts: [date+time, score_separator, home, field, away]
      const parts = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      // Expected format: ["DD-MM-YYYY HH:MM", "-" or "X - Y", "Home Team", "N", "Away Team"]
      // Field number is a standalone digit(s) between team names
      if (parts.length >= 4) {
        const dateTimePart = parts.find(p => /\d{2}-\d{2}-\d{4}/.test(p));
        const fieldPart = parts.find(p => /^\d{1,2}$/.test(p));
        // Home is the first team-name part (before field), away is after field
        const teamParts = parts.filter(p =>
          !/^\d+$/.test(p) && !/\d{2}-\d{2}-\d{4}/.test(p) &&
          p !== '-' && !/^\d+\s*[-–]\s*\d+$/.test(p) &&
          p.length > 2
        );

        if (dateTimePart) {
          const dm = dateTimePart.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})/);
          if (dm) {
            result.dateStr = `${dm[3]}-${dm[2]}-${dm[1]}`;
            result.time = dm[4];
          }
        }
        if (fieldPart) result.field = parseInt(fieldPart);
        if (teamParts.length >= 2) {
          result.home = teamParts[0].trim();
          result.away = teamParts[1].trim();
        }

        // Check if score is present (already played)
        const scorePart = parts.find(p => /^\d+\s*[-–]\s*\d+$/.test(p));
        if (scorePart) {
          const sm = scorePart.match(/(\d+)\s*[-–]\s*(\d+)/);
          if (sm) { result.homeScore = parseInt(sm[1]); result.awayScore = parseInt(sm[2]); }
        }
      }
    });

    return result;
  });
  console.log('  Próxima fecha raw:', JSON.stringify(nextMatchData));

  // Normalize team names
  if (nextMatchData.home) nextMatchData.home = normName(nextMatchData.home);
  if (nextMatchData.away) nextMatchData.away = normName(nextMatchData.away);
  const isHomeForUs = nextMatchData.home === 'El Inter';

  // ----------------------------------------------------------------
  // 5. Construir objeto de datos
  // ----------------------------------------------------------------
  console.log('\n5. Construyendo liga-data.js...');

  // Process standings: keep only Divisional B teams (12 known teams)
  const DIV_B = new Set([
    'El Inter','Capitol F.C.','Dep. Comandiyú','La Rotonda','Blue Label FC',
    'C.A Tigre Uruguay','Club Montero','Revolución Futbolística','La Favela FC',
    'Malasia F.C.','Palestino','Defensor United',
  ]);
  const filteredStandings = standings
    .filter(s => DIV_B.has(normName(s.name)) || DIV_B.has(s.name.trim()))
    .sort((a, b) => b.pts - a.pts)
    .map((s, i) => {
      const name = normName(s.name) || s.name.trim();
      const full = (s.pj != null && s.g != null && s.e != null && s.p != null) ? { pj: s.pj, g: s.g, e: s.e, p: s.p } : {};
      return { pos: i + 1, name, ...full, pts: s.pts, ...(name === 'El Inter' ? { isUs: true } : {}) };
    });

  // Build date display
  let dateDisplay = '';
  let dayName = '';
  if (nextMatchData.dateStr) {
    const [y, mo, d] = nextMatchData.dateStr.split('-').map(Number);
    const weekdays = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const date = new Date(y, mo - 1, d);
    dayName = weekdays[date.getDay()];
    dateDisplay = `${dayName} ${d} ${monthName(mo)}`;
  }

  const data = {
    lastUpdated: new Date().toISOString(),
    standings: filteredStandings,
    nextMatch: {
      fechaNum: nextMatchData.fechaNum,
      home: nextMatchData.home || 'Capitol F.C.',
      away: nextMatchData.away || 'El Inter',
      isHomeForUs,
      dateStr: nextMatchData.dateStr || '2026-06-13',
      time: nextMatchData.time || '09:00',
      field: nextMatchData.field || 13,
      dateDisplay: dateDisplay || 'Sáb 13 jun',
      dayName: dayName || 'Sáb',
      homeScore: nextMatchData.homeScore ?? null,
      awayScore: nextMatchData.awayScore ?? null,
    },
    latestResults: parsedResults,
  };

  // ----------------------------------------------------------------
  // 6. Escribir liga-data.js
  // ----------------------------------------------------------------
  const js = `// AUTO-GENERADO — no editar manualmente
// Última actualización: ${data.lastUpdated}
const LIGA_DATA = ${JSON.stringify(data, null, 2)};
`;
  fs.writeFileSync(OUTPUT, js, 'utf8');
  console.log('\n✓ liga-data.js generado');
  console.log('  Standings:', data.standings.length, 'equipos');
  console.log('  Próxima fecha:', data.nextMatch);
  console.log('  Últimos resultados encontrados:', data.latestResults.length);

  await browser.close();
  console.log('\n=== SCRAPER COMPLETO ===');
})();
