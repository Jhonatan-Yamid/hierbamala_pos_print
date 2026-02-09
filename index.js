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
    console.log(`¡IMPRESORA Y SISTEMA POS LISTOS PARA USARSE!`);
    await connection.end();
  } catch (error) {
    console.error('Error al actualizar URL:', error.message);
  }
}

/* ======================================================
   ================= CLOUDLFARED TUNNEL =================
   ====================================================== */

async function startCloudflareTunnelAndGetUrl(apiPort) {
  return new Promise((resolve, reject) => {
    const cloudflaredPath = 'cloudflared';
    const args = ['tunnel', '--url', `http://localhost:${apiPort}`];

    const cloudflaredProcess = spawn(cloudflaredPath, args);
    let outputBuffer = '';
    let urlFound = false;

    const processData = (data) => {
      const chunk = data.toString();
      outputBuffer += chunk;

      if (!urlFound) {
        const urlMatch = outputBuffer.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
        if (urlMatch && urlMatch[0]) {
          urlFound = true;
          resolve(urlMatch[0]);
        }
      }
    };

    cloudflaredProcess.stdout.on('data', processData);
    cloudflaredProcess.stderr.on('data', processData);

    cloudflaredProcess.on('close', (code) => {
      if (!urlFound) reject(new Error(`Cloudflared cerrado sin URL`));
    });

    cloudflaredProcess.on('error', reject);
  });
}

/* ======================================================
   ============ NUEVO SISTEMA DE FORMATO TICKET =========
   ====================================================== */

const MAX_COLS = 32;

/* ----------------------
   Helpers de wrap
   ---------------------- */

function wrapWordsToWidth(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const w of words) {
    if ((current + (current ? " " : "") + w).length <= width) {
      current = current ? (current + " " + w) : w;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ----------------------
   Formateadores
   ---------------------- */

function formatProductLine(name, qty, price) {
  const priceStr = `$${price}`;
  const reserved = priceStr.length + 1;
  const textWidthFirst = MAX_COLS - reserved;

  const fullTitle = `${qty? qty : 1}x ${name}`;
  const titleLines = wrapWordsToWidth(fullTitle, textWidthFirst);

  const first = titleLines[0] || "";
  const pad = " ".repeat(Math.max(1, textWidthFirst - first.length));
  let out = first + pad + " " + priceStr + "\n";

  if (titleLines.length > 1) {
    const contIndent = "    ";
    const contWidth = MAX_COLS - contIndent.length;
    const rest = titleLines.slice(1).join(" ");
    const contLines = wrapWordsToWidth(rest, contWidth);
    contLines.forEach(l => {
      out += contIndent + l + "\n";
    });
  }

  return out;
}

/* === OBSERVACIONES con doble sangría === */
function formatObservation(text) {
  const prefix = "  ° Obs: ";
  const prefixLen = prefix.length;
  const firstWidth = MAX_COLS - prefixLen;

  const parts = wrapWordsToWidth(text, firstWidth);
  let out = "";

  if (parts.length > 0) {
    out += prefix + parts[0] + "\n";

    if (parts.length > 1) {
      const contIndent = "    ";
      const contWidth = MAX_COLS - contIndent.length;
      const rest = parts.slice(1).join(" ");
      const contLines = wrapWordsToWidth(rest, contWidth);
      contLines.forEach(l => (out += contIndent + l + "\n"));
    }
  } else {
    out += prefix + "\n";
  }

  return out;
}

/* === ADICIONES con doble sangría === */
function formatAddition(name, price) {
  const priceStr = `$${price}`;
  const prefix = "  + ";
  const reserved = priceStr.length + 1 + prefix.length;
  const nameMaxFirst = MAX_COLS - reserved;

  const nameParts = wrapWordsToWidth(name, nameMaxFirst);

  let out = "";
  const first = nameParts[0] || "";
  const pad = " ".repeat(Math.max(1, nameMaxFirst - first.length));
  out += prefix + first + pad + " " + priceStr + "\n";

  if (nameParts.length > 1) {
    const contIndent = "      ";
    const contWidth = MAX_COLS - contIndent.length;
    const rest = nameParts.slice(1).join(" ");
    const contLines = wrapWordsToWidth(rest, contWidth);
    contLines.forEach(l => (out += contIndent + l + "\n"));
  }

  return out;
}

function center(text) {
  const spaces = Math.floor((MAX_COLS - text.length) / 2);
  return " ".repeat(Math.max(spaces, 0)) + text + "\n";
}

/* ----------------------
   Ticket completo
   ---------------------- */

function formatTicket({ products, total, tableNumber, orderType, availableGames, generalObservation }) {
  const date = new Date();
  const dateStr = date.toLocaleDateString('es-CO');
  const timeStr = date.toLocaleTimeString('es-CO');

  let out = "";
  out += center("HIERBA MALA");
  out += center("GASTROBAR");
  out += "-".repeat(MAX_COLS) + "\n";
  out += `FECHA: ${dateStr} ${timeStr}\n`;
  out += `MESA: ${tableNumber}\n`;
  out += `JUEGO: ${availableGames?.length ? availableGames.join(", ") : "N/A"}\n`;
  out += `TIPO: ${orderType}\n`;
  out += "-".repeat(MAX_COLS) + "\n";

  products.forEach(p => {
    out += formatProductLine(p.name, p.quantity, p.price * p.quantity);

    if (p.observation?.trim()) {
      out += formatObservation(p.observation);
    }

    if (p.additions?.length) {
      p.additions.forEach(a => {
        out += formatAddition(a.name, a.price);
      });
    }

    out += "-".repeat(MAX_COLS) + "\n";
  });

  const totalLineText = "TOTAL A PAGAR";
  const totalPriceStr = `$${total}`;
  const totalPad = MAX_COLS - totalLineText.length - totalPriceStr.length;
  out += totalLineText + " ".repeat(Math.max(1, totalPad)) + totalPriceStr + "\n";
  out += "-".repeat(MAX_COLS) + "\n\n\n\n";

  if (generalObservation) {
    out += "NOTA GENERAL:\n";
    const generalWrapped = wrapWordsToWidth(generalObservation, MAX_COLS);
    generalWrapped.forEach(l => (out += l + "\n"));
    out += "-".repeat(MAX_COLS) + "\n";
  }

  return out;
}

/* ======================================================
   ===================== ENDPOINT PRINT =================
   ====================================================== */

app.post('/print', (req, res) => {
  const { products, total, tableNumber, availableGames, orderType, generalObservation } = req.body;

  if (!products || !Array.isArray(products) || total == null || !tableNumber || !orderType) {
    return res.status(400).send({ error: 'Faltan datos requeridos' });
  }

  const text = formatTicket({
    products,
    total,
    tableNumber,
    orderType,
    availableGames,
    generalObservation
  });

  const printerName = "IMPRESORA_TERMICA";
  const tempFilePath = path.join(os.tmpdir(), 'ticket.txt');

  fs.writeFile(tempFilePath, text, err => {
    if (err) return res.status(500).send({ error: 'Error generando ticket' });

    const command = `copy /b "${tempFilePath}" \\\\localhost\\${printerName}`;


    exec(command, error => {
      fs.unlink(tempFilePath, () => {});

      if (error) return res.status(500).send({ error: 'Error al imprimir' });

      res.send({ success: true});
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
    // Usamos la función original updateIPInDatabase con la URL obtenida de Cloudflare
    await updateIPInDatabase(cloudflarePublicUrl);
  } catch (error) {
    console.error('No se pudo iniciar Cloudflare Tunnel o obtener la URL:', error);
  }
});
