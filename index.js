const { exec, spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = express();
const cors = require('cors');
const mysql = require('mysql2/promise');

// Configuración más explícita de CORS
app.use(cors({
  origin: '*', // Permite cualquier origen. En producción, deberías especificar tu dominio de Next.js (ej: 'https://tuapp.vercel.app')
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Permite los métodos que usas
  allowedHeaders: ['Content-Type'], // Permite la cabecera Content-Type
  optionsSuccessStatus: 200 // Para algunos navegadores, 204 No Content puede ser problemático para preflight
}));
app.use(express.json());

// Configuración de la base de datos
const dbConfig = {
  host: '195.179.237.102',
  user: 'u199394756_hierbamala',
  password: 'Hierbamala2024*',
  database: 'u199394756_hierbamala',
  port: 3306
};

// FUNCIÓN updateIPInDatabase ORIGINAL (fusionada con la lógica de Cloudflare)
async function updateIPInDatabase(publicUrl) {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Intentar actualizar el registro con ID 1
    const [updateResult] = await connection.execute(
      `UPDATE Utils SET ipv4 = ?, created_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [publicUrl]
    );

    // Si no se actualizó ninguna fila (es decir, el registro con id=1 no existe), entonces insertarlo
    if (updateResult.affectedRows === 0) {
      await connection.execute(
        `INSERT INTO Utils (id, ipv4, created_at) VALUES (1, ?, CURRENT_TIMESTAMP)`,
        [publicUrl]
      );
    }

    console.log(`URL pública actualizada correctamente en la base de datos: ${publicUrl}`);
    console.log(`¡IMPRESORA Y SISTEMA POS LISTOS PARA USARSE!`);
    await connection.end();
  } catch (error) {
    console.error('Error al actualizar URL pública:', error.message);
  }
}

// Función para iniciar Cloudflare Tunnel y obtener la URL (sin cambios desde la última versión)
async function startCloudflareTunnelAndGetUrl(apiPort) {
  return new Promise((resolve, reject) => {
    const cloudflaredPath = 'cloudflared';
    const args = ['tunnel', '--url', `http://localhost:${apiPort}`];

    console.log(`Iniciando cloudflared con: ${cloudflaredPath} ${args.join(' ')}`);

    const cloudflaredProcess = spawn(cloudflaredPath, args);
    let outputBuffer = '';
    let urlFound = false;

    const processData = (data) => {
      const chunk = data.toString();
      outputBuffer += chunk;
      console.log(`[cloudflared] ${chunk.trim()}`);

      if (!urlFound) {
        const urlMatch = outputBuffer.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
        if (urlMatch && urlMatch[0]) {
          urlFound = true;
          const publicUrl = urlMatch[0];
          console.log(`Cloudflare Public URL obtenida de cloudflared: ${publicUrl}`);
          resolve(publicUrl);
        }
      }
    };

    cloudflaredProcess.stdout.on('data', processData);
    cloudflaredProcess.stderr.on('data', processData);

    cloudflaredProcess.on('close', (code) => {
      if (!urlFound) {
        reject(new Error(`cloudflared se cerró con código ${code} sin encontrar la URL. Salida: ${outputBuffer}`));
      } else {
        console.log(`cloudflared se cerró con código ${code}.`);
      }
    });

    cloudflaredProcess.on('error', (err) => {
      console.error('Error al iniciar cloudflared:', err);
      reject(err);
    });

    process.on('exit', () => {
      if (!cloudflaredProcess.killed) {
        console.log('Terminando proceso cloudflared...');
        cloudflaredProcess.kill();
      }
    });
    process.on('SIGINT', () => {
      if (!cloudflaredProcess.killed) {
        console.log('Terminando proceso cloudflared por SIGINT...');
        cloudflaredProcess.kill();
      }
    });
  });
}

