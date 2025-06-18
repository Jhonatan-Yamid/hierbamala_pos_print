// index.js (version corregida para recibir la URL de ngrok)

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

// Esta función ya no se usará para obtener la IP pública de ngrok, pero la mantenemos si la necesitas para otros fines
// function getIPv4() {
//   const interfaces = os.networkInterfaces();
//   for (const interfaceName in interfaces) {
//     for (const iface of interfaces[interfaceName]) {
//       if (iface.family === 'IPv4' && !iface.internal) {
//         return iface.address;
//       }
//     }
//   }
//   return '127.0.0.1';
// }

// *** MODIFICACIÓN CLAVE AQUI ***
// Ahora updateIPInDatabase aceptará la URL como argumento
async function updateIPInDatabase(publicUrl) {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Actualizar el registro con ID 1 siempre
    await connection.execute(
      `UPDATE Utils
       SET ipv4 = ?, created_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [publicUrl] // Usamos la URL pública de ngrok
    );

    // Si no existe el registro, crearlo
    await connection.execute(
      `INSERT INTO Utils (id, ipv4)
       SELECT 1, ?
       FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM Utils WHERE id = 1)`,
      [publicUrl] // Usamos la URL pública de ngrok
    );

    console.log(`URL pública de ngrok actualizada correctamente en la base de datos: ${publicUrl}`);
    await connection.end();
  } catch (error) {
    console.error('Error al actualizar URL pública:', error.message);
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
  let line = `${p.quantity}x ${p.name}  $${p.price * p.quantity}\r\n`;
  if (p.observation) {
    line += `\tObs: ${p.observation}\r\n`;
  }
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

  const tempFilePath = path.join(os.tmpdir(), 'ticket.txt');

  fs.writeFile(tempFilePath, text, (err) => {
    if (err) {
      console.error('Error escribiendo archivo:', err);
      return res.status(500).send({ error: 'Error generando ticket' });
    }

    const command = `copy /b "${tempFilePath}" \\\\localhost\\${printerName}`;

    exec(command, (error, stdout, stderr) => {
      fs.unlink(tempFilePath, () => { });

      if (error) {
        console.error('Error al imprimir:', error);
        return res.status(500).send({ error: 'Error al imprimir' });
      }
      res.send({ success: true });
    });
  });
});

// *** MODIFICACIÓN CLAVE AQUI ***
// No iniciamos el servidor aquí. Lo iniciará el script .bat
// Y el script .bat pasará la URL de ngrok como un argumento al proceso Node.js.
// Recibiremos la URL de ngrok como un argumento de línea de comandos.
const ngrokPublicUrl = process.argv[2]; // El tercer elemento es el primer argumento (index 2)

if (ngrokPublicUrl) {
  app.listen(3011, '0.0.0.0', async () => {
    console.log("Impresora POS escuchando en http://localhost:3011");
    console.log(`URL pública recibida: ${ngrokPublicUrl}`); // Log para depurar
    await updateIPInDatabase(ngrokPublicUrl); // Ahora pasamos la URL de ngrok
  });
} else {
  console.error("Error: No se proporcionó la URL pública de ngrok como argumento.");
  console.log("Este script debe ser iniciado por el .bat con la URL de ngrok.");
  // Si estás probando localmente sin ngrok, puedes descomentar la siguiente línea
  // para que el servidor se inicie sin la URL de ngrok (pero no funcionará con Vercel por el HTTPS)
  // app.listen(3011, '0.0.0.0', () => {
  //   console.log("Impresora POS escuchando en http://localhost:3011 (modo de desarrollo sin ngrok URL)");
  // });
}