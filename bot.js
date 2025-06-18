const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class KohanaYuki {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages
            ]
        });

        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.mongo = new MongoClient(process.env.MONGO_URI);
        this.db = null;
        
        // Express server setup
        this.app = express();
        this.port = process.env.PORT || 3000;
        
        this.defaultSettings = {
            name: 'Kohana Yuki',
            age: 15,
            gender: 'female',
            mood: 'happy, playful',
            behavior: 'A 15-year-old girl from Tokyo who loves watching anime and playing games. Responds naturally and humanlike.',
            personality: '',
            imageGeneration: false,
            webSearch: false,
            allowedChannels: [],
            memory: {}
        };

        this.init();
    }

    async init() {
        await this.connectMongo();
        this.setupExpressServer();
        this.setupEvents();
        await this.client.login(process.env.DISCORD_TOKEN);
    }

    setupExpressServer() {
        // Basic middleware
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Health check endpoint
        this.app.get('/', (req, res) => {
            res.json({
                status: 'online',
                bot: this.client.user ? this.client.user.tag : 'Not ready',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });

        // Bot status endpoint
        this.app.get('/status', (req, res) => {
            res.json({
                botReady: this.client.isReady(),
                guilds: this.client.guilds.cache.size,
                users: this.client.users.cache.size,
                channels: this.client.channels.cache.size,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage()
            });
        });

        // Bot statistics endpoint
        this.app.get('/stats', async (req, res) => {
            try {
                const serverCount = await this.db.collection('servers').countDocuments();
                const userCount = await this.db.collection('users').countDocuments();
                
                res.json({
                    servers: serverCount,
                    users: userCount,
                    guilds: this.client.guilds.cache.size,
                    channels: this.client.channels.cache.size,
                    uptime: process.uptime(),
                    version: require('./package.json').version
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch stats' });
            }
        });

        // Webhook endpoint (for future use)
        this.app.post('/webhook', (req, res) => {
            // You can add webhook handling here if needed
            res.json({ received: true });
        });

        // Start the server
        this.app.listen(this.port, () => {
            console.log(`Express server is running on port ${this.port}`);
        });
    }

    async connectMongo() {
        await this.mongo.connect();
        this.db = this.mongo.db('kohana_yuki');
    }

    setupEvents() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user.tag} is online!`);
            
            const guilds = this.client.guilds.cache;
            for (const [guildId, guild] of guilds) {
                await this.ensureServerSetup(guildId);
                await this.createBotRole(guild);
            }
        });

        this.client.on('guildCreate', async (guild) => {
            await this.ensureServerSetup(guild.id);
            await this.createBotRole(guild);
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isCommand()) {
                await this.handleSlashCommand(interaction);
            } else if (interaction.isStringSelectMenu() || interaction.isButton()) {
                await this.handleSettingsInteraction(interaction);
            }
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            await this.handleMessage(message);
        });
    }

    async ensureServerSetup(guildId) {
        const serverData = await this.db.collection('servers').findOne({ guildId });
        if (!serverData) {
            await this.db.collection('servers').insertOne({
                guildId,
                ...this.defaultSettings
            });
        }
    }

    async createBotRole(guild) {
        const settings = await this.getServerSettings(guild.id);
        const roleName = settings.name;
        
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            try {
                role = await guild.roles.create({
                    name: roleName,
                    color: 0xFF0000,
                    reason: 'Bot role creation'
                });
            } catch (error) {
                console.error('Failed to create role:', error);
            }
        }

        if (role) {
            const botMember = guild.members.cache.get(this.client.user.id);
            if (botMember && !botMember.roles.cache.has(role.id)) {
                try {
                    await botMember.roles.add(role);
                } catch (error) {
                    console.error('Failed to assign role:', error);
                }
            }
        }
    }

    async getServerSettings(guildId) {
        const settings = await this.db.collection('servers').findOne({ guildId });
        return settings || this.defaultSettings;
    }

    async updateServerSettings(guildId, updates) {
        await this.db.collection('servers').updateOne(
            { guildId },
            { $set: updates },
            { upsert: true }
        );
    }

    async getUserData(userId) {
        const userData = await this.db.collection('users').findOne({ userId });
        return userData || { userId, mood: 'neutral', customInstructions: '' };
    }

    async updateUserData(userId, updates) {
        await this.db.collection('users').updateOne(
            { userId },
            { $set: updates },
            { upsert: true }
        );
    }

    async handleSlashCommand(interaction) {
        if (interaction.commandName === 'settings') {
            if (interaction.guild) {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: 'You need administrator permissions to use this command.', ephemeral: true });
                }
                await this.showServerSettings(interaction);
            } else {
                await this.showUserSettings(interaction);
            }
        }
    }

    async showServerSettings(interaction) {
        const settings = await this.getServerSettings(interaction.guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('Server Settings')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Name', value: settings.name, inline: true },
                { name: 'Age', value: settings.age.toString(), inline: true },
                { name: 'Gender', value: settings.gender, inline: true },
                { name: 'Mood', value: settings.mood, inline: false },
                { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Web Search', value: settings.webSearch ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Allowed Channels', value: settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels', inline: false }
            );

        if (settings.imageGeneration) {
            embed.addFields({ name: 'Image Generation Command', value: `hi ${settings.name} can you draw a [description] for me?`, inline: false });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_menu')
                    .setPlaceholder('Select a setting to modify')
                    .addOptions([
                        { label: 'Identity Settings', value: 'identity', description: 'Change name, age, gender, mood' },
                        { label: 'Behavior & Personality', value: 'behavior', description: 'Customize behavior and personality' },
                        { label: 'Features', value: 'features', description: 'Toggle image generation and web search' },
                        { label: 'Channels', value: 'channels', description: 'Set allowed channels' },
                        { label: 'Clear All', value: 'clear', description: 'Reset all settings to default' }
                    ])
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    async showUserSettings(interaction) {
        const userData = await this.getUserData(interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Personal Settings')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Your Mood', value: userData.mood || 'neutral', inline: true },
                { name: 'Custom Instructions', value: userData.customInstructions || 'None', inline: false }
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('user_settings_menu')
                    .setPlaceholder('Select a setting to modify')
                    .addOptions([
                        { label: 'Change Mood', value: 'user_mood', description: 'Set your current mood' },
                        { label: 'Custom Instructions', value: 'user_instructions', description: 'Add personal instructions' }
                    ])
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    async handleMessage(message) {
        const isGuild = message.guild !== null;
        let settings;
        
        if (isGuild) {
            settings = await this.getServerSettings(message.guildId);
            
            if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
                return;
            }
        } else {
            settings = this.defaultSettings;
        }

        const botMention = message.mentions.has(this.client.user.id);
        const isReply = message.reference && message.reference.messageId;
        const containsBotName = message.content.toLowerCase().includes(settings.name.toLowerCase());
        
        const imageGenPattern = new RegExp(`hi ${settings.name.toLowerCase()}.*can you draw.*for me`, 'i');
        const isImageGenRequest = imageGenPattern.test(message.content.toLowerCase()) && settings.imageGeneration;

        if (isImageGenRequest) {
            await this.handleImageGeneration(message, settings);
            return;
        }

        const shouldReply = await this.shouldReplyToMessage(message.content, settings);
        
        if (!shouldReply && !botMention && !isReply && !containsBotName) {
            return;
        }

        if (botMention || isReply || containsBotName) {
            if (Math.random() > 0.5) return;
        }

        await this.generateReply(message, settings);
    }

    async shouldReplyToMessage(content, settings) {
        try {
            const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const prompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender} from Tokyo. Your current mood is: ${settings.mood}. 

${settings.behavior}
${settings.personality}

Decide if this message requires a reply from you. Consider:
- Is it a direct question or statement to you?
- Does it need a response to maintain natural conversation flow?
- Is it just casual chatter that doesn't need a response?

Message: "${content}"

Respond with only one word: YES or NO.`;

            const result = await model.generateContent(prompt);
            const response = result.response.text().trim().toUpperCase();
            return response === 'YES';
        } catch (error) {
            console.error('Error checking if should reply:', error);
            return false;
        }
    }

    async generateReply(message, settings) {
        const isGuild = message.guild !== null;
        let userData = null;
        
        if (!isGuild) {
            userData = await this.getUserData(message.author.id);
        }

        const channel = message.channel;
        await channel.sendTyping();

        try {
            const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            let systemPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender} from Tokyo. Your current mood is: ${settings.mood}.

${settings.behavior}
${settings.personality}

You are chatting with ${message.author.username}. Respond naturally and humanlike. Keep responses conversational and not too long. You occasionally use Tenor GIFs to express yourself.`;

            if (userData && userData.customInstructions) {
                systemPrompt += `\n\nPersonal context for ${message.author.username}: ${userData.customInstructions}`;
                if (userData.mood) {
                    systemPrompt += `\nTheir current mood: ${userData.mood}`;
                }
            }

            const result = await model.generateContent(`${systemPrompt}\n\nMessage: "${message.content}"`);
            const response = result.response.text();

            await message.reply(response);

            if (Math.random() < 0.3) {
                await this.sendRandomGif(channel);
            }

        } catch (error) {
            console.error('Error generating reply:', error);
        }
    }

    async handleImageGeneration(message, settings) {
        const channel = message.channel;
        await channel.sendTyping();

        try {
            const prompt = message.content.replace(new RegExp(`hi ${settings.name}.*can you draw (.*) for me`, 'i'), '$1');
            
            const model = this.genAI.getGenerativeModel({ 
                model: 'gemini-2.0-flash-preview-image-generation',
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE']
                }
            });

            const result = await model.generateContent(`Generate an image of: ${prompt}`);
            
            if (result.response.candidates[0].content.parts.length > 1) {
                const imagePart = result.response.candidates[0].content.parts.find(part => part.inlineData);
                if (imagePart) {
                    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
                    await message.reply({
                        content: `Here's your image of ${prompt}!`,
                        files: [{
                            attachment: imageBuffer,
                            name: 'generated_image.png'
                        }]
                    });
                }
            } else {
                await message.reply('Sorry, I had trouble generating that image. Could you try describing it differently?');
            }

        } catch (error) {
            console.error('Error generating image:', error);
            await message.reply('Sorry, I encountered an error while generating the image.');
        }
    }

    async sendRandomGif(channel) {
        try {
            const response = await fetch(`https://api.tenor.com/v1/random?key=${process.env.TENOR_API_KEY}&limit=1&contentfilter=medium`);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                await channel.send(data.results[0].url);
            }
        } catch (error) {
            console.error('Error sending GIF:', error);
        }
    }

    async handleSettingsInteraction(interaction) {
        if (interaction.isStringSelectMenu()) {
            const value = interaction.values[0];
            
            if (value === 'clear') {
                await this.updateServerSettings(interaction.guildId, this.defaultSettings);
                await interaction.reply({ content: 'All settings have been reset to default.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            
            switch (value) {
                case 'identity':
                    await this.showIdentitySettings(interaction);
                    break;
                case 'behavior':
                    await this.showBehaviorSettings(interaction);
                    break;
                case 'features':
                    await this.showFeatureSettings(interaction);
                    break;
                case 'channels':
                    await this.showChannelSettings(interaction);
                    break;
                case 'user_mood':
                    await this.showUserMoodSettings(interaction);
                    break;
                case 'user_instructions':
                    await this.showUserInstructionSettings(interaction);
                    break;
            }
        }
    }

    async showIdentitySettings(interaction) {
        const settings = await this.getServerSettings(interaction.guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('Identity Settings')
            .setColor(0xFF0000)
            .setDescription('Current identity configuration')
            .addFields(
                { name: 'Name', value: settings.name, inline: true },
                { name: 'Age', value: settings.age.toString(), inline: true },
                { name: 'Gender', value: settings.gender, inline: true },
                { name: 'Mood', value: settings.mood, inline: false }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    async showBehaviorSettings(interaction) {
        const settings = await this.getServerSettings(interaction.guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('Behavior & Personality Settings')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Behavior Instructions', value: settings.behavior || 'Default behavior', inline: false },
                { name: 'Custom Personality', value: settings.personality || 'No custom personality set', inline: false }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    async showFeatureSettings(interaction) {
        const settings = await this.getServerSettings(interaction.guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('Feature Settings')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Web Search', value: settings.webSearch ? 'Enabled' : 'Disabled', inline: true }
            );

        if (settings.imageGeneration) {
            embed.addFields({ name: 'Command Format', value: `hi ${settings.name} can you draw a [description] for me?`, inline: false });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_image_gen')
                    .setLabel(settings.imageGeneration ? 'Disable Image Generation' : 'Enable Image Generation')
                    .setStyle(settings.imageGeneration ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('toggle_web_search')
                    .setLabel(settings.webSearch ? 'Disable Web Search' : 'Enable Web Search')
                    .setStyle(settings.webSearch ? ButtonStyle.Danger : ButtonStyle.Success)
            );

        await interaction.editReply({ embeds: [embed], components: [row] });
    }

    async showChannelSettings(interaction) {
        const settings = await this.getServerSettings(interaction.guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('Channel Settings')
            .setColor(0xFF0000)
            .addFields({
                name: 'Allowed Channels',
                value: settings.allowedChannels.length > 0 
                    ? settings.allowedChannels.map(id => `<#${id}>`).join(', ')
                    : 'All channels allowed',
                inline: false
            });

        await interaction.editReply({ embeds: [embed] });
    }

    async showUserMoodSettings(interaction) {
        const userData = await this.getUserData(interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Your Mood Settings')
            .setColor(0xFF0000)
            .addFields({
                name: 'Current Mood',
                value: userData.mood || 'neutral',
                inline: false
            });

        await interaction.editReply({ embeds: [embed] });
    }

    async showUserInstructionSettings(interaction) {
        const userData = await this.getUserData(interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Your Custom Instructions')
            .setColor(0xFF0000)
            .addFields({
                name: 'Current Instructions',
                value: userData.customInstructions || 'None set',
                inline: false
            });

        await interaction.editReply({ embeds: [embed] });
    }
}

new KohanaYuki();