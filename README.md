# Discord Бот

Простой Discord бот с командой /sosal

## Установка

1. Установите зависимости:
```bash
pip install -r requirements.txt
```

2. Создайте файл `.env` на основе `.env.example`:
```bash
copy .env.example .env
```

3. Получите токен бота:
   - Перейдите на https://discord.com/developers/applications
   - Создайте новое приложение
   - Во вкладке "Bot" создайте бота и скопируйте токен
   - В `.env` замените `ваш_токен_бота_здесь` на ваш токен

4. Добавьте бота на сервер:
   - В разделе OAuth2 -> URL Generator выберите:
     - Scopes: `bot` и `applications.commands`
     - Bot Permissions: `Send Messages`
   - Скопируйте ссылку и откройте в браузере

## Запуск

```bash
python bot.py
```

## Использование

После запуска бота используйте команду `/sosal` на сервере Discord, и бот отправит "привет"
