const { exec, spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = express();
const cors = require('cors');
const mysql = require('mysql2/promise');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
}));
app.use(express.json());

/* ======================================================
   =================== CONFIG DB ========================
   ====================================================== */

const dbConfig = {
  host: '193.203.166.236',
  user: 'u199394756_hierbamala',
  password: 'Hierbamala2024*',
  database: 'u199394756_hierbamala',
  port: 3306
};

/* ======================================================
   =========== UPDATE IP IN DB (TUNEL) ==================
   ====================================================== */

async function updateIPInDatabase(publicUrl) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [updateResult] = await connection.execute(
      `UPDATE Utils SET ipv4 = ?, created_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [publicUrl]
    );
    if (updateResult.affectedRows === 0) {
      await connection.execute(
        `INSERT INTO Utils (id, ipv4, created_at) VALUES (1, ?, CURRENT_TIMESTAMP)`,
        [publicUrl]
      );
    }
    console.log(`URL actualizada correctamente: ${publicUrl}`);
    console.log(`IMPRESORA Y SISTEMA POS LISTOS PARA USARSE!`);
    await connection.end();
  } catch (error) {
    console.error('Error al actualizar URL:', error.message);
  }
}

/* ======================================================
   =========== OBTENER CATEGORIAS DESDE DB ==============
   ====================================================== */

/**
 * Dado un array de productIds, devuelve Map { id -> category }
 * consultando la base de datos directamente.
 */
async function getCategoriesFromDB(productIds) {
  const map = new Map();
  if (!productIds || productIds.length === 0) return map;
  try {
    const connection = await mysql.createConnection(dbConfig);
    const placeholders = productIds.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT id, category FROM Product WHERE id IN (${placeholders})`,
      productIds
    );
    await connection.end();
    for (const row of rows) {
      map.set(row.id, row.category || 'Otros');
    }
  } catch (err) {
    console.error('Error consultando categorias:', err.message);
  }
  return map;
}

/* ======================================================
   ================= CLOUDFLARED TUNNEL =================
   ====================================================== */

