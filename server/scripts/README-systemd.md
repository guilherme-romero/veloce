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
