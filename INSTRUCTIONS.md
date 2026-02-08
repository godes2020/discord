# Discord Бот с поддержкой V2 сообщений

## Как использовать

### 1. Вставьте код сообщения в message.json

Откройте файл `message.json` и вставьте туда ваш JSON код из V2 (slashlib.me) или обычный Discord формат.

**Пример V2 формата:**
```json
{
  "content": "",
  "embeds": [],
  "components": [
    {
      "type": 17,
      "components": [
        {
          "type": 10,
          "content": "## Ваш текст здесь"
        },
        {
          "type": 9,
          "accessory": {
            "type": 2,
            "style": 2,
            "label": "Кнопка",
            "emoji": {
              "name": "✅"
            }
          }
        }
      ]
    }
  ]
}
```

**Пример обычного Discord формата:**
```json
{
  "content": "Привет!",
  "embeds": [
    {
      "title": "Заголовок",
      "description": "Описание",
      "color": 5814783
    }
  ]
}
```

### 2. Используйте команду /send

В Discord напишите команду:
```
/send
```

Бот отправит сообщение из `message.json` в текущий канал.

### 3. Настройка роли для верификации

Если используете кнопку верификации, откройте `bot.js` и замените ID роли на нужный:
```javascript
const roleId = 'ВАШ_ID_РОЛИ'; // Строка 94
```

## Команды

- `/sosal` - Отправить "привет"
- `/send` - Отправить сообщение из message.json

## Запуск

```bash
node bot.js
```
или
```bash
start.bat
```
