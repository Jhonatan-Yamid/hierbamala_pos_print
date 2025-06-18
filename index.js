const { exec } = require('child_process');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = express();
const cors = require('cors');
const mysql = require('mysql2/promise'); // Importa mysql2


app.use(cors()); // <- habilita CORS
app.use(express.json());

// Configuración de la base de datos
const dbConfig = {
  host: '195.179.237.102',
  user: 'u199394756_hierbamala',
  password: 'Hierbamala2024*',
  database: 'u199394756_hierbamala',
  port: 3306
};

function getIPv4() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Función para actualizar la IP en la base de datos
async function updateIPInDatabase() {
  try {
    const ip = getIPv4();
    const connection = await mysql.createConnection(dbConfig);

    // Actualizar el registro con ID 1 siempre
    await connection.execute(
      `UPDATE Utils 
       SET ipv4 = ?, created_at = CURRENT_TIMESTAMP 
       WHERE id = 1`,
      [ip]
    );

    // Si no existe el registro, crearlo
    await connection.execute(
      `INSERT INTO Utils (id, ipv4) 
       SELECT 1, ?
       FROM DUAL 
       WHERE NOT EXISTS (SELECT 1 FROM Utils WHERE id = 1)`,
      [ip]
    );

    console.log(`IP actualizada correctamente: ${ip}`);
    await connection.end();
  } catch (error) {
    console.error('Error al actualizar IP:', error.message);
  }
}

function header(dateStr, timeStr, tableNumber, gameName) {
  return (
    'Hierba Mala Gastrobar\r\n' +
    `*** ${dateStr} ${timeStr} ***\r\n` +
    `Mesa: ${tableNumber}\r\n` +
    `Juego: ${gameName}\r\n` +
    '--------------------------\r\n'
  );
}

function productLine(p) {
  // Cantidad al inicio, luego nombre y precio total
  let line = `${p.quantity}x ${p.name}  $${p.price * p.quantity}\r\n`;

  // Observación con tabulación al inicio
  if (p.observation) {
    line += `\tObs: ${p.observation}\r\n`;
  }

  // Adiciones con tabulación al inicio
  if (Array.isArray(p.additions) && p.additions.length > 0) {
    p.additions.forEach(a => {
      line += `\t+ ${a.name}  $${a.price}\r\n`;
    });
  }

  return line;
}

function footer(total) {
  return '--------------------------\r\n' + `TOTAL: $${total}\r\n`;
}

app.post('/print', (req, res) => {
  const { products, total, tableNumber, game, availableGames } = req.body;

  if (
    !products || !Array.isArray(products) || total == null ||
    tableNumber == null || availableGames == null
  ) {
    return res.status(400).send({ error: 'Faltan datos requeridos: products, total, tableNumber, availableGames' });
  }

  // Formatear fecha y hora
  const date = new Date();
  const dateStr = date.toLocaleDateString('es-CO');
  const timeStr = date.toLocaleTimeString('es-CO');

  let text = '';
  text += header(dateStr, timeStr, tableNumber, availableGames);

  products.forEach(p => {
    text += productLine(p);
  });

  text += footer(total);

  const printerName = "IMPRESORA_TERMICA";

  // Ruta archivo temporal
  const tempFilePath = path.join(os.tmpdir(), 'ticket.txt');

  // Escribir texto en archivo temporal con saltos de línea Windows
  fs.writeFile(tempFilePath, text, (err) => {
    if (err) {
      console.error('Error escribiendo archivo:', err);
      return res.status(500).send({ error: 'Error generando ticket' });
    }

    // Comando para copiar archivo a impresora de red compartida (modo binario)
    const command = `copy /b "${tempFilePath}" \\\\localhost\\${printerName}`;

    exec(command, (error, stdout, stderr) => {
      // Eliminar archivo temporal después de imprimir
      fs.unlink(tempFilePath, () => { });

      if (error) {
        console.error('Error al imprimir:', error);
        return res.status(500).send({ error: 'Error al imprimir' });
      }
      res.send({ success: true });
    });
  });
});

app.listen(3011, '0.0.0.0', async () => {
  await updateIPInDatabase(); // Actualiza la IP al iniciar
  console.log("Impresora POS escuchando y lista para usar en http://localhost:3011");
});
