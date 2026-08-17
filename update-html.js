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
// 1. ACTUALIZAR TABLAS DE POSICIONES (Apertura congelada + Clausura en vivo)
// -----------------------------------------------------------------------
const norm = n => (n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function updateTablaBlock(varName, standings) {
  if (!standings || standings.length === 0) return;

  const re = new RegExp(`const ${varName} = \\[[\\s\\S]*?\\];`);
  const existingMatch = html.match(re);
  let existingTabla = [];
  if (existingMatch) {
    try {
      const tablaCode = existingMatch[0].replace(`const ${varName} = `, '').replace(/;$/, '');
      eval(`existingTabla = ${tablaCode}`);
    } catch (e) {
      console.warn(`No se pudo parsear ${varName} existente:`, e.message);
    }
  }

  const newTabla = standings.map((s, i) => {
    const existing = existingTabla.find(t => norm(t.name) === norm(s.name));
    const hasFull = s.pj != null && s.g != null && s.e != null && s.p != null;
    return {
      pos: i + 1,
      name: s.name,
      pj: hasFull ? s.pj : (existing ? existing.pj : Math.floor(s.pts / 2.5)),
      g: hasFull ? s.g : (existing ? existing.g : 0),
      e: hasFull ? s.e : (existing ? existing.e : 0),
      p: hasFull ? s.p : (existing ? existing.p : 0),
      pts: s.pts,
      ...(s.isUs || s.name === 'El Inter' ? { isUs: true } : {}),
    };
  });

  if (newTabla.length === 0) return;
  const tablaJson = JSON.stringify(newTabla, null, 2)
    .split('\n').map(l => `  ${l}`).join('\n').trim();
  const newTablaStr = `const ${varName} = [\n  ${tablaJson.slice(2, -2).trim()}\n];`;
  const updatedHtml = html.replace(re, newTablaStr);
  if (updatedHtml !== html) {
    html = updatedHtml;
    changed = true;
    console.log(`✓ ${varName} actualizada —`, newTabla.length, 'equipos');
    console.log('  1°', newTabla[0]?.name, newTabla[0]?.pts, 'pts');
  } else {
    console.log(`  ${varName} sin cambios`);
  }
}

updateTablaBlock('TABLA_APERTURA', LIGA_DATA.standingsApertura);
updateTablaBlock('TABLA_CLAUSURA', LIGA_DATA.standingsClausura);

// NOTA: el "próximo partido" (hero + sección "Próxima fecha") ya no se parchea acá.
// index.html lo calcula solo en el cliente a partir de FIXTURE_ORDER (el Clausura repite
// el orden de rivales del Apertura) + la cantidad de partidos de Clausura ya cargados en
// MATCHES/admin-data.js. Fecha/hora/cancha se toman de ADMIN_DATA.nextMatch si están cargadas
// en el panel admin; si no, el sitio muestra "A confirmar".

// -----------------------------------------------------------------------
// 2. AVISAR SI HAY RESULTADOS NUEVOS SIN CARGAR (detectados en los titulares de la home)
// -----------------------------------------------------------------------
// Esto es solo un aviso en el log del bot — cargar el partido en admin-data.js
// (matchResults) sigue siendo manual, porque Liga MVD no publica goleadores ni
// alineación y esa parte del panel admin ya la maneja Agustín directamente.
if (LIGA_DATA.latestResults && LIGA_DATA.latestResults.length > 0) {
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
    console.log('⚠ Resultado nuevo detectado en Liga MVD, falta cargarlo a mano:', JSON.stringify(r));
  }
}

// -----------------------------------------------------------------------
// 3. ACTUALIZAR TIMESTAMP "Última actualización"
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
