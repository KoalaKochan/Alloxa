# Используем Node.js 18 Alpine для меньшего размера
FROM node:22-alpine

# Устанавливаем необходимые пакеты для сборки нативных модулей
RUN apk add --no-cache python3 make g++

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Устанавливаем TypeScript глобально для компиляции
RUN npm install -g typescript ts-node

# Пересобираем нативные модули для Alpine Linux
RUN npm rebuild

# Компилируем TypeScript
RUN npm run build

# Создаем директорию для логов
RUN mkdir -p logs

# Устанавливаем права на запись в директорию логов
RUN chown -R node:node /app

# Переключаемся на пользователя node
USER node

# Открываем порт для метрик (если понадобится)
EXPOSE 3000

# Команда запуска
CMD ["npm", "start"]
