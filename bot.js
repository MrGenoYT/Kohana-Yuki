require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ChannelType } = require('discord.js');
const { MongoClient } = require('mongodb');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { handleInteraction } = require('./lib/interactions');
const { handleMessage } = require('./lib/ai');
const { defaultSettings } = require('./lib/database');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: ['Channel'],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

const app = express();
const port = process.env.PORT || 10000;
app.get('/', (req, res) => {
    res.send('Kohana Yuki is listening. uwu');
});
app.listen(port, () => {
    console.log(`Express server is running on port ${port}`);
});

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);

    for (const guild of client.guilds.cache.values()) {
        const serverData = await client.db.collection('servers').findOne({ guildId: guild.id });
        if (!serverData) {
            await client.db.collection('servers').insertOne({
                guildId: guild.id,
                ...defaultSettings
            });
        }
    }
});

client.on('guildCreate', async (guild) => {
    const serverData = await client.db.collection('servers').findOne({ guildId: guild.id });
    if (!serverData) {
        await client.db.collection('servers').insertOne({
            guildId: guild.id,
            ...defaultSettings
        });
        console.log(`Joined new guild: ${guild.name}. Initialized default settings.`);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }
            await command.execute(interaction, client);
        } else {
            await handleInteraction(interaction, client);
        }
    } catch (error) {
        console.error('Interaction error:', error);
        const errorMessage = 'There was an error while executing this command, babe! 🥺';
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    await handleMessage(message, client);
});

async function start() {
    try {
        const mongoClient = new MongoClient(process.env.MONGO_URI);
        await mongoClient.connect();
        client.db = mongoClient.db(process.env.MONGO_DB_NAME || 'kohana_yuki');
        console.log('Connected to MongoDB!');

        await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('Failed to start the bot:', error);
    }
}

start();

