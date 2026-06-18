/**
 * update-html.js
 * Lee liga-data.js generado por auto-scraper.js y parchea index.html (la pagina publicada)
 * Uso: node update-html.js
 */

const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, 'index.html');
const DATA_FILE = path.join(__dirname, 'liga-data.js');

if (!fs.existsSync(DATA_FILE)) {
  console.error('liga-data.js no encontrado. Corré auto-scraper.js primero.');
  process.exit(1);
}

// Load LIGA_DATA: strip the "const LIGA_DATA = " prefix and parse as JSON
let LIGA_DATA;
try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  // Remove comment lines, extract the JSON object after "const LIGA_DATA = "
  const jsonMatch = raw.match(/const LIGA_DATA = (\{[\s\S]*\});?\s*$/);
  if (!jsonMatch) throw new Error('No se encontró el objeto LIGA_DATA');
  LIGA_DATA = JSON.parse(jsonMatch[1]);
} catch (e) {
  console.error('Error leyendo liga-data.js:', e.message);
  process.exit(1);
}

let html = fs.readFileSync(HTML_FILE, 'utf8');
let changed = false;

// -----------------------------------------------------------------------
// 1. ACTUALIZAR TABLA DE POSICIONES
// -----------------------------------------------------------------------
if (LIGA_DATA.standings && LIGA_DATA.standings.length > 0) {
  // Build TABLA from scraped pts + existing G/E/P (calculated from match history)
  // Extract existing TABLA to preserve G/E/P where not updated
  const existingTablaMatch = html.match(/const TABLA = \[[\s\S]*?\];/);
  let existingTabla = [];
  if (existingTablaMatch) {
    try {
      const tablaCode = existingTablaMatch[0].replace('const TABLA = ', '').replace(/;$/, '');
      eval(`existingTabla = ${tablaCode}`);
    } catch (e) {
      console.warn('No se pudo parsear TABLA existente:', e.message);
    }
  }

  // Build new TABLA merging scraped pts+pos with existing G/E/P
  const newTabla = LIGA_DATA.standings.map((s, i) => {
    const existing = existingTabla.find(t => t.name === s.name || t.name.trim() === s.name.trim());
    return {
      pos: i + 1,
      name: s.name,
      pj: existing ? existing.pj : Math.floor(s.pts / 2.5), // estimate if no data
      g: existing ? existing.g : 0,
      e: existing ? existing.e : 0,
      p: existing ? existing.p : 0,
      pts: s.pts,
      ...(s.isUs || s.name === 'El Inter' ? { isUs: true } : {}),
    };
  });

  if (newTabla.length > 0) {
    const tablaJson = JSON.stringify(newTabla, null, 2)
      .split('\n').map(l => `  ${l}`).join('\n').trim();
    const newTablaStr = `const TABLA = [\n  ${tablaJson.slice(2, -2).trim()}\n];`;
    const updatedHtml = html.replace(/const TABLA = \[[\s\S]*?\];/, newTablaStr);
    if (updatedHtml !== html) {
      html = updatedHtml;
      changed = true;
      console.log('✓ TABLA actualizada —', newTabla.length, 'equipos');
      console.log('  1°', newTabla[0]?.name, newTabla[0]?.pts, 'pts');
    } else {
      console.log('  TABLA sin cambios');
    }
  }
}

