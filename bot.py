import discord
from discord import app_commands
from discord.ext import commands
import os
from dotenv import load_dotenv

# Загружаем переменные окружения из .env
load_dotenv()

# Создаем бота с необходимыми интентами
intents = discord.Intents.default()
intents.message_content = False

bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    print(f'Бот {bot.user} запущен!')
    try:
        synced = await bot.tree.sync()
        print(f'Синхронизировано {len(synced)} команд')
    except Exception as e:
        print(f'Ошибка синхронизации: {e}')

@bot.tree.command(name='sosal', description='Отправить приветствие')
async def sosal(interaction: discord.Interaction):
    await interaction.response.send_message('привет')

# Запуск бота
if __name__ == '__main__':
    TOKEN = os.getenv('DISCORD_TOKEN')
    if not TOKEN:
        print('Ошибка: DISCORD_TOKEN не установлен!')
        print('Создайте файл .env и добавьте: DISCORD_TOKEN=ваш_токен')
    else:
        bot.run(TOKEN)