// *** MODIFICADO: FUNCIÓN header - Añadido más espaciado ***
function header(dateStr, timeStr, tableNumber, gameInfo, orderType) {
  let headerText = 'Hierba Mala Gastrobar\r\n\r\n'; // Espacio adicional
  headerText += `*** ${dateStr} ${timeStr} ***\r\n\r\n`; // Espacio adicional
  headerText += `Mesa: ${tableNumber}\r\n`;
  headerText += `Juego: ${Array.isArray(gameInfo) && gameInfo.length > 0 ? gameInfo.join(', ') : (gameInfo || 'N/A')}\r\n`;
  headerText += `Tipo Pedido: ${orderType || 'N/A'}\r\n\r\n`; // Espacio adicional
  headerText += '--------------------------\r\n';
  return headerText;
}

// *** MODIFICADO: FUNCIÓN productLine - Añadido más espaciado ***
function productLine(p) {
  let line = `${p.quantity}x ${p.name}   $${p.price * p.quantity}\r\n`;
  if (p.observation) {
    line += `\tObs: ${p.observation}\r\n`;
  }
  if (Array.isArray(p.additions) && p.additions.length > 0) {
    p.additions.forEach(a => {
      line += `\t+ ${a.name}   $${a.price}\r\n`;
    });
  }
  line += '\r\n'; // Espacio después de cada línea de producto/adición
  return line;
}

// FUNCIÓN footer ORIGINAL
function footer(total) {
  return '--------------------------\r\n' + `TOTAL: $${total}\r\n`;
}

// *** MODIFICADO: ENDPOINT /print - Recibir orderType y generalObservation ***
app.post('/print', (req, res) => {
  const { products, total, tableNumber, game, availableGames, orderType, generalObservation } = req.body; // 'orderType' y 'generalObservation' recibidos

  if (
    !products || !Array.isArray(products) || total == null ||
    tableNumber == null || availableGames == null || orderType == null
  ) {
    return res.status(400).send({ error: 'Faltan datos requeridos: products, total, tableNumber, availableGames, orderType' });
  }

  const date = new Date();
  const dateStr = date.toLocaleDateString('es-CO');
  const timeStr = date.toLocaleTimeString('es-CO');

  let text = '';
  // Se pasa 'orderType' al header
  text += header(dateStr, timeStr, tableNumber, availableGames, orderType);

  products.forEach(p => {
    text += productLine(p);
  });

  text += footer(total);

  // NUEVO: Añadir observaciones generales al final de la comanda
  if (generalObservation) {
    text += `\r\nObservaciones Generales:\r\n`;
    text += `${generalObservation}\r\n`;
  }

  // NUEVO: Espaciado y línea punteada para el corte
  text += '\r\n\r\n\r\n'; // Espacio
  text += '--------------------------\r\n'; // Línea punteada
  text += '\r\n\r\n'; // Espacio adicional después del corte

  const printerName = "IMPRESORA_TERMICA"; // Asegúrate de que este nombre sea el de tu impresora

  const tempFilePath = path.join(os.tmpdir(), 'ticket.txt');

  fs.writeFile(tempFilePath, text, (err) => {
    if (err) {
      console.error('Error escribiendo archivo:', err);
      return res.status(500).send({ error: 'Error generando ticket' });
    }

    const command = `copy /b "${tempFilePath}" \\\\localhost\\${printerName}`;

    exec(command, (error, stdout, stderr) => {
      fs.unlink(tempFilePath, () => { }); // Eliminar el archivo temporal

      if (error) {
        console.error('Error al imprimir:', error);
        return res.status(500).send({ error: 'Error al imprimir' });
      }
      res.send({ success: true });
    });
  });
});

const PORT = process.env.PORT || 3011;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Impresora POS escuchando en http://localhost:${PORT}`);

  try {
    const cloudflarePublicUrl = await startCloudflareTunnelAndGetUrl(PORT);
    // Usamos la función original updateIPInDatabase con la URL obtenida de Cloudflare
    await updateIPInDatabase(cloudflarePublicUrl);
  } catch (error) {
    console.error('No se pudo iniciar Cloudflare Tunnel o obtener la URL:', error);
  }
});
