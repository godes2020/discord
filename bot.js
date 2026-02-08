const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    MessageFlags,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Подключаем SQL базу данных вместо JSON
const {
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
    getTicket
} = require('./database.js');

// Функция сохранения транскрипта тикета
async function saveTranscript(channel, isBoost = false) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        
        let transcript = `ТРАНСКРИПТ ТИКЕТА: ${channel.name}\n`;
        transcript += `Дата создания: ${new Date(channel.createdTimestamp).toLocaleString('ru-RU')}\n`;
        transcript += `Дата закрытия: ${new Date().toLocaleString('ru-RU')}\n`;
        transcript += `${'='.repeat(80)}\n\n`;
        
        sortedMessages.forEach(msg => {
            const timestamp = new Date(msg.createdTimestamp).toLocaleString('ru-RU');
            transcript += `[${timestamp}] ${msg.author.tag}:\n`;
            
            // Сохраняем текстовый контент
            if (msg.content && msg.content.trim()) {
                transcript += `${msg.content}\n`;
            }
            
            // Обрабатываем эмбеды
            if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    if (embed.description) {
                        transcript += `${embed.description}\n`;
                    }
                    if (embed.title) {
                        transcript += `Заголовок: ${embed.title}\n`;
                    }
                    if (embed.fields && embed.fields.length > 0) {
                        embed.fields.forEach(field => {
                            transcript += `${field.name}: ${field.value}\n`;
                        });
                    }
                });
            }
            
            // Обрабатываем компоненты V2
            if (msg.components && msg.components.length > 0) {
                msg.components.forEach(component => {
                    // Пытаемся извлечь текст из компонентов
                    if (component.components) {
                        component.components.forEach(subComp => {
                            if (subComp.label) {
                                transcript += `[Кнопка: ${subComp.label}]\n`;
                            }
                        });
                    }
                });
            }
            
            // Сохраняем файлы
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    transcript += `[ФАЙЛ: ${att.name} - ${att.url}]\n`;
                });
            }
            
            // Если ничего не было сохранено, добавляем заметку
            if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) {
                transcript += `[Системное сообщение или закрепленное]\n`;
            }
            
            transcript += `\n`;
        });
        
        const folder = isBoost ? 'boosts' : 'orders';
        const filename = `${channel.name}_${Date.now()}.txt`;
        const filepath = path.join(__dirname, 'transcripts', folder, filename);
        
        fs.writeFileSync(filepath, transcript, 'utf8');
        console.log(`[ТРАНСКРИПТ] Сохранён: ${filepath}`);
        
        return filepath;
    } catch (error) {
        console.error('Ошибка сохранения транскрипта:', error);
        return null;
    }
}

// Функция для обновления канала статистики
async function updateStatChannel(client, channelType) {
    const stats = getStatistics();
    const channelId = getStatChannel(channelType);
    
    if (!channelId) return;
    
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            // Канал не найден, очищаем его из базы данных
            clearStatChannel(channelType);
            return;
        }
        
        let newName;
        switch(channelType) {
            case 'zakazinfodone':
                newName = `✅ Заказов выполнено: ${stats.completed_orders}`;
                break;
            case 'boostinfo':
                newName = `💎 Бустов продано: ${stats.total_boosts_sold}`;
                break;
            case 'memberdc':
                newName = `👥 Участников: ${channel.guild.memberCount}`;
                break;
            case 'memberdconline':
                const onlineCount = channel.guild.members.cache.filter(m => 
                    m.presence && 
                    (m.presence.status === 'online' || m.presence.status === 'idle' || m.presence.status === 'dnd')
                ).size;
                newName = `🟢 Онлайн: ${onlineCount}`;
                break;
        }
        
        if (newName && channel.name !== newName) {
            await channel.setName(newName);
        }
    } catch (error) {
        // Если канал не найден (ошибка 10003), очищаем его из базы
        if (error.code === 10003) {
            clearStatChannel(channelType);
            console.log(`Канал ${channelType} удален из базы данных (не существует)`);
        } else {
            console.error(`Ошибка обновления канала ${channelType}:`, error);
        }
    }
}

// Создаем клиента Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Команды
const commands = [
    {
        name: 'sosal',
        description: 'Отправить приветствие'
    },
    {
        name: 'send',
        description: 'Отправить сообщение из message.json'
    },
    {
        name: 'ticketstartmessage',
        description: 'Отправить сообщение для создания тикетов'
    },
    {
        name: 'ticketboostfirstmessage',
        description: 'Отправить сообщение для заказа бустов'
    },
    {
        name: 'ticketzakazdone',
        description: 'Пометить заказ как выполненный (использовать в тикете)'
    },
    {
        name: 'ticketboostdone',
        description: 'Добавить проданные бусты',
        options: [
            {
                name: 'количество',
                description: 'Количество проданных бустов',
                type: 4, // INTEGER
                required: true
            }
        ]
    },
    {
        name: 'ticketchenal',
        description: 'Управление каналами статистики',
        options: [
            {
                name: 'create',
                description: 'Создать канал статистики',
                type: 1, // SUB_COMMAND
                options: [
                    {
                        name: 'тип',
                        description: 'Тип канала статистики',
                        type: 3, // STRING
                        required: true,
                        choices: [
                            {
                                name: 'Выполненные заказы',
                                value: 'zakazinfodone'
                            },
                            {
                                name: 'Количество участников',
                                value: 'memberdc'
                            },
                            {
                                name: 'Участники онлайн',
                                value: 'memberdconline'
                            },
                            {
                                name: 'Информация о бустах',
                                value: 'boostinfo'
                            }
                        ]
                    }
                ]
            },
            {
                name: 'reset',
                description: 'Сбросить счетчик статистики',
                type: 1, // SUB_COMMAND
                options: [
                    {
                        name: 'тип',
                        description: 'Тип счетчика для сброса',
                        type: 3, // STRING
                        required: true,
                        choices: [
                            {
                                name: 'Выполненные заказы',
                                value: 'completedOrders'
                            },
                            {
                                name: 'Проданные бусты',
                                value: 'totalBoostsSold'
                            }
                        ]
                    }
                ]
            },
            {
                name: 'createall',
                description: 'Создать все каналы статистики сразу',
                type: 1 // SUB_COMMAND
            }
        ]
    },
    {
        name: 'ticket',
        description: 'Управление тикетом',
        options: [
            {
                name: 'add',
                description: 'Добавить пользователя в тикет',
                type: 1, // SUB_COMMAND
                options: [
                    {
                        name: 'user',
                        description: 'Пользователь для добавления',
                        type: 6, // USER
                        required: true
                    }
                ]
            }
        ]
    }
];

