const Database = require('better-sqlite3');
const path = require('path');

// Создаем/открываем базу данных
const db = new Database(path.join(__dirname, 'tickets.db'));

// Включаем WAL режим для лучшей производительности
db.pragma('journal_mode = WAL');

// Создание таблиц
function initializeDatabase() {
    // Таблица тикетов
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            channel_name TEXT NOT NULL,
            ticket_number INTEGER NOT NULL,
            type TEXT DEFAULT 'order',
            topic TEXT,
            description TEXT,
            budget TEXT,
            deadline TEXT,
            requirements TEXT,
            boost_count TEXT,
            server_link TEXT,
            created_at INTEGER NOT NULL,
            status TEXT DEFAULT 'open',
            closed_at INTEGER,
            close_reason TEXT,
            completed INTEGER DEFAULT 0,
            completed_at INTEGER
        )
    `);

    // Таблица счетчиков тикетов
    db.exec(`
        CREATE TABLE IF NOT EXISTS ticket_counters (
            user_id TEXT PRIMARY KEY,
            last_number INTEGER DEFAULT 0
        )
    `);

    // Таблица статистики
    db.exec(`
        CREATE TABLE IF NOT EXISTS statistics (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            completed_orders INTEGER DEFAULT 0,
            total_boosts_sold INTEGER DEFAULT 0
        )
    `);

    // Вставляем начальную запись статистики, если её нет
    db.prepare(`
        INSERT OR IGNORE INTO statistics (id, completed_orders, total_boosts_sold)
        VALUES (1, 0, 0)
    `).run();

    // Таблица каналов статистики
    db.exec(`
        CREATE TABLE IF NOT EXISTS stat_channels (
            channel_type TEXT PRIMARY KEY,
            channel_id TEXT
        )
    `);

    // Таблица шаблонов эмбедов
    db.exec(`
        CREATE TABLE IF NOT EXISTS embed_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);

    // Создаем индексы для быстрого поиска
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
    `);

    console.log('[БД] База данных SQLite инициализирована');
}

// Функции для работы с тикетами

// Добавить тикет
function addTicket(userId, ticketNumber, channelId, channelName, ticketInfo) {
    const stmt = db.prepare(`
        INSERT INTO tickets (
            id, user_id, channel_name, ticket_number, type,
            topic, description, budget, deadline, requirements,
            boost_count, server_link, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const ticket = stmt.run(
        channelId,
        userId,
        channelName,
        ticketNumber,
        ticketInfo.type || 'order',
        ticketInfo.topic || null,
        ticketInfo.description || null,
        ticketInfo.budget || null,
        ticketInfo.deadline || null,
        ticketInfo.requirements || null,
        ticketInfo.boostCount || null,
        ticketInfo.serverLink || null,
        Date.now(),
        'open'
    );

    // Обновляем счетчик
    db.prepare(`
        INSERT INTO ticket_counters (user_id, last_number)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET last_number = ?
    `).run(userId, ticketNumber, ticketNumber);

    return ticket;
}

// Получить следующий номер тикета
function getNextTicketNumber(userId) {
    const row = db.prepare('SELECT last_number FROM ticket_counters WHERE user_id = ?').get(userId);
    return (row?.last_number || 0) + 1;
}

// Закрыть тикет
function closeTicket(channelId, reason = null) {
    const stmt = db.prepare(`
        UPDATE tickets 
        SET status = 'closed', closed_at = ?, close_reason = ?
        WHERE id = ?
    `);
    
    stmt.run(Date.now(), reason, channelId);
    
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(channelId);
}

// Пометить заказ как выполненный
function markOrderComplete(channelId) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(channelId);
    
    if (!ticket || ticket.type === 'boost') {
        return { success: false, reason: 'not_found' };
    }
    
    if (ticket.completed === 1) {
        return { success: false, reason: 'already_completed' };
    }
    
    db.prepare(`
        UPDATE tickets 
        SET completed = 1, completed_at = ?
        WHERE id = ?
    `).run(Date.now(), channelId);
    
    // Увеличиваем счетчик выполненных заказов
    db.prepare('UPDATE statistics SET completed_orders = completed_orders + 1 WHERE id = 1').run();
    
    return { success: true, ticket };
}

// Добавить проданные бусты
function addBoostsSold(amount) {
    db.prepare('UPDATE statistics SET total_boosts_sold = total_boosts_sold + ? WHERE id = 1').run(amount);
    
    const stats = db.prepare('SELECT total_boosts_sold FROM statistics WHERE id = 1').get();
    return stats.total_boosts_sold;
}

// Получить статистику
function getStatistics() {
    return db.prepare('SELECT * FROM statistics WHERE id = 1').get();
}

// Сбросить статистику
function resetStatistic(statType) {
    if (statType === 'completedOrders') {
        db.prepare('UPDATE statistics SET completed_orders = 0 WHERE id = 1').run();
    } else if (statType === 'totalBoostsSold') {
        db.prepare('UPDATE statistics SET total_boosts_sold = 0 WHERE id = 1').run();
    }
}

// Функции для каналов статистики

function getStatChannel(channelType) {
    const row = db.prepare('SELECT channel_id FROM stat_channels WHERE channel_type = ?').get(channelType);
    return row?.channel_id || null;
}

function setStatChannel(channelType, channelId) {
    db.prepare(`
        INSERT INTO stat_channels (channel_type, channel_id)
        VALUES (?, ?)
        ON CONFLICT(channel_type) DO UPDATE SET channel_id = ?
    `).run(channelType, channelId, channelId);
}

function clearStatChannel(channelType) {
    db.prepare('DELETE FROM stat_channels WHERE channel_type = ?').run(channelType);
}

// Получить все тикеты
function getAllTickets() {
    return db.prepare('SELECT * FROM tickets').all();
}

// Получить тикет по ID
function getTicket(channelId) {
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(channelId);
}

// Функции для работы с шаблонами эмбедов

// Создать шаблон
function createTemplate(name, content) {
    const now = Date.now();
    try {
        db.prepare(`
            INSERT INTO embed_templates (name, content, created_at, updated_at)
            VALUES (?, ?, ?, ?)
        `).run(name, content, now, now);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Получить все шаблоны
function getAllTemplates() {
    return db.prepare('SELECT id, name, created_at, updated_at FROM embed_templates ORDER BY name').all();
}

// Получить шаблон по ID
function getTemplate(id) {
    return db.prepare('SELECT * FROM embed_templates WHERE id = ?').get(id);
}

// Обновить шаблон
function updateTemplate(id, name, content) {
    const now = Date.now();
    try {
        db.prepare(`
            UPDATE embed_templates
            SET name = ?, content = ?, updated_at = ?
            WHERE id = ?
        `).run(name, content, now, id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Удалить шаблон
function deleteTemplate(id) {
    db.prepare('DELETE FROM embed_templates WHERE id = ?').run(id);
    return { success: true };
}

// Инициализируем базу данных при загрузке модуля
initializeDatabase();

module.exports = {
    db,
    addTicket,
    getNextTicketNumber,
    closeTicket,
    markOrderComplete,
    addBoostsSold,
    getStatistics,
    resetStatistic,
    getStatChannel,
    setStatChannel,
    clearStatChannel,
    getAllTickets,
    getTicket,
    createTemplate,
    getAllTemplates,
    getTemplate,
    updateTemplate,
    deleteTemplate
};
