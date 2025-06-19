require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ChannelType, Partials } = require('discord.js');
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
    partials: [Partials.Channel, Partials.Message], // Ensure partials for DMs and uncached messages
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
    res.send('Kohana Yuki is online! 💖');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

client.on('interactionCreate', async interaction => {
    // If it's a slash command
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction); // Pass only interaction, client is accessible via interaction.client
        } catch (error) {
            console.error('Command execution error:', error);
            const errorMessage = 'There was an error while executing this command, babe! 🥺';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
            }
        }
    } else {
        // Handle other interactions like button clicks, select menus, modals
        try {
            await handleInteraction(interaction, client);
        } catch (error) {
            console.error('Interaction error:', error);
            const errorMessage = 'There was an error while processing your request, babe! 🥺';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
            }
        }
    }
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Handle DM messages directly
    if (message.channel.type === ChannelType.DM) {
        await handleMessage(message, client);
    } else if (message.guild) {
        // For guild messages, check if it's a command first (if you have prefix commands)
        // For now, assuming only slash commands, so process all non-command messages
        if (!message.content.startsWith('/')) { // Only process if not a slash command start
             await handleMessage(message, client);
        }
    }
});

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('with your heart 💖'); // Set bot's activity
});

async function start() {
    try {
        const mongoClient = new MongoClient(process.env.MONGO_URI);
        await mongoClient.connect();
        client.db = mongoClient.db(process.env.MONGO_DB_NAME || 'kohana_yuki');
        console.log('Connected to MongoDB!');

        await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1); // Exit process if bot fails to start
    }
}

start();