// Регистрация команд
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`Бот ${client.user.tag} запущен!`);
    
    try {
        console.log('Синхронизация команд...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Команды успешно синхронизированы!');
    } catch (error) {
        console.error('Ошибка синхронизации:', error);
    }

    // Автообновление каналов статистики каждые 5 секунд
    setInterval(async () => {
        try {
            await updateStatChannel(client, 'zakazinfodone');
            await updateStatChannel(client, 'boostinfo');
            await updateStatChannel(client, 'memberdc');
            await updateStatChannel(client, 'memberdconline');
        } catch (error) {
            console.error('Ошибка автообновления каналов:', error);
        }
    }, 5000); // 5 секунд
});

// Функция конвертации V2 формата в Discord.js V2 Components
function convertV2ToDiscord(v2Data) {
    try {
        const container = new ContainerBuilder();
        
        // Устанавливаем цвет контейнера только если он указан
        if (v2Data.accentColor || v2Data.accent_color) {
            container.setAccentColor(v2Data.accentColor || v2Data.accent_color);
        }
        
        // Обработка V2 компонентов
        if (v2Data.components && v2Data.components.length > 0) {
            for (const comp of v2Data.components) {
                if (comp.type === 17 && comp.components) { // V2 Container
                    // Обрабатываем компоненты в правильном порядке
                    for (const subComp of comp.components) {
                        try {
                            // Тип 12 - медиа галерея
                            if (subComp.type === 12 && subComp.items && subComp.items[0]?.media?.url) {
                                const gallery = new MediaGalleryBuilder().addItems(
                                    new MediaGalleryItemBuilder().setURL(subComp.items[0].media.url)
                                );
                                container.addMediaGalleryComponents(gallery);
                            }
                            
                            // Тип 14 - сепаратор (разделитель)
                            else if (subComp.type === 14) {
                                const separator = new SeparatorBuilder();
                                
                                if (subComp.divider !== undefined) {
                                    separator.setDivider(subComp.divider);
                                }
                                
                                if (subComp.spacing !== undefined) {
                                    separator.setSpacing(subComp.spacing);
                                }
                                
                                container.addSeparatorComponents(separator);
                            }
                            
                            // Тип 10 - текст
                            else if (subComp.type === 10 && subComp.content) {
                                const textDisplay = new TextDisplayBuilder().setContent(subComp.content);
                                container.addTextDisplayComponents(textDisplay);
                            }
                            
                            // Тип 9 - секция с аксессуаром (кнопка или thumbnail)
                            else if (subComp.type === 9) {
                                const section = new SectionBuilder();
                                
                                // Добавляем текст секции если есть
                                if (subComp.components && subComp.components[0]?.content) {
                                    const textDisplay = new TextDisplayBuilder()
                                        .setContent(subComp.components[0].content);
                                    section.addTextDisplayComponents(textDisplay);
                                }
                                
                                // Проверяем тип аксессуара
                                if (subComp.accessory) {
                                    if (subComp.accessory.type === 2) {
                                        // Тип 2 - кнопка
                                        let customId = 'button_' + (subComp.id || Math.random().toString(36).substr(2, 9));
                                        
                                        // Проверяем action_set_id для специальных кнопок
                                        if (subComp.accessory.action_set_id === 'create_ticket_action' || 
                                            subComp.accessory.action_set_id === '828242416') {
                                            customId = 'create_ticket';
                                        }
                                        else if (subComp.accessory.action_set_id === 'create_boost_ticket_action' || 
                                                 subComp.accessory.action_set_id === 'create_boost_ticket') {
                                            customId = 'create_boost_ticket';
                                        }
                                        else if (subComp.accessory.action_set_id === '357954935') {
                                            // Кнопка верификации
                                            customId = 'verify_button';
                                        }
                                        
                                        const button = new ButtonBuilder()
                                            .setCustomId(customId)
                                            .setLabel(subComp.accessory.label || 'Кнопка')
                                            .setStyle(subComp.accessory.style || ButtonStyle.Primary);
                                        
                                        if (subComp.accessory.emoji) {
                                            if (subComp.accessory.emoji.id) {
                                                button.setEmoji(subComp.accessory.emoji.id);
                                            } else if (subComp.accessory.emoji.name) {
                                                button.setEmoji(subComp.accessory.emoji.name);
                                            }
                                        }
                                        
                                        section.setButtonAccessory(button);
                                    } else if (subComp.accessory.type === 11 && subComp.accessory.media?.url) {
                                        // Тип 11 - медиа аксессуар (используем ThumbnailBuilder)
                                        const thumbnail = new ThumbnailBuilder({ 
                                            media: { url: subComp.accessory.media.url } 
                                        });
                                        section.setThumbnailAccessory(thumbnail);
                                    }
                                }
                                
                                container.addSectionComponents(section);
                            }
                        } catch (componentError) {
                            console.error(`Ошибка при обработке компонента типа ${subComp.type}:`, componentError);
                        }
                    }
                }
            }
        }

        return {
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        };
    } catch (error) {
        console.error('Ошибка конвертации V2 компонентов:', error);
        throw error;
    }
}

// Обработка команд
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'sosal') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        await interaction.reply('привет');
    }

    if (interaction.commandName === 'ticket') {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'add') {
            // Проверяем права администратора
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({
                    content: '❌ У вас нет прав для использования этой команды!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const channel = interaction.channel;
            const userToAdd = interaction.options.getUser('user');
            const memberToAdd = interaction.guild.members.cache.get(userToAdd.id);

            // Проверяем что команда используется в канале тикета
            const ticketChannelRegex = /^[a-z0-9_]+-\d{3}$/;
            if (!ticketChannelRegex.test(channel.name)) {
                return await interaction.reply({
                    content: '❌ Эта команда может использоваться только в канале тикета!',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                // Добавляем права пользователю на просмотр и отправку сообщений
                await channel.permissionOverwrites.create(memberToAdd, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true,
                    EmbedLinks: true
                });

                await interaction.reply({
                    content: `✅ Пользователь ${userToAdd} успешно добавлен в тикет!`,
                    flags: MessageFlags.Ephemeral
                });

                // Отправляем уведомление в канал
                await channel.send({
                    content: `➕ ${userToAdd} был добавлен в тикет администратором ${interaction.user}`
                });
            } catch (error) {
                console.error('Ошибка добавления пользователя:', error);
                await interaction.reply({
                    content: '❌ Ошибка при добавлении пользователя в тикет!',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        return;
    }

    if (interaction.commandName === 'ticketstartmessage') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        try {
            // Сначала отвечаем на команду
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const ticketPath = path.join(__dirname, 'ticket.json');
            
            if (!fs.existsSync(ticketPath)) {
                return await interaction.editReply({
                    content: '❌ Файл ticket.json не найден!'
                });
            }

            const rawData = fs.readFileSync(ticketPath, 'utf8');
            const jsonData = JSON.parse(rawData);

            // Конвертируем V2 формат для тикетов
            const messageData = convertV2ToDiscord(jsonData);

            // Отправляем сообщение с V2 компонентами
            await interaction.channel.send(messageData);

            await interaction.editReply({
                content: '✅ Сообщение тикетов отправлено!'
            });

        } catch (error) {
            console.error('Ошибка отправки тикета:', error);
            await interaction.reply({
                content: `❌ Ошибка: ${error.message}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }

    if (interaction.commandName === 'ticketboostfirstmessage') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        try {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const boostPath = path.join(__dirname, 'boost.json');
            
            if (!fs.existsSync(boostPath)) {
                return await interaction.editReply({
                    content: '❌ Файл boost.json не найден!'
                });
            }

            const rawData = fs.readFileSync(boostPath, 'utf8');
            const jsonData = JSON.parse(rawData);

            // Конвертируем V2 формат для бустов
            const messageData = convertV2ToDiscord(jsonData);

            // Отправляем сообщение с V2 компонентами
            await interaction.channel.send(messageData);

            await interaction.editReply({
                content: '✅ Сообщение для заказа бустов отправлено!'
            });

        } catch (error) {
            console.error('Ошибка отправки сообщения бустов:', error);
            await interaction.reply({
                content: `❌ Ошибка: ${error.message}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }

    if (interaction.commandName === 'send') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        try {
            // Откладываем ответ, чтобы избежать таймаута
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const messagePath = path.join(__dirname, 'message.json');
            
            if (!fs.existsSync(messagePath)) {
                return await interaction.editReply({
                    content: '❌ Файл message.json не найден!'
                });
            }

            const rawData = fs.readFileSync(messagePath, 'utf8');
            const jsonData = JSON.parse(rawData);

            // Конвертируем V2 формат
            const messageData = convertV2ToDiscord(jsonData);

            // Отправляем сообщение с V2 компонентами
            await interaction.channel.send(messageData);
            
            await interaction.editReply({
                content: '✅ Сообщение отправлено!'
            });

        } catch (error) {
            console.error('Ошибка отправки:', error);
            try {
                await interaction.editReply({
                    content: `❌ Ошибка: ${error.message}`
                });
            } catch (e) {
                console.error('Не удалось отправить сообщение об ошибке:', e);
            }
        }
    }
});

// Обработчик команд статистики и выполнения заказов
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Команда пометки заказа как выполненного
    if (interaction.commandName === 'ticketzakazdone') {
        const channel = interaction.channel;
        
        // Проверяем что это канал тикета
        const ticketChannelRegex = /^[a-z0-9_]+-\d{3}$/;
        if (!ticketChannelRegex.test(channel.name)) {
            return await interaction.reply({
                content: '❌ Эта команда может использоваться только в канале заказа!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }

        const result = markOrderComplete(channel.id);
        
        if (result.success) {
            await interaction.reply({
                content: '✅ Заказ помечен как выполненный! Счетчик обновлен.',
                flags: MessageFlags.Ephemeral
            });
            
            // Обновляем канал статистики
            await updateStatChannel(client, 'zakazinfodone');
        } else if (result.reason === 'already_completed') {
            await interaction.reply({
                content: '⚠️ Этот заказ уже был помечен как выполненный!',
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.reply({
                content: '❌ Не удалось найти информацию о заказе в базе данных!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    // Команда добавления проданных бустов
    if (interaction.commandName === 'ticketboostdone') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }

        const amount = interaction.options.getInteger('количество');
        
        if (amount <= 0) {
            return await interaction.reply({
                content: '❌ Количество должно быть больше нуля!',
                flags: MessageFlags.Ephemeral
            });
        }

        const newTotal = addBoostsSold(amount);
        
        await interaction.reply({
            content: `✅ Добавлено бустов: ${amount}. Всего продано: ${newTotal}`,
            flags: MessageFlags.Ephemeral
        });

        // Обновляем канал статистики
        await updateStatChannel(client, 'boostinfo');
    }

    // Команда управления каналами статистики
    if (interaction.commandName === 'ticketchenal') {
        // Проверяем права администратора
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ У вас нет прав для использования этой команды!',
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            const channelType = interaction.options.getString('тип');
            
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const stats = getStatistics();
                const existingChannelId = getStatChannel(channelType);
                
                // Проверяем, не существует ли уже канал
                if (existingChannelId) {
                    const existingChannel = await client.channels.fetch(existingChannelId).catch(() => null);
                    if (existingChannel) {
                        return await interaction.editReply({
                            content: '⚠️ Канал статистики этого типа уже существует!'
                        });
                    }
                }

                let channelName;
                switch(channelType) {
                    case 'zakazinfodone':
                        channelName = `✅ Заказов выполнено: ${stats.completed_orders}`;
                        break;
                    case 'boostinfo':
                        channelName = `💎 Бустов продано: ${stats.total_boosts_sold}`;
                        break;
                    case 'memberdc':
                        channelName = `👥 Участников: ${interaction.guild.memberCount}`;
                        break;
                    case 'memberdconline':
                        const onlineCount = interaction.guild.members.cache.filter(m => 
                            m.presence && 
                            (m.presence.status === 'online' || m.presence.status === 'idle' || m.presence.status === 'dnd')
                        ).size;
                        channelName = `🟢 Онлайн: ${onlineCount}`;
                        break;
                }

                // Создаем голосовой канал (недоступен для входа)
                const channel = await interaction.guild.channels.create({
                    name: channelName,
                    type: 2, // GUILD_VOICE
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: ['Connect', 'Speak']
                        }
                    ]
                });

                // Сохраняем ID канала в базу данных
                setStatChannel(channelType, channel.id);

                await interaction.editReply({
                    content: `✅ Канал статистики создан: ${channel.name}`
                });

            } catch (error) {
                console.error('Ошибка создания канала:', error);
                await interaction.editReply({
                    content: '❌ Ошибка при создании канала статистики!'
                });
            }
        }

        if (subcommand === 'reset') {
            const statType = interaction.options.getString('тип');
            
            resetStatistic(statType);
            
            if (statType === 'completedOrders') {
                await updateStatChannel(client, 'zakazinfodone');
                
                await interaction.reply({
                    content: '✅ Счетчик выполненных заказов сброшен!',
                    flags: MessageFlags.Ephemeral
                });
            } else if (statType === 'totalBoostsSold') {
                await updateStatChannel(client, 'boostinfo');
                
                await interaction.reply({
                    content: '✅ Счетчик проданных бустов сброшен!',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (subcommand === 'createall') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const stats = getStatistics();
                const channelTypes = ['zakazinfodone', 'boostinfo', 'memberdc', 'memberdconline'];
                const createdChannels = [];
                const skippedChannels = [];

                for (const channelType of channelTypes) {
                    // Проверяем, не существует ли уже канал
                    const existingChannelId = getStatChannel(channelType);
                    if (existingChannelId) {
                        const existingChannel = await client.channels.fetch(existingChannelId).catch(() => null);
                        if (existingChannel) {
                            skippedChannels.push(channelType);
                            continue;
                        }
                    }

                    let channelName;
                    switch(channelType) {
                        case 'zakazinfodone':
                            channelName = `✅ Заказов выполнено: ${stats.completed_orders}`;
                            break;
                        case 'boostinfo':
                            channelName = `💎 Бустов продано: ${stats.total_boosts_sold}`;
                            break;
                        case 'memberdc':
                            channelName = `👥 Участников: ${interaction.guild.memberCount}`;
                            break;
                        case 'memberdconline':
                            const onlineCount = interaction.guild.members.cache.filter(m => 
                                m.presence && 
                                (m.presence.status === 'online' || m.presence.status === 'idle' || m.presence.status === 'dnd')
                            ).size;
                            channelName = `🟢 Онлайн: ${onlineCount}`;
                            break;
                    }

                    // Создаем голосовой канал (недоступен для входа)
                    const channel = await interaction.guild.channels.create({
                        name: channelName,
                        type: 2, // GUILD_VOICE
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: ['Connect', 'Speak']
                            }
                        ]
                    });

                    // Сохраняем ID канала в базу данных
                    setStatChannel(channelType, channel.id);
                    createdChannels.push(channelName);
                }

                let message = '';
                if (createdChannels.length > 0) {
                    message += `✅ Созданы каналы:\n${createdChannels.map(c => `- ${c}`).join('\n')}`;
                }
                if (skippedChannels.length > 0) {
                    message += `\n\n⚠️ Пропущены (уже существуют): ${skippedChannels.length} канал(ов)`;
                }
                if (createdChannels.length === 0) {
                    message = '⚠️ Все каналы уже созданы!';
                }

                await interaction.editReply({ content: message });

            } catch (error) {
                console.error('Ошибка создания каналов:', error);
                await interaction.editReply({
                    content: '❌ Ошибка при создании каналов статистики!'
                });
            }
        }
    }
});

// Единый обработчик всех взаимодействий
client.on('interactionCreate', async interaction => {
    // ============ ОБРАБОТКА КНОПОК ============
    if (interaction.isButton()) {
        // Создание тикета - показываем модальное окно
        if (interaction.customId === 'create_ticket') {
            try {
                // Создаём модальное окно с формой (сразу, без задержек)
                const modal = new ModalBuilder()
                    .setCustomId('ticket_form')
                    .setTitle('Создание заказа');

                // Поле: Тема заказа
                const topicInput = new TextInputBuilder()
                    .setCustomId('topic')
                    .setLabel('Тема заказа')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: Разработка Discord бота')
                    .setRequired(true)
                    .setMaxLength(100);

                // Поле: Описание
                const descriptionInput = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Описание')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Подробно опишите что вам нужно...')
                    .setRequired(true)
                    .setMaxLength(1000);

                // Поле: Бюджет
                const budgetInput = new TextInputBuilder()
                    .setCustomId('budget')
                    .setLabel('Бюджет')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: 5000 руб или договорная')
                    .setRequired(true)
                    .setMaxLength(50);

                // Поле: Сроки
                const deadlineInput = new TextInputBuilder()
                    .setCustomId('deadline')
                    .setLabel('Сроки')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: 2 недели или до 1 февраля')
                    .setRequired(true)
                    .setMaxLength(100);

                // Поле: Пожелания по исполнителю
                const requirementsInput = new TextInputBuilder()
                    .setCustomId('requirements')
                    .setLabel('Пожелания по исполнителю')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Опыт работы, навыки, портфолио и т.д.')
                    .setRequired(false)
                    .setMaxLength(500);

                // Создаём ряды для каждого поля
                const row1 = new ActionRowBuilder().addComponents(topicInput);
                const row2 = new ActionRowBuilder().addComponents(descriptionInput);
                const row3 = new ActionRowBuilder().addComponents(budgetInput);
                const row4 = new ActionRowBuilder().addComponents(deadlineInput);
                const row5 = new ActionRowBuilder().addComponents(requirementsInput);

                modal.addComponents(row1, row2, row3, row4, row5);

                // Показываем модальное окно (сразу!)
                await interaction.showModal(modal);
                console.log(`[ТИКЕТ] Пользователь ${interaction.user.tag} нажал кнопку создания тикета`);

            } catch (error) {
                console.error('Ошибка показа формы:', error);
            }
            return;
        }

        // Создание буст-тикета
        if (interaction.customId === 'create_boost_ticket') {
            try {
                // Создаём модальное окно для заказа бустов (сразу, без задержек)
                const modal = new ModalBuilder()
                    .setCustomId('boost_form')
                    .setTitle('Заказ бустов');

                // Поле: Количество бустов
                const boostCountInput = new TextInputBuilder()
                    .setCustomId('boost_count')
                    .setLabel('Количество бустов')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: 14 или 28')
                    .setRequired(true)
                    .setMaxLength(10);

                // Поле: Ссылка на сервер
                const serverLinkInput = new TextInputBuilder()
                    .setCustomId('server_link')
                    .setLabel('Ссылка на сервер')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: discord.gg/ваш-сервер')
                    .setRequired(true)
                    .setMaxLength(200);

                // Создаём ряды для полей
                const row1 = new ActionRowBuilder().addComponents(boostCountInput);
                const row2 = new ActionRowBuilder().addComponents(serverLinkInput);

                modal.addComponents(row1, row2);

                // Показываем модальное окно (сразу!)
                await interaction.showModal(modal);
                console.log(`[БУСТ-ТИКЕТ] Пользователь ${interaction.user.tag} нажал кнопку заказа бустов`);

            } catch (error) {
                console.error('Ошибка показа формы бустов:', error);
            }
            return;
        }

        // Закрытие буст-тикета без причины
        if (interaction.customId === 'close_boost_simple') {
            try {
                // Отложенный ответ для избежания таймаута
                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                if (!interaction.member.permissions.has('Administrator')) {
                    return await interaction.editReply({
                        content: '❌ Эта функция доступна только для администрации сервера!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const channel = interaction.channel;

                if (!channel.name.match(/^boost-[a-z0-9_]+-\d{3}$/) || channel.parentId !== '1463121412171759686') {
                    return await interaction.editReply({
                        content: '❌ Эта команда работает только в каналах буст-тикетов!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.editReply({
                    content: '🔒 Буст-тикет закрыт.',
                    flags: MessageFlags.Ephemeral
                });

                // Сохраняем транскрипт
                await saveTranscript(channel, true);

                closeTicket(channel.id);
                console.log(`[БД] Буст-тикет ${channel.name} отмечен как закрытый в базе данных`);

                await channel.delete('Буст-тикет закрыт');

            } catch (error) {
                console.error('Ошибка закрытия буст-тикета:', error);
            }
            return;
        }

        // Закрытие буст-тикета с причиной
        if (interaction.customId === 'close_boost_reason') {
            try {
                if (!interaction.member.permissions.has('Administrator')) {
                    return await interaction.reply({
                        content: '❌ Только администраторы могут закрывать тикеты с причиной!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const channel = interaction.channel;

                if (!channel.name.match(/^boost-[a-z0-9_]+-\d{3}$/) || channel.parentId !== '1463121412171759686') {
                    return await interaction.reply({
                        content: '❌ Эта команда работает только в каналах буст-тикетов!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const modal = new ModalBuilder()
                    .setCustomId('close_boost_reason_modal')
                    .setTitle('Причина закрытия буст-тикета');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Укажите причину закрытия')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Например: Заказ выполнен, клиент не отвечает и т.д.')
                    .setRequired(true)
                    .setMaxLength(500);

                const row = new ActionRowBuilder().addComponents(reasonInput);
                modal.addComponents(row);

                await interaction.showModal(modal);

            } catch (error) {
                console.error('Ошибка показа модального окна:', error);
            }
            return;
        }

        // Закрытие тикета без причины
        if (interaction.customId === 'close_ticket_simple') {
            try {
                // Отложенный ответ для избежания таймаута
                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                // Проверяем права администратора
                if (!interaction.member.permissions.has('Administrator')) {
                    return await interaction.editReply({
                        content: '❌ Эта функция доступна только для администрации сервера!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const channel = interaction.channel;

                // Проверяем, что это канал тикета
                if (!channel.name.match(/^[a-z0-9_]+-\d{3}$/) || channel.parentId !== '1463121412171759686') {
                    return await interaction.editReply({
                        content: '❌ Эта команда работает только в каналах тикетов!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.editReply({
                    content: '🔒 Тикет закрыт.',
                    flags: MessageFlags.Ephemeral
                });

                // Сохраняем транскрипт
                await saveTranscript(channel, false);

                // Сохраняем закрытие тикета в базу данных
                closeTicket(channel.id);
                console.log(`[БД] Тикет ${channel.name} отмечен как закрытый в базе данных`);

                await channel.delete('Тикет закрыт');

            } catch (error) {
                console.error('Ошибка закрытия тикета:', error);
            }
            return;
        }

        // Закрытие тикета с причиной (только для администраторов)
        if (interaction.customId === 'close_ticket_reason') {
            try {
                // Проверяем права администратора
                if (!interaction.member.permissions.has('Administrator')) {
                    return await interaction.reply({
                        content: '❌ Только администраторы могут закрывать тикеты с причиной!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const channel = interaction.channel;

                // Проверяем, что это канал тикета
                if (!channel.name.match(/^[a-z0-9_]+-\d{3}$/) || channel.parentId !== '1463121412171759686') {
                    return await interaction.reply({
                        content: '❌ Эта команда работает только в каналах тикетов!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Показываем модальное окно для ввода причины
                const modal = new ModalBuilder()
                    .setCustomId('close_reason_modal')
                    .setTitle('Причина закрытия тикета');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Укажите причину закрытия')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Например: Заказ выполнен, клиент не отвечает и т.д.')
                    .setRequired(true)
                    .setMaxLength(500);

                const row = new ActionRowBuilder().addComponents(reasonInput);
                modal.addComponents(row);

                await interaction.showModal(modal);

            } catch (error) {
                console.error('Ошибка показа модального окна:', error);
            }
            return;
        }

        // Кнопка верификации
        if (interaction.customId === 'verify_button') {
            try {
                // Отложенный ответ, чтобы избежать таймаута
                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                const roleId = '1462726357732556936';
                const role = interaction.guild.roles.cache.get(roleId);
                
                if (!role) {
                    return await interaction.editReply({
                        content: '❌ Роль не найдена. Проверьте ID роли в коде.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Проверяем иерархию ролей
                const botMember = interaction.guild.members.me;
                if (role.position >= botMember.roles.highest.position) {
                    return await interaction.editReply({
                        content: '❌ Роль бота находится ниже целевой роли в иерархии сервера. Переместите роль бота выше роли участника в настройках сервера.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Проверяем, есть ли у пользователя уже эта роль
                if (interaction.member.roles.cache.has(roleId)) {
                    return await interaction.editReply({
                        content: '```✅ Вы уже верифицированы!```',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.member.roles.add(role);
                await interaction.editReply({
                    content: '```✅ Аккаунт успешно подтверждён!```',
                    flags: MessageFlags.Ephemeral
                });
            } catch (error) {
                console.error('Ошибка верификации:', error);
                
                let errorMessage = '❌ Ошибка при выдаче роли.';
                if (error.code === 50013) {
                    errorMessage = '❌ У бота недостаточно прав. Убедитесь, что роль бота выше роли участника в списке ролей сервера.';
                }
                
                await interaction.editReply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
            return;
        }
    }

    // ============ ОБРАБОТКА МОДАЛЬНЫХ ФОРМ ============
    if (interaction.isModalSubmit()) {

    // Обработка модального окна с причиной закрытия буст-тикета
    if (interaction.customId === 'close_boost_reason_modal') {
        try {
            const reason = interaction.fields.getTextInputValue('close_reason');
            const channel = interaction.channel;

            await interaction.reply({
                content: '⏳ Закрываю буст-тикет и отправляю уведомление...',
                flags: MessageFlags.Ephemeral
            });

            // Извлекаем данные из topic канала
            let ticketData = null;
            try {
                ticketData = JSON.parse(channel.topic);
            } catch (e) {
                console.error('Не удалось извлечь данные буст-тикета:', e);
            }

            if (!ticketData) {
                closeTicket(channel.id, reason);
                console.log(`[БД] Буст-тикет ${channel.name} отмечен как закрытый в базе данных`);
                await channel.delete('Буст-тикет закрыт');
                return;
            }

            const closeTime = Math.floor(Date.now() / 1000);
            const customer = await client.users.fetch(ticketData.customerId);

            // Отправляем упрощённое сообщение в ЛС для бустов
            if (customer) {
                try {
                    const dmContainer = new ContainerBuilder();
                    
                    // Добавляем картинку Frame_6560
                    const dmGallery = new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL('https://media.discordapp.net/attachments/1462804318611836928/1464225475952906414/Frame_6560.png?format=webp&quality=lossless')
                    );
                    dmContainer.addMediaGalleryComponents(dmGallery);

                    // Разделитель
                    const dmSeparator1 = new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(1);
                    dmContainer.addSeparatorComponents(dmSeparator1);

                    // Основное содержимое
                    const dmText = new TextDisplayBuilder()
                        .setContent(
                            `## Сведения о заказе:\n` +
                            `[🟢] **Открыл:** ${customer.username}\n` +
                            `[🔴] **Закрыл:** ${interaction.user.username}\n` +
                            `\n` +
                            `[📋] **Тема заказа**\n` +
                            `> Заказ бустов\n` +
                            `\n` +
                            `[📖] **Количество:**\n` +
                            `> ${ticketData.boostCount}\n` +
                            `\n` +
                            `[📝] **Куда покупали:**\n` +
                            `> ${ticketData.serverLink}\n` +
                            `\n` +
                            `[⏱️] **Время открытия**\n` +
                            `> <t:${ticketData.openTime}:F>\n` +
                            `\n` +
                            `[🔒] **Время закрытия**\n` +
                            `> <t:${closeTime}:F>\n` +
                            `\n` +
                            `[📝] **Причина закрытия**\n` +
                            `> ${reason}`
                        );
                    dmContainer.addTextDisplayComponents(dmText);

                    // Разделитель
                    const dmSeparator2 = new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(2);
                    dmContainer.addSeparatorComponents(dmSeparator2);

                    // Футер
                    const dmFooter = new TextDisplayBuilder()
                        .setContent(`*Тикет был автоматически заархивирован системой.*`);
                    dmContainer.addTextDisplayComponents(dmFooter);

                    await customer.send({
                        flags: MessageFlags.IsComponentsV2,
                        components: [dmContainer]
                    });

                    console.log(`[БУСТ-ТИКЕТ] Уведомление отправлено пользователю ${customer.tag}`);
                } catch (dmError) {
                    console.error('Ошибка отправки ЛС:', dmError);
                }
            }

            // Сохраняем транскрипт
            await saveTranscript(channel, true);

            closeTicket(channel.id, reason);
            console.log(`[БД] Буст-тикет ${channel.name} отмечен как закрытый с причиной в базе данных`);
            
            await channel.delete(`Буст-тикет закрыт: ${reason}`);

        } catch (error) {
            console.error('Ошибка обработки закрытия буст-тикета с причиной:', error);
        }
        return;
    }

    // Обработка модального окна с причиной закрытия
    if (interaction.customId === 'close_reason_modal') {
        try {
            const reason = interaction.fields.getTextInputValue('close_reason');
            const channel = interaction.channel;

            await interaction.reply({
                content: '⏳ Закрываю тикет и отправляю уведомление...',
                flags: MessageFlags.Ephemeral
            });

            // Извлекаем данные из topic канала
            let ticketData = null;
            try {
                ticketData = JSON.parse(channel.topic);
            } catch (e) {
                console.error('Не удалось извлечь данные тикета:', e);
            }

            if (!ticketData) {
                // Сохраняем закрытие тикета в базу данных
                closeTicket(channel.id, reason);
                console.log(`[БД] Тикет ${channel.name} отмечен как закрытый в базе данных`);
                await channel.delete('Тикет закрыт');
                return;
            }

            const closeTime = Math.floor(Date.now() / 1000);
            const customer = await client.users.fetch(ticketData.customerId);

            // Отправляем сообщение в ЛС заказчику
            if (customer) {
                try {
                    const dmContainer = new ContainerBuilder();
                    
                    // Добавляем картинку Frame_6560
                    const dmGallery = new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL('https://media.discordapp.net/attachments/1462804318611836928/1464225475952906414/Frame_6560.png?format=webp&quality=lossless')
                    );
                    dmContainer.addMediaGalleryComponents(dmGallery);

                    // Разделитель
                    const dmSeparator1 = new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(1);
                    dmContainer.addSeparatorComponents(dmSeparator1);

                    // Основное содержимое
                    const dmText = new TextDisplayBuilder()
                        .setContent(
                            `## Сведения о заказе:\n` +
                            `[🟢] **Открыл:** ${customer.username}\n` +
                            `[🔴] **Закрыл:** ${interaction.user.username}\n` +
                            ` \n` +
                            `[📋] **Тема заказа**\n` +
                            `> ${ticketData.topic}\n` +
                            ` \n` +
                            `[📝] **Описание**\n` +
                            `> ${ticketData.description}\n` +
                            ` \n` +
                            `[⏱️] **Время открытия**\n` +
                            `> <t:${ticketData.openTime}:F>\n` +
                            ` \n` +
                            `[🔒] **Время закрытия**\n` +
                            `> <t:${closeTime}:F>\n` +
                            ` \n` +
                            `[📝] **Причина закрытия**\n` +
                            `> ${reason}`
                        );
                    dmContainer.addTextDisplayComponents(dmText);

                    // Разделитель
                    const dmSeparator2 = new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(2);
                    dmContainer.addSeparatorComponents(dmSeparator2);

                    // Футер
                    const dmFooter = new TextDisplayBuilder()
                        .setContent(`*Тикет был автоматически заархивирован системой.*`);
                    dmContainer.addTextDisplayComponents(dmFooter);

                    await customer.send({
                        flags: MessageFlags.IsComponentsV2,
                        components: [dmContainer]
                    });

                    console.log(`[ТИКЕТ] Уведомление отправлено пользователю ${customer.tag}`);
                } catch (dmError) {
                    console.error('Ошибка отправки ЛС:', dmError);
                }
            }

            // Сохраняем транскрипт
            await saveTranscript(channel, false);

            // Удаляем канал
            // Сохраняем закрытие тикета в базу данных
            closeTicket(channel.id, reason);
            console.log(`[БД] Тикет ${channel.name} отмечен как закрытый с причиной в базе данных`);
            
            await channel.delete(`Тикет закрыт: ${reason}`);

        } catch (error) {
            console.error('Ошибка обработки закрытия с причиной:', error);
        }
        return;
    }

    if (interaction.customId === 'ticket_form') {
        try {
            console.log(`[ФОРМА] Пользователь ${interaction.user.tag} отправил форму заказа`);
            
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const guild = interaction.guild;
            const user = interaction.user;
            const categoryId = '1463121412171759686';

            // Получаем данные из формы
            const topic = interaction.fields.getTextInputValue('topic');
            const description = interaction.fields.getTextInputValue('description');
            const budget = interaction.fields.getTextInputValue('budget');
            const deadline = interaction.fields.getTextInputValue('deadline');
            const requirements = interaction.fields.getTextInputValue('requirements') || 'Не указано';

            console.log(`[ФОРМА] Тема: ${topic}, Бюджет: ${budget}, Сроки: ${deadline}`);

            // Получаем категорию для тикетов
            const category = guild.channels.cache.get(categoryId);
            
            if (!category) {
                return await interaction.editReply({
                    content: '❌ Категория для тикетов не найдена!'
                });
            }

            // Находим все каналы тикетов пользователя
            const userTickets = guild.channels.cache.filter(
                channel => channel.name.startsWith(`${user.username.toLowerCase()}-`) && channel.parentId === categoryId
            );

            // Проверяем лимит тикетов
            if (userTickets.size >= 3) {
                return await interaction.editReply({
                    content: '❌ У вас уже открыто максимальное количество тикетов (3). Закройте один из существующих тикетов, чтобы создать новый.'
                });
            }

            // Создаём уникальное имя для канала с номером из базы данных
            const ticketNumber = getNextTicketNumber(user.id);
            const formattedNumber = ticketNumber.toString().padStart(3, '0');
            const channelName = `${user.username.toLowerCase()}-${formattedNumber}`;

            // Создаём приватный канал
            console.log(`[ТИКЕТ] Создаю канал с именем: ${channelName}, номер: ${ticketNumber}`);
            
            // Сохраняем данные тикета в JSON для последующего использования
            const ticketData = JSON.stringify({
                customerId: user.id,
                topic: topic,
                description: description,
                budget: budget,
                deadline: deadline,
                requirements: requirements,
                openTime: Math.floor(Date.now() / 1000)
            });
            
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: 0, // Текстовый канал
                parent: categoryId,
                topic: ticketData, // Сохраняем данные в topic
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel']
                    },
                    {
                        id: user.id,
                        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles']
                    }
                ]
            });

            console.log(`[ТИКЕТ] Канал ${ticketChannel.name} успешно создан! ID: ${ticketChannel.id}, Тип: ${ticketChannel.type}`);

            // Сохраняем тикет в базу данных
            addTicket(user.id, ticketNumber, ticketChannel.id, ticketChannel.name, {
                topic: topic,
                description: description,
                budget: budget,
                deadline: deadline,
                requirements: requirements
            });
            console.log(`[БД] Тикет ${channelName} сохранён в базу данных`);

            // Первый контейнер - информация о заказчике
            const container1 = new ContainerBuilder();

            // Добавляем аватарку заказчика
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128, format: 'png' });
            const gallery = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(avatarUrl)
            );
            container1.addMediaGalleryComponents(gallery);

            // Разделитель
            const separator1 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container1.addSeparatorComponents(separator1);

            // Заголовок с упоминанием роли
            const headerText = new TextDisplayBuilder()
                .setContent(
                    `## [<:image1:1462898121511014490>] <@&1462729072009412653>, поступил новый заказ от <@${user.id}>\n` +
                    `- **Данные заказчика:** ${user.username}, ${user.id}`
                );
            container1.addTextDisplayComponents(headerText);

            // Добавляем разделительную линию (изображение)
            const dividerGallery = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('https://images-ext-1.discordapp.net/external/bX-SiBhIqKQg18GjUdEqCZ5XiuL3Y1gbaxvtQYIBbAo/%3Fformat%3Dwebp%26quality%3Dlossless/https/images-ext-1.discordapp.net/external/4S2HiGT71peX9f0gCSExCIoqqLFC_ft5QLnNFFKB2Zc/%253Fformat%253Dwebp%2526quality%253Dlossless%2526width%253D1241%2526height%253D38/https/images-ext-1.discordapp.net/external/R18586EeJABrCAaCW2mZcVBj2pWz7XLexgi1RkpjN_E/%25253Fformat%25253Dwebp%252526quality%25253Dlossless%252526width%25253D1393%252526height%25253D43/https/images-ext-1.discordapp.net/external/XHxQo2vBEGWHpf3oNBV8kSLA2TxzMnwan6MH8XL25es/https/i.imgur.com/LYYfDwK.png?format=webp&quality=lossless&width=1867&height=58')
            );
            container1.addMediaGalleryComponents(dividerGallery);

            // Второй контейнер - детали заказа
            const container2 = new ContainerBuilder();

            // Тема заказа
            const topicText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Тема заказа:\n* ${topic}`);
            container2.addTextDisplayComponents(topicText);

            // Разделитель
            const separator2 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator2);

            // Описание
            const descText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Описание заказа:\n* ${description}`);
            container2.addTextDisplayComponents(descText);

            // Разделитель
            const separator3 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator3);

            // Пожелания к исполнителю
            const reqText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Пожелания к исполнителю:\n* ${requirements}`);
            container2.addTextDisplayComponents(reqText);

            // Разделитель
            const separator4 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator4);

            // Сроки
            const deadlineText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Сроки:\n* ${deadline}`);
            container2.addTextDisplayComponents(deadlineText);

            // Разделитель
            const separator5 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator5);

            // Бюджет
            const budgetText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Бюджет заказчика:\n* ${budget}`);
            container2.addTextDisplayComponents(budgetText);

            // Добавляем разделительную линию в конце второго контейнера
            const dividerGallery2 = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('https://images-ext-1.discordapp.net/external/bX-SiBhIqKQg18GjUdEqCZ5XiuL3Y1gbaxvtQYIBbAo/%3Fformat%3Dwebp%26quality%3Dlossless/https/images-ext-1.discordapp.net/external/4S2HiGT71peX9f0gCSExCIoqqLFC_ft5QLnNFFKB2Zc/%253Fformat%253Dwebp%2526quality%253Dlossless%2526width%253D1241%2526height%253D38/https/images-ext-1.discordapp.net/external/R18586EeJABrCAaCW2mZcVBj2pWz7XLexgi1RkpjN_E/%25253Fformat%25253Dwebp%252526quality%25253Dlossless%252526width%25253D1393%252526height%25253D43/https/images-ext-1.discordapp.net/external/XHxQo2vBEGWHpf3oNBV8kSLA2TxzMnwan6MH8XL25es/https/i.imgur.com/LYYfDwK.png?format=webp&quality=lossless&width=1867&height=58')
            );
            container2.addMediaGalleryComponents(dividerGallery2);

            // Добавляем разделитель перед кнопками
            const separator6 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(2);
            container2.addSeparatorComponents(separator6);

            // Добавляем текст управления
            const controlText = new TextDisplayBuilder()
                .setContent('**Управление тикетом:**');
            container2.addTextDisplayComponents(controlText);

            // Создаем кнопки управления
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket_simple')
                        .setLabel('Закрыть')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId('close_ticket_reason')
                        .setLabel('Закрыть с причиной')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('📝')
                );

            // Отправляем объединенное сообщение с кнопками и закрепляем его
            const ticketMessage = await ticketChannel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container1, container2, row]
            });

            // Закрепляем сообщение
            await ticketMessage.pin();

            await interaction.editReply({
                content: `✅ Тикет создан! <#${ticketChannel.id}>`
            });

        } catch (error) {
            console.error('Ошибка создания тикета:', error);
            await interaction.editReply({
                content: `❌ Ошибка создания тикета: ${error.message}`
            }).catch(() => {});
        }
        return;
    }

    // Обработка формы бустов
    if (interaction.customId === 'boost_form') {
        try {
            console.log(`[БУСТ-ФОРМА] Пользователь ${interaction.user.tag} отправил форму заказа бустов`);
            
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const guild = interaction.guild;
            const user = interaction.user;
            const categoryId = '1463121412171759686';

            // Получаем данные из формы
            const boostCount = interaction.fields.getTextInputValue('boost_count');
            const serverLink = interaction.fields.getTextInputValue('server_link');

            console.log(`[БУСТ-ФОРМА] Бустов: ${boostCount}, Ссылка: ${serverLink}`);

            // Получаем категорию для тикетов
            const category = guild.channels.cache.get(categoryId);
            
            if (!category) {
                return await interaction.editReply({
                    content: '❌ Категория для тикетов не найдена!'
                });
            }

            // Находим все каналы буст-тикетов пользователя
            const userBoostTickets = guild.channels.cache.filter(
                channel => channel.name.startsWith(`boost-${user.username.toLowerCase()}-`) && channel.parentId === categoryId
            );

            // Проверяем лимит открытых тикетов
            if (userBoostTickets.size >= 3) {
                return await interaction.editReply({
                    content: '❌ У вас уже открыто максимальное количество буст-тикетов (3). Закройте один из существующих тикетов, чтобы создать новый.'
                });
            }

            // Создаём уникальное имя для канала с номером из базы данных
            const ticketNumber = getNextTicketNumber(`boost_${user.id}`);
            const formattedNumber = ticketNumber.toString().padStart(3, '0');
            const channelName = `boost-${user.username.toLowerCase()}-${formattedNumber}`;

            // Создаём приватный канал
            console.log(`[БУСТ-ТИКЕТ] Создаю канал с именем: ${channelName}, номер: ${ticketNumber}`);
            
            // Сохраняем данные тикета в JSON для последующего использования
            const ticketData = JSON.stringify({
                customerId: user.id,
                type: 'boost',
                boostCount: boostCount,
                serverLink: serverLink,
                openTime: Math.floor(Date.now() / 1000)
            });
            
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: 0, // Текстовый канал
                parent: categoryId,
                topic: ticketData,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel']
                    },
                    {
                        id: user.id,
                        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles']
                    }
                ]
            });

            console.log(`[БУСТ-ТИКЕТ] Канал ${ticketChannel.name} успешно создан! ID: ${ticketChannel.id}`);

            // Сохраняем тикет в базу данных
            addTicket(`boost_${user.id}`, ticketNumber, ticketChannel.id, ticketChannel.name, {
                type: 'boost',
                boostCount: boostCount,
                serverLink: serverLink
            });
            console.log(`[БД] Буст-тикет ${channelName} сохранён в базу данных`);

            // Создаём V2 сообщение для буст-тикета - первый контейнер
            const container1 = new ContainerBuilder();

            // Добавляем аватарку заказчика
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128, format: 'png' });
            const gallery = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(avatarUrl)
            );
            container1.addMediaGalleryComponents(gallery);

            // Разделитель
            const separator1 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container1.addSeparatorComponents(separator1);

            // Заголовок с упоминанием роли
            const headerText = new TextDisplayBuilder()
                .setContent(
                    `## [<:image1:1462898121511014490>] <@&1462729072009412653>, поступил новый заказ от <@${user.id}>\n` +
                    `- **Данные заказчика:** ${user.username}, ${user.id}`
                );
            container1.addTextDisplayComponents(headerText);

            // Добавляем разделительную линию (изображение)
            const dividerGallery = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('https://images-ext-1.discordapp.net/external/bX-SiBhIqKQg18GjUdEqCZ5XiuL3Y1gbaxvtQYIBbAo/%3Fformat%3Dwebp%26quality%3Dlossless/https/images-ext-1.discordapp.net/external/4S2HiGT71peX9f0gCSExCIoqqLFC_ft5QLnNFFKB2Zc/%253Fformat%253Dwebp%2526quality%253Dlossless%2526width%253D1241%2526height%253D38/https/images-ext-1.discordapp.net/external/R18586EeJABrCAaCW2mZcVBj2pWz7XLexgi1RkpjN_E/%25253Fformat%25253Dwebp%252526quality%25253Dlossless%252526width%25253D1393%252526height%25253D43/https/images-ext-1.discordapp.net/external/XHxQo2vBEGWHpf3oNBV8kSLA2TxzMnwan6MH8XL25es/https/i.imgur.com/LYYfDwK.png?format=webp&quality=lossless&width=1867&height=58')
            );
            container1.addMediaGalleryComponents(dividerGallery);

            // Второй контейнер - детали заказа
            const container2 = new ContainerBuilder();

            // Тема заказа
            const topicText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Тема заказа:\n* Заказ бустов`);
            container2.addTextDisplayComponents(topicText);

            // Разделитель
            const separator2 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator2);

            // Количество бустов
            const boostCountText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Количество бустов:\n* ${boostCount}`);
            container2.addTextDisplayComponents(boostCountText);

            // Разделитель
            const separator3 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator3);

            // Ссылка на сервер
            const serverLinkText = new TextDisplayBuilder()
                .setContent(`### <:Frame6559:1463970472231178383> Ссылка на сервер:\n* ${serverLink}`);
            container2.addTextDisplayComponents(serverLinkText);

            // Разделитель
            const separator4 = new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(1);
            container2.addSeparatorComponents(separator4);

            // Добавляем разделительную линию в конце второго контейнера
            const dividerGallery2 = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('https://images-ext-1.discordapp.net/external/bX-SiBhIqKQg18GjUdEqCZ5XiuL3Y1gbaxvtQYIBbAo/%3Fformat%3Dwebp%26quality%3Dlossless/https/images-ext-1.discordapp.net/external/4S2HiGT71peX9f0gCSExCIoqqLFC_ft5QLnNFFKB2Zc/%253Fformat%253Dwebp%2526quality%253Dlossless%2526width%253D1241%2526height%253D38/https/images-ext-1.discordapp.net/external/R18586EeJABrCAaCW2mZcVBj2pWz7XLexgi1RkpjN_E/%25253Fformat%25253Dwebp%252526quality%25253Dlossless%252526width%25253D1393%252526height%25253D43/https/images-ext-1.discordapp.net/external/XHxQo2vBEGWHpf3oNBV8kSLA2TxzMnwan6MH8XL25es/https/i.imgur.com/LYYfDwK.png?format=webp&quality=lossless&width=1867&height=58')
            );
            container2.addMediaGalleryComponents(dividerGallery2);

            // Создаем кнопки управления
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_boost_simple')
                        .setLabel('Закрыть')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId('close_boost_reason')
                        .setLabel('Закрыть с причиной')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('📝')
                );

            // Отправляем объединенное сообщение с кнопками и закрепляем его
            const ticketMessage = await ticketChannel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container1, container2, row]
            });

            // Закрепляем сообщение
            await ticketMessage.pin();

            await interaction.editReply({
                content: `✅ Буст-тикет создан! <#${ticketChannel.id}>`
            });

        } catch (error) {
            console.error('Ошибка создания буст-тикета:', error);
            await interaction.editReply({
                content: `❌ Ошибка создания тикета: ${error.message}`
            }).catch(() => {});
        }
        return;
    }
    
    } // Закрываем if (interaction.isModalSubmit())
});

// Запуск веб-сервера
const { startWebServer, setDiscordClient } = require('./webserver.js');

// Запуск бота
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        // Передаем клиента в веб-сервер
        setDiscordClient(client);
        // Запускаем веб-сервер
        startWebServer();
    })
    .catch(error => {
        console.error('Ошибка входа:', error);
        process.exit(1);
    });

// Экспортируем функцию конвертации для веб-сервера
module.exports = { convertV2ToDiscord };