// -----------------------------------------------------------------------
// 2. ACTUALIZAR HERO-NEXT (próximo partido en el hero)
// -----------------------------------------------------------------------
const nm = LIGA_DATA.nextMatch;
if (nm && nm.home && nm.away) {
  const isHomeForUs = nm.home === 'El Inter';
  const local = isHomeForUs ? 'El Inter' : nm.home;
  const visit = isHomeForUs ? nm.away : nm.away;
  const localLogo = isHomeForUs ? 'el-inter.png' : logoFile(nm.home);
  const visitLogo = isHomeForUs ? logoFile(nm.away) : 'el-inter.png';

  let dateInfo = '';
  if (nm.homeScore !== null && nm.awayScore !== null) {
    // Match already played — show result
    const gf = isHomeForUs ? nm.homeScore : nm.awayScore;
    const gc = isHomeForUs ? nm.awayScore : nm.homeScore;
    dateInfo = `Resultado: ${gf}-${gc} · Fecha ${nm.fechaNum} · Liga MVD`;
  } else {
    const fieldStr = nm.field ? ` · Cancha ${nm.field}` : '';
    const awayStr = isHomeForUs ? '' : ' · El Inter de visitante';
    dateInfo = `${nm.dateDisplay} · ${nm.time}${fieldStr}${awayStr}`;
  }

  const heroNext = `<div class="hero-next-label">Próximo partido · Fecha ${nm.fechaNum} · Liga MVD</div>
        <div class="hero-next-match" style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
          <img src="assets/logos/${localLogo}" style="width:24px;height:24px;object-fit:contain;${localLogo === 'el-inter.png' ? 'position:relative;z-index:2' : 'border-radius:50%'}" alt="${local}">
          <span>${local}</span>
          <span style="color:var(--gray);font-size:.85rem">vs</span>
          <img src="assets/logos/${visitLogo}" style="width:24px;height:24px;object-fit:contain;${visitLogo === 'el-inter.png' ? 'position:relative;z-index:2' : 'border-radius:50%'}" alt="${visit}">
          <span>${visit}</span>
        </div>
        <div class="hero-next-date">${dateInfo}</div>`;

  const heroNextRe = /<div class="hero-next-label">[\s\S]*?<div class="hero-next-date">[^<]*<\/div>/;
  const updatedHtml = html.replace(heroNextRe, heroNext);
  if (updatedHtml !== html) {
    html = updatedHtml;
    changed = true;
    console.log('✓ Hero-next actualizado —', local, 'vs', visit, `Fecha ${nm.fechaNum}`);
  } else {
    console.log('  Hero-next sin cambios');
  }
}

// -----------------------------------------------------------------------
// 3. ACTUALIZAR SECCIÓN PRÓXIMA FECHA
// -----------------------------------------------------------------------
if (nm && nm.home && nm.away) {
  const isHomeForUs = nm.home === 'El Inter';
  const local = nm.home;
  const visit = nm.away;
  const localLogo = logoFile(local);
  const visitLogo = logoFile(visit);
  const localIsUs = local === 'El Inter';
  const visitIsUs = visit === 'El Inter';

  // Get current standings for subtitle
  const localStanding = LIGA_DATA.standings.find(s => s.name === local);
  const visitStanding = LIGA_DATA.standings.find(s => s.name === visit);
  const localSub = localIsUs
    ? `Local · ${localStanding ? `${localStanding.pos}° en tabla · ${localStanding.pts} pts` : 'Liga MVD'}`
    : `Local · ${localStanding ? `${localStanding.pos}° en tabla · ${localStanding.pts} pts` : ''}`;
  const visitSub = visitIsUs
    ? `Visitante · ${visitStanding ? `${visitStanding.pos}° en tabla · ${visitStanding.pts} pts` : 'Liga MVD'}`
    : `Visitante · ${visitStanding ? `${visitStanding.pos}° en tabla · ${visitStanding.pts} pts` : ''}`;

  const fieldLabel = nm.field ? ` · Cancha ${nm.field}` : '';
  const [, , d] = (nm.dateStr || '2026-06-13').split('-');
  const [, mo] = (nm.dateStr || '2026-06-13').split('-');
  const months = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const monthStr = months[parseInt(mo)] || '';

  const proximaFecha = `<div class="next-label">FECHA ${nm.fechaNum} · Liga MVD Div. B${fieldLabel}</div>
        <div class="next-team">
          <div class="next-team-logo">
            <img src="assets/logos/${localLogo}" alt="${local}" ${localIsUs ? 'style="position:relative;z-index:2"' : 'style="border-radius:50%"'}>
          </div>
          <div class="next-team-name" ${localIsUs ? 'style="color:var(--blue-light)"' : ''}>${local}</div>
          <div class="next-team-sub">${localSub}</div>
        </div>
        <div class="next-vs">VS</div>
        <div class="next-team">
          <div class="next-team-logo">
            <img src="assets/logos/${visitLogo}" alt="${visit}" ${visitIsUs ? 'style="position:relative;z-index:2"' : 'style="border-radius:50%"'}>
          </div>
          <div class="next-team-name" ${visitIsUs ? 'style="color:var(--blue-light)"' : ''}>${visit}</div>
          <div class="next-team-sub">${visitSub}</div>
        </div>
        <div class="next-date-box">
          <div class="next-date-day">${parseInt(d)}</div>
          <div class="next-date-month">${monthStr} ${(nm.dateStr || '').slice(0,4)}</div>
          <div style="font-size:.65rem;color:var(--gray);margin-top:.15rem">${nm.time || '09:00'}</div>
        </div>`;

  const proximaRe = /<!-- NEXT-MATCH-START -->[\s\S]*?<!-- NEXT-MATCH-END -->/;
  const newBlock = `<!-- NEXT-MATCH-START -->
      <div class="next-match-banner fade-in">
        ${proximaFecha}
      </div>
      <!-- NEXT-MATCH-END -->`;
  const updatedHtml = html.replace(proximaRe, newBlock);
  if (updatedHtml !== html) {
    html = updatedHtml;
    changed = true;
    console.log('✓ Próxima Fecha actualizada —', local, 'vs', visit, fieldLabel);
  } else {
    console.log('  Próxima Fecha sin cambios (regex no coincidió, revisar estructura HTML)');
  }
}

