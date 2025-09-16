# 🐳 Docker Setup для Solana Trading Bot


## 🏗️ Архитектура

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Trading Bot   │───▶│   Prometheus    │───▶│    Grafana      │
│   (Node.js)     │    │   (Metrics)     │    │  (Dashboard)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Loki          │    │   Grafana       │    │   Grafana       │
│   (Logs)        │    │   (Logs UI)     │    │   (Metrics UI)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```


- **Grafana Dashboard**: http://localhost:3000
  - Username: `admin`
  - Password: `admin123`

- **Prometheus**: http://localhost:9090
- **Loki Logs**: http://localhost:3100



```bash
# Просмотр логов бота
docker-compose logs -f trading-bot

# Просмотр всех логов
docker-compose logs -f

# Перезапуск бота
docker-compose restart trading-bot

# Остановка всех сервисов
./stop.sh

# Полная очистка (включая данные)
docker-compose down -v
```