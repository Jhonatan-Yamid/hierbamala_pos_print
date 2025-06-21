# get_ngrok_url.ps1
# Este script de PowerShell obtiene la URL HTTPS de ngrok

try {
    $tunnels = Invoke-RestMethod http://localhost:4040/api/tunnels
    # Busca el túnel HTTPS
    $httpsTunnel = $tunnels.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -ExpandProperty public_url -First 1

    # Si encontramos una URL, la imprimimos
    if ($httpsTunnel) {
        Write-Output $httpsTunnel
    } else {
        Write-Error "No se encontró un túnel HTTPS en la API de ngrok."
    }
} catch {
    Write-Error "Error al obtener la URL de ngrok desde la API: $($_.Exception.Message)"
}