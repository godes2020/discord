const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;
const PINCODE = '125234542';

// Подключаем функции для работы с шаблонами
const {
    createTemplate,
    getAllTemplates,
    getTemplate,
    updateTemplate,
    deleteTemplate
} = require('./database.js');

// Храним ссылку на Discord клиента
let discordClient = null;

// Устанавливаем Discord клиента
function setDiscordClient(client) {
    discordClient = client;
}

// Middleware для парсинга JSON
app.use(express.json({ limit: '10mb' }));

// Настройка сессий
app.use(session({
    secret: 'orjus-discord-bot-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        httpOnly: true
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Требуется авторизация' });
    }
}

// Авторизация
app.post('/api/login', (req, res) => {
    const { pincode } = req.body;
    
    if (pincode === PINCODE) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверный пинкод' });
    }
});

// Проверка авторизации
app.get('/api/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Получить список серверов (требует авторизации)
app.get('/api/guilds', requireAuth, async (req, res) => {
    try {
        if (!discordClient) {
            return res.status(500).json({ error: 'Discord клиент не инициализирован' });
        }

        const guilds = discordClient.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL()
        }));

        res.json(guilds);
    } catch (error) {
        console.error('Ошибка получения серверов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить список каналов сервера
app.get('/api/guilds/:guildId/channels', requireAuth, async (req, res) => {
    try {
        if (!discordClient) {
            return res.status(500).json({ error: 'Discord клиент не инициализирован' });
        }

        const guild = discordClient.guilds.cache.get(req.params.guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Сервер не найден' });
        }

        const channels = guild.channels.cache
            .filter(channel => channel.type === 0) // Только текстовые каналы
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                position: channel.position
            }))
            .sort((a, b) => a.position - b.position);

        res.json(channels);
    } catch (error) {
        console.error('Ошибка получения каналов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отправить эмбед в канал
app.post('/api/send', requireAuth, async (req, res) => {
    try {
        if (!discordClient) {
            return res.status(500).json({ error: 'Discord клиент не инициализирован' });
        }

        const { guildId, channelId, embedData } = req.body;

        if (!guildId || !channelId || !embedData) {
            return res.status(400).json({ error: 'Не все параметры переданы' });
        }

        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Сервер не найден' });
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Канал не найден' });
        }

        // Парсим JSON эмбеда
        let jsonData;
        try {
            jsonData = JSON.parse(embedData);
        } catch (e) {
            return res.status(400).json({ error: 'Неверный формат JSON: ' + e.message });
        }

        let messageData;
        
        // Проверяем тип данных
        if (jsonData.components && Array.isArray(jsonData.components)) {
            // Discord Components V2 - конвертируем
            const { convertV2ToDiscord } = require('./bot.js');
            messageData = convertV2ToDiscord(jsonData);
        } else if (jsonData.embeds || jsonData.content) {
            // Обычный webhook формат - отправляем как есть
            messageData = jsonData;
        } else if (jsonData.container || Object.values(jsonData).some(val => val && val.container)) {
            // Старый формат container - конвертируем
            const { convertV2ToDiscord } = require('./bot.js');
            messageData = convertV2ToDiscord(jsonData);
        } else {
            return res.status(400).json({ error: 'Неподдерживаемый формат JSON. Используйте embeds, components или container.' });
        }

        // Отправляем сообщение
        const sentMessage = await channel.send(messageData);

        res.json({ 
            success: true, 
            messageId: sentMessage.id,
            channelName: channel.name,
            guildName: guild.name
        });

    } catch (error) {
        console.error('Ошибка отправки эмбеда:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для работы с шаблонами

// Получить все шаблоны
app.get('/api/templates', requireAuth, (req, res) => {
    try {
        const templates = getAllTemplates();
        res.json(templates);
    } catch (error) {
        console.error('Ошибка получения шаблонов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить шаблон по ID
app.get('/api/templates/:id', requireAuth, (req, res) => {
    try {
        const template = getTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        res.json(template);
    } catch (error) {
        console.error('Ошибка получения шаблона:', error);
        res.status(500).json({ error: error.message });
    }
});

// Создать новый шаблон
app.post('/api/templates', requireAuth, (req, res) => {
    try {
        const { name, content } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Имя и содержимое обязательны' });
        }

        const result = createTemplate(name, content);
        
        if (result.success) {
            res.json({ success: true, message: 'Шаблон создан' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Ошибка создания шаблона:', error);
        res.status(500).json({ error: error.message });
    }
});

// Обновить шаблон
app.put('/api/templates/:id', requireAuth, (req, res) => {
    try {
        const { name, content } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Имя и содержимое обязательны' });
        }

        const result = updateTemplate(req.params.id, name, content);
        
        if (result.success) {
            res.json({ success: true, message: 'Шаблон обновлён' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Ошибка обновления шаблона:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удалить шаблон
app.delete('/api/templates/:id', requireAuth, (req, res) => {
    try {
        const result = deleteTemplate(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('Ошибка удаления шаблона:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для работы с транскриптами

// Получить список транскриптов для типа (orders/boosts)
app.get('/api/transcripts/:type', requireAuth, (req, res) => {
    try {
        const type = req.params.type;
        const transcriptDir = path.join(__dirname, 'transcripts', type);
        
        if (!fs.existsSync(transcriptDir)) {
            return res.json([]);
        }
        
        const files = fs.readdirSync(transcriptDir)
            .filter(f => f.endsWith('.txt'))
            .map(f => {
                const stats = fs.statSync(path.join(transcriptDir, f));
                const nameParts = f.replace('.txt', '').split('_');
                const ticketName = nameParts[0];
                const timestamp = nameParts[1] ? new Date(parseInt(nameParts[1])) : stats.mtime;
                
                return {
                    name: f,
                    displayName: ticketName,
                    date: timestamp.toLocaleString('ru-RU'),
                    timestamp: timestamp.getTime()
                };
            })
            .sort((a, b) => b.timestamp - a.timestamp);
        
        res.json(files);
    } catch (error) {
        console.error('Ошибка получения транскриптов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить содержимое транскрипта
app.get('/api/transcripts/:type/:filename', requireAuth, (req, res) => {
    try {
        const { type, filename } = req.params;
        const filePath = path.join(__dirname, 'transcripts', type, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не найден' });
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        const displayName = filename.replace('.txt', '').split('_')[0];
        
        res.json({
            name: displayName,
            content: content
        });
    } catch (error) {
        console.error('Ошибка чтения транскрипта:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
function startWebServer() {
    app.listen(PORT, () => {
        console.log(`🌐 Веб-редактор запущен на http://localhost:${PORT}`);
    });
}

module.exports = { startWebServer, setDiscordClient };