async function startCloudflareTunnelAndGetUrl(apiPort) {
  return new Promise((resolve, reject) => {
    const cloudflaredProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${apiPort}`]);
    let outputBuffer = '';
    let urlFound = false;

    const processData = (data) => {
      outputBuffer += data.toString();
      if (!urlFound) {
        const m = outputBuffer.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
        if (m) { urlFound = true; resolve(m[0]); }
      }
    };

    cloudflaredProcess.stdout.on('data', processData);
    cloudflaredProcess.stderr.on('data', processData);
    cloudflaredProcess.on('close', () => { if (!urlFound) reject(new Error('Cloudflared cerrado sin URL')); });
    cloudflaredProcess.on('error', reject);
  });
}

/* ======================================================
   ============ HELPERS DE TEXTO ========================
   ====================================================== */

const MAX_COLS = 32;

/**
 * Elimina tildes y caracteres no-ASCII para evitar basura
 * en impresoras termicas Windows (latin1/cp1252).
 */
function sanitize(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // diacriticos → base
    .replace(/\u00f1/g, 'n')           // n~
    .replace(/\u00d1/g, 'N')           // N~
    .replace(/[^\x20-\x7E]/g, '?');    // cualquier otro no imprimible ASCII
}

/**
 * Precio formateado: $20.400  (sin decimales, miles con punto)
 */
function fmtPrice(value) {
  const n = Math.round(Number(value) || 0);
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function wrapWords(text, width) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length <= width) { cur = cand; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function center(text) {
  const s = sanitize(text);
  const spaces = Math.floor((MAX_COLS - s.length) / 2);
  return ' '.repeat(Math.max(spaces, 0)) + s + '\n';
}

function sectionHeader(label) {
  // "------- HAMBURGUESAS -------"
  const inner = ' ' + label + ' ';
  const d = Math.floor((MAX_COLS - inner.length) / 2);
  const L = '-'.repeat(Math.max(d, 1));
  const R = '-'.repeat(Math.max(MAX_COLS - L.length - inner.length, 1));
  let out = '='.repeat(MAX_COLS) + '\n';
  out += L + inner + R + '\n';
  out += '='.repeat(MAX_COLS) + '\n\n';
  return out
}

// "2x Hamburguesa Clasica   $41.800"
function productLine(name, qty, lineTotal) {
  const price  = fmtPrice(lineTotal);
  const prefix = '['+ qty + 'x] ';
  const nameW  = MAX_COLS - prefix.length - price.length - 1;
  const parts  = wrapWords(name, Math.max(nameW, 8));
  const first  = parts[0];
  const pad    = ' '.repeat(Math.max(1, nameW - first.length + 1));
  let out = prefix + first + pad + price + '\n';
  for (let i = 1; i < parts.length; i++) out += '   ' + parts[i] + '\n';
  return out;
}

// "   c/u $20.900"  — solo si qty > 1
function unitPriceLine(unitPrice) {
  return '\n   c/u ' + fmtPrice(unitPrice) + '\n';
}

// "  Obs: Medio cocido"
function obsLine(text) {
  const prefix = '  * Obs: ';
  const parts  = wrapWords(text, MAX_COLS - prefix.length);
  let out = prefix + parts[0] + '\n';
  for (let i = 1; i < parts.length; i++) out += '         ' + parts[i] + '\n';
  return out;
}

// "  + Tocineta extra         $2.000"
function additionLine(name, price) {
  const p      = fmtPrice(price);
  const prefix = '  >> ';
  const nameW  = MAX_COLS - prefix.length - p.length - 1;
  const parts  = wrapWords(name, Math.max(nameW, 6));
  const first  = parts[0];
  const pad    = ' '.repeat(Math.max(1, nameW - first.length + 1));
  let out = prefix + first + pad + p + '\n';
  for (let i = 1; i < parts.length; i++) out += '       ' + parts[i] + '\n';
  return out;
}

/* ======================================================
   ============ ORDEN Y ETIQUETAS DE CATEGORIA ==========
   ====================================================== */

const CATEGORY_ORDER = [
  'Entradas',
  'Los Platos de la Casa',
  'Asados',
  'Hamburguesas Artesanales',
  'Bebidas Calientes',
  'Bebidas Frías y Refrescantes',
  'Bebidas Frias y Refrescantes',
  'Cerveza Artesanal',
  'Cocktails de Autor',
  'Licores',
  'Adiciones',
  'Otros',
];

const CATEGORY_LABEL = {
  'Entradas':                       'ENTRADAS',
  'Los Platos de la Casa':          'PLATOS DE LA CASA',
  'Asados':                         'ASADOS',
  'Hamburguesas Artesanales':       'HAMBURGUESAS',
  'Bebidas Calientes':              'BEBIDAS CALIENTES',
  'Bebidas Frías y Refrescantes':   'BEBIDAS FRIAS',
  'Bebidas Frias y Refrescantes':   'BEBIDAS FRIAS',
  'Cerveza Artesanal':              'CERVEZAS',
  'Cocktails de Autor':             'COCKTAILS',
  'Licores':                        'LICORES',
  'Adiciones':                      'ADICIONES',
  'Otros':                          'OTROS',
};

function catIndex(cat) {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? 998 : i;
}

/* ======================================================
   ============ AGRUPAR Y ORDENAR PRODUCTOS =============
   ====================================================== */

function groupAndSort(products) {
  const grouped = [];

  for (const p of products) {
    const category = p.category || 'Otros';
    const addKey   = JSON.stringify((p.additions || []).map(a => a.name).sort());
    const key      = `${p.id}||${p.observation || ''}||${addKey}`;

    const existing = grouped.find(g => g._key === key);
    if (existing) {
      existing.quantity += (p.quantity || 1);
    } else {
      grouped.push({
        _key:        key,
        id:          p.id,
        name:        p.name || '?',
        price:       Number(p.price) || 0,   // precio UNITARIO sin adiciones
        category,
        observation: p.observation || '',
        additions:   (p.additions || []).map(a => ({
          name:  a.name  || '',
          price: Number(a.price) || 0,
        })),
        quantity: p.quantity || 1,
      });
    }
  }

  grouped.sort((a, b) => catIndex(a.category) - catIndex(b.category));
  return grouped;
}

/* ======================================================
   ================= FORMATO TICKET =====================
   ====================================================== */

function formatTicket({ products, total, tableNumber, orderType, availableGames, generalObservation }) {
  const date    = new Date();
  const dateStr = date.toLocaleDateString('es-CO');
  const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  let out = '';
  out += center('HIERBA MALA');
  out += center('GASTROBAR');
  out += '-'.repeat(MAX_COLS) + '\n';
  out += `Fecha : ${dateStr}  ${timeStr}\n`;
  out += `Mesa  : ${tableNumber}\n`;

  const gameStr = Array.isArray(availableGames) && availableGames.length
    ? availableGames.filter(Boolean).map(sanitize).join(', ')
    : null;
  if (gameStr) out += `Juego : ${gameStr}\n`;

  out += `Tipo  : ${sanitize(orderType)}\n`;

  // ── Productos agrupados por categoria ─────────────────────────────────
  const items = groupAndSort(products);
  let currentCategory = null;

  for (const item of items) {
    // Nuevo encabezado de seccion cuando cambia la categoria
    if (item.category !== currentCategory) {
      if (currentCategory !== null) out += '\n';
      currentCategory = item.category;
      const label = CATEGORY_LABEL[item.category]
        || sanitize(item.category).toUpperCase();
      out += sectionHeader(label);
    }

    const addTotal  = item.additions.reduce((s, a) => s + a.price, 0);
    const unitPrice = item.price + addTotal;          // precio c/u con adiciones
    const lineTotal = unitPrice * item.quantity;      // total de esta linea

    out += productLine(item.name, item.quantity, lineTotal);

    // Precio unitario solo cuando hay mas de 1
    if (item.quantity > 1) {
      out += unitPriceLine(unitPrice);
    }

    if (item.observation) {
      out += obsLine(item.observation);
    }

    for (const a of item.additions) {
      out += additionLine(a.name, a.price);
    }
  }

  // ── Totales ────────────────────────────────────────────────────────────
  out += '\n' + '='.repeat(MAX_COLS) + '\n';

  if (generalObservation) {
    const noteLines = wrapWords(generalObservation, MAX_COLS - 6);
    out += 'NOTA: ' + noteLines[0] + '\n';
    for (let i = 1; i < noteLines.length; i++) out += '      ' + noteLines[i] + '\n';
    out += '-'.repeat(MAX_COLS) + '\n';
  }

  const totalStr = fmtPrice(total);
  const label    = 'TOTAL A PAGAR';
  const pad      = ' '.repeat(Math.max(1, MAX_COLS - label.length - totalStr.length));
  out += label + pad + totalStr + '\n';
  out += '='.repeat(MAX_COLS) + '\n\n\n\n';

  return out;
}

/* ======================================================
   ===================== ENDPOINT /print ================
   ====================================================== */

app.post('/print', async (req, res) => {
  let { products, total, tableNumber, availableGames, orderType, generalObservation } = req.body;

  if (!products || !Array.isArray(products) || total == null || !tableNumber || !orderType) {
    return res.status(400).send({ error: 'Faltan datos requeridos' });
  }

  // ── Enriquecer categorias faltantes consultando la BD ──────────────────
  const missingIds = products
    .filter(p => !p.category || p.category === 'Otros')
    .map(p => p.id)
    .filter(Boolean);

  if (missingIds.length > 0) {
    const catMap = await getCategoriesFromDB(missingIds);
    products = products.map(p => ({
      ...p,
      category: (p.category && p.category !== 'Otros')
        ? p.category
        : (catMap.get(p.id) || 'Otros'),
    }));
  }

  const text = formatTicket({ products, total, tableNumber, orderType, availableGames, generalObservation });

  const printerName  = 'IMPRESORA_TERMICA';
  const tempFilePath = path.join(os.tmpdir(), 'ticket.txt');

  // latin1 = compatible con impresoras termicas Windows sin caracteres raros
  fs.writeFile(tempFilePath, text, { encoding: 'latin1' }, err => {
    if (err) return res.status(500).send({ error: 'Error generando ticket' });

    const command = `copy /b "${tempFilePath}" \\\\localhost\\${printerName}`;

    exec(command, error => {
      fs.unlink(tempFilePath, () => {});
      if (error) return res.status(500).send({ error: 'Error al imprimir' });
      res.send({ success: true });
    });
  });
});

/* ======================================================
   ===================== SERVER LISTEN ==================
   ====================================================== */

const PORT = process.env.PORT || 3011;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`POS escuchando en http://localhost:${PORT}`);
  try {
    const cloudflarePublicUrl = await startCloudflareTunnelAndGetUrl(PORT);
    await updateIPInDatabase(cloudflarePublicUrl);
  } catch (error) {
    console.error('No se pudo iniciar Cloudflare Tunnel o obtener la URL:', error);
  }
});
