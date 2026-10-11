# Backup automático — instalação systemd

Os arquivos `.service` e `.timer` desta pasta precisam ser instalados em
`/etc/systemd/system/` para que o snapshot semanal funcione.

```bash
sudo cp server/scripts/veloce-backup.service /etc/systemd/system/
sudo cp server/scripts/veloce-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now veloce-backup.timer

# Verificar
systemctl list-timers veloce-backup.timer
sudo systemctl start veloce-backup.service   # dispara manualmente
journalctl -u veloce-backup.service -n 50
```

Os snapshots vão para `data/backups/veloce-data-YYYY-MM-DD.zip`
(retenção: 8 mais recentes).

> **Já instalado antes?** `veloce-backup.timer` tinha um `Requires=`
> indevido no `[Unit]` que disparava o snapshot extra a cada boot/
> `daemon-reload`, não só no horário agendado (achado de revisão de infra).
> Corrigido — recopie o `.timer` e rode `daemon-reload` de novo pra
> aplicar: `sudo cp server/scripts/veloce-backup.timer /etc/systemd/system/ && sudo systemctl daemon-reload`.

## Limpeza periódica do journal (logs de sync)

O backend não escreve log em arquivo próprio — tudo vai para o journal do
systemd (`StandardOutput=journal`/`StandardError=journal` em
`veloce-api.service`). Sem rotação, o journal cresce indefinidamente.
Instalar o timer semanal:

```bash
sudo cp server/scripts/veloce-log-cleanup.service /etc/systemd/system/
sudo cp server/scripts/veloce-log-cleanup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now veloce-log-cleanup.timer

# Verificar
systemctl list-timers veloce-log-cleanup.timer
sudo systemctl start veloce-log-cleanup.service   # dispara manualmente — já apaga journal >30d, não é inócuo
journalctl -u veloce-log-cleanup.service -n 20
```

Retenção: últimos 30 dias (`journalctl --vacuum-time=30d`). Como o journald
não segmenta por unit (sem namespace dedicado), isso limpa o journal do
host como um todo — aceitável neste host de propósito único. Roda como
`root` (não `prod`, diferente do backup): `--vacuum-time` exige escrita em
`/var/log/journal`, que só `root`/grupo `systemd-journal` com escrita tem.

Verificar também, na hora do deploy, se `/etc/systemd/journald.conf` do host
já define `MaxRetentionSec`/`SystemMaxUse` — se já houver política de
retenção lá, este timer é redundante (não é um bug deste repo, é checagem
operacional fora do código).
