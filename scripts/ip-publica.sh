# La IP publica de esta maquina, para abrirle la puerta a Cloud SQL.
#
# Vivia copiada en tres scripts y apuntando a un solo servicio. Cuando
# api.ipify.org no resolvio, `set -e` mato el despliegue con «codigo 6» y sin
# una sola palabra sobre la causa: parecia un error del cambio que se estaba
# publicando. Ahora se prueban varias fuentes y, si ninguna contesta, se dice
# que fue la red y que la base no se toco.
#
# Se incluye con `source`, no se ejecuta.

ip_publica() {
  local fuentes=(https://api.ipify.org https://checkip.amazonaws.com https://ifconfig.me/ip)
  local ip fuente
  for fuente in "${fuentes[@]}"; do
    ip=$(curl -s --max-time 10 "$fuente" 2>/dev/null | tr -d '[:space:]') || true
    # Se valida la forma: un portal cautivo o una pagina de error devuelven
    # HTTP 200 con texto, y eso terminaria en --authorized-networks.
    if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
      echo "$ip"
      return 0
    fi
  done
  return 1
}