// -----------------------------------------------------------------------
// 4. AGREGAR NUEVOS RESULTADOS A MATCHES si los hay
// -----------------------------------------------------------------------
// This section checks latestResults from news headlines and adds any new match
// that isn't already present in MATCHES.
if (LIGA_DATA.latestResults && LIGA_DATA.latestResults.length > 0) {
  // Parse existing MATCHES array to check what's already there
  const matchesMatch = html.match(/const MATCHES = \[[\s\S]*?\];/);
  let existingMatches = [];
  if (matchesMatch) {
    try {
      eval(matchesMatch[0].replace('const MATCHES = ', 'existingMatches = ') + ';');
    } catch (e) { /* ok */ }
  }
  const existingRivals = new Set(existingMatches.map(m => m.rival?.toLowerCase()));

  for (const r of LIGA_DATA.latestResults) {
    if (!r.rival || existingRivals.has(r.rival.toLowerCase())) continue;
    const gf = r.homeIsInter ? r.gf : r.gf;
    const gc = r.homeIsInter ? r.gc : r.gc;
    const type = gf > gc ? 'W' : gf < gc ? 'L' : 'D';
    const fechaNum = LIGA_DATA.nextMatch?.fechaNum ? LIGA_DATA.nextMatch.fechaNum - 1 : existingMatches.filter(m => m.id !== 'amistoso').length + 1;
    const newMatch = {
      id: `f${fechaNum}`,
      label: `F${fechaNum} vs ${r.rival}`,
      result: `${gf}-${gc}`,
      gf,
      gc,
      type,
      rival: r.rival,
    };
    console.log('✓ Nuevo resultado detectado —', JSON.stringify(newMatch));
    // TODO: insertar en MATCHES array. Por ahora solo notifica.
  }
}

// -----------------------------------------------------------------------
// 5. ACTUALIZAR TIMESTAMP "Última actualización"
// -----------------------------------------------------------------------
const dateStr = new Date(LIGA_DATA.lastUpdated).toLocaleDateString('es-UY', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
// Update footer or contact card if "último update" text exists
if (html.includes('Última actualización automática')) {
  html = html.replace(/Última actualización automática:[^<]*/, `Última actualización automática: ${dateStr}`);
  changed = true;
}

// -----------------------------------------------------------------------
// Guardar si hubo cambios
// -----------------------------------------------------------------------
if (changed) {
  fs.writeFileSync(HTML_FILE, html, 'utf8');
  console.log('\n✓ HTML actualizado y guardado:', HTML_FILE);
} else {
  console.log('\n  Sin cambios detectados en el HTML');
}

console.log('\n=== UPDATE-HTML COMPLETO ===');

// -----------------------------------------------------------------------
// Helper: mapa de logos
// -----------------------------------------------------------------------
function logoFile(teamName) {
  const MAP = {
    'El Inter': 'el-inter.png',
    'Capitol F.C.': 'capitol-fc.png',
    'Dep. Comandiyú': 'dep-comandiyu.png',
    'La Rotonda': 'la-rotonda.png',
    'Blue Label FC': 'blue-label.png',
    'C.A Tigre Uruguay': 'ca-tigre.png',
    'C.A. Tigre Uruguay': 'ca-tigre.png',
    'Club Montero': 'club-montero.png',
    'Revolución Futbolística': 'revolucion.png',
    'La Favela FC': 'la-favela.png',
    'Malasia F.C.': 'malasia.png',
    'Palestino': 'palestino.png',
    'Defensor United': 'defensor-united.png',
    'Cristal F.C.': 'cristal-fc.png',
  };
  return MAP[teamName] || 'el-inter.png';
}
