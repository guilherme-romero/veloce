# Backup automático — instalação systemd

Os arquivos `.service` e `.timer` desta pasta precisam ser instalados em
`/etc/systemd/system/` para que o snapshot semanal funcione.

```bash
sudo cp server/scripts/treino-bike-backup.service /etc/systemd/system/
sudo cp server/scripts/treino-bike-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now treino-bike-backup.timer

# Verificar
systemctl list-timers treino-bike-backup.timer
sudo systemctl start treino-bike-backup.service   # dispara manualmente
journalctl -u treino-bike-backup.service -n 50
```

Os snapshots vão para `data/backups/treino-bike-data-YYYY-MM-DD.zip`
(retenção: 8 mais recentes).

## Limpeza periódica do journal (logs de sync)

O backend não escreve log em arquivo próprio — tudo vai para o journal do
systemd (`StandardOutput=journal`/`StandardError=journal` em
`treino-bike-api.service`). Sem rotação, o journal cresce indefinidamente.
Instalar o timer semanal:

```bash
sudo cp server/scripts/treino-bike-log-cleanup.service /etc/systemd/system/
sudo cp server/scripts/treino-bike-log-cleanup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now treino-bike-log-cleanup.timer

# Verificar
systemctl list-timers treino-bike-log-cleanup.timer
sudo systemctl start treino-bike-log-cleanup.service   # dispara manualmente — já apaga journal >30d, não é inócuo
journalctl -u treino-bike-log-cleanup.service -n 20
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
