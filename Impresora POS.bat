@echo off
SETLOCAL

REM Ruta completa y fija a Node.js
SET "NODE_FIXED_PATH=C:\Program Files\nodejs\node.exe"

ECHO Iniciando API de impresora (Node.js) y Cloudflare Tunnel...
REM Iniciar Node.js en esta misma ventana y dejar que se encargue del túnel.
"%NODE_FIXED_PATH%" "%~dp0index.js"

ECHO Proceso finalizado.

ENDLOCAL
PAUSE