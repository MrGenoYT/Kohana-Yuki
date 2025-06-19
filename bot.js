const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
    this.imageGenRequests = new Map();

    this.app = express();
    this.port = process.env.PORT || 3000;

    this.defaultSettings = {
        name: 'Kohana Yuki',
        age: 16,
        gender: 'female',
        mood: 'cute, warm, flirty, a bit shy, uwu expressions = excitement',
        behavior: 'A 16-year-old girl who is still in school. She barely has any friends except the user, who is her boyfriend. She adores anime and loves spending time with friends. She enjoys watching TikTok videos and playing Roblox. Luna is a sweet and flirty teenager who gets a bit shy around her crushes but still tries to show her interest. From a simple "hi," she starts to act as if the user is her boyfriend. She calls the user with words like "babe" to show deep love. She uses a lot of heart emojis to show deep love. She ALWAYS flirts and rizzes.',
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
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.get('/', (req, res) => {
        res.json({
            status: 'online',
            bot: this.client.user ? this.client.user.tag : 'Not ready',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

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

    this.app.post('/webhook', (req, res) => {
        res.json({ received: true });
    });

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
        await this.registerSlashCommands();
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
        } else if (interaction.isModalSubmit()) {
            await this.handleModalSubmission(interaction);
        }
    });

    this.client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        await this.handleMessage(message);
    });
}

async registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('yukisettings')
            .setDescription('Configure bot settings (Admin only in servers, personal settings in DMs)')
            .toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
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
    return userData || { userId, mood: 'neutral', customInstructions: '', chatHistory: [], lastMessageTimestamp: 0 };
}

async updateUserData(userId, updates) {
    await this.db.collection('users').updateOne(
        { userId },
        { $set: updates },
        { upsert: true }
    );
}

async addMessageToMemory(userId, role, content) {
    const userData = await this.getUserData(userId);
    if (!userData.chatHistory) {
        userData.chatHistory = [];
    }
    userData.chatHistory.push({ role, parts: [{ text: content }] });
    await this.updateUserData(userId, { chatHistory: userData.chatHistory, lastMessageTimestamp: Date.now() });
}

async handleSlashCommand(interaction) {
    if (interaction.commandName === 'yukisettings') {
        await interaction.deferReply({ ephemeral: true }); 

        if (interaction.guild) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.editReply({ content: 'You need administrator permissions to use this command, babe! 🥺' });
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
        .setTitle('Server Settings for Kohana Yuki')
        .setColor(0xFF0000)
        .addFields(
            { name: 'Name', value: settings.name, inline: true },
            { name: 'Age', value: settings.age.toString(), inline: true },
            { name: 'Gender', value: settings.gender, inline: true },
            { name: 'Mood', value: settings.mood, inline: false },
            { name: 'Behavior', value: settings.behavior, inline: false },
            { name: 'Personality', value: settings.personality || 'None set', inline: false },
            { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Web Search', value: settings.webSearch ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Allowed Channels', value: settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels allowed', inline: false }
        );

    const row = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('server_settings_menu')
                .setPlaceholder('Select a setting to modify')
                .addOptions([
                    { label: 'Edit Core Settings (Identity, Mood, Behavior, Personality)', value: 'edit_core_settings', description: 'Change her name, age, gender, mood, behavior, and personality.' },
                    { label: 'Toggle Features (Image Gen, Web Search)', value: 'toggle_features', description: 'Enable or disable advanced capabilities.' },
                    { label: 'Manage Allowed Channels', value: 'manage_channels', description: 'Control where she can talk.' },
                    { label: 'Reset All Settings', value: 'reset_all_server_settings', description: 'Restore all server settings to default.' }
                ])
        );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async showUserSettings(interaction) {
    const userData = await this.getUserData(interaction.user.id);

    const embed = new EmbedBuilder()
        .setTitle('Your Personal Settings with Kohana Yuki')
        .setColor(0xFF0000)
        .addFields(
            { name: 'Your Mood', value: userData.mood || 'neutral', inline: false },
            { name: 'Your Custom Instructions', value: userData.customInstructions || 'None set', inline: false }
        );

    const row = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('user_settings_menu')
                .setPlaceholder('Select a personal setting to modify')
                .addOptions([
                    { label: 'Edit Your Mood', value: 'edit_user_mood', description: 'Set your mood for Kohana Yuki to react to.' },
                    { label: 'Edit Your Custom Instructions', value: 'edit_user_instructions', description: 'Add specific instructions for her interaction with you.' },
                    { label: 'Clear Your Custom Instructions', value: 'clear_user_instructions', description: 'Remove your personal instructions and mood.' }
                ])
        );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async handleSettingsInteraction(interaction) {
    await interaction.deferUpdate(); 

    if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0];

        switch (value) {
            case 'edit_core_settings':
                await this.showEditCoreSettingsModal(interaction);
                break;
            case 'toggle_features':
                await this.showFeatureToggleButtons(interaction);
                break;
            case 'manage_channels':
                await this.showChannelManagementOptions(interaction);
                break;
            case 'reset_all_server_settings':
                await this.resetAllServerSettings(interaction);
                break;
            case 'edit_user_mood':
                await this.showEditModal(interaction, 'mood', 'Edit Your Mood', 'Enter your mood for Kohana Yuki', 'user');
                break;
            case 'edit_user_instructions':
                await this.showEditModal(interaction, 'customInstructions', 'Edit Your Custom Instructions', 'Enter your custom instructions', 'user', true);
                break;
            case 'clear_user_instructions':
                await this.clearUserInstructions(interaction);
                break;
        }
    } else if (interaction.isButton()) {
        const [action, ...args] = interaction.customId.split('_');

        switch (action) {
            case 'toggle':
                await this.toggleFeature(interaction, args[0]);
                break;
            case 'addchannel':
                await this.showSelectChannelsMenu(interaction, 'add');
                break;
            case 'removechannel':
                await this.showSelectChannelsMenu(interaction, 'remove');
                break;
            case 'confirmimagegen':
                if (args[0] === 'yes') {
                    const requestId = args[1];
                    const request = this.imageGenRequests.get(requestId);
                    if (request) {
                        await interaction.editReply({ content: 'Generating your image, babe! uwu ✨', components: [] });
                        await this.handleImageGeneration(request.message, request.settings, request.prompt);
                        this.imageGenRequests.delete(requestId);
                    } else {
                       await interaction.editReply({ content: 'Oopsie! I could not find that image request, babe! 🥺', components: [] });
                    }
                } else {
                    await interaction.editReply({ content: 'Okay, no image for now, babe. Let me know if you change your mind! 💖', components: [] });
                    this.imageGenRequests.delete(args[1]);
                }
                break;
        }
    }
}

async showEditModal(interaction, field, title, placeholder, type, paragraph = false) {
    const modal = new ModalBuilder()
        .setCustomId(`${type}_edit_modal_${field}`)
        .setTitle(title);

    const currentValue = type === 'server'
        ? (await this.getServerSettings(interaction.guildId))[field]
        : (await this.getUserData(interaction.user.id))[field];

    const textInput = new TextInputBuilder()
        .setCustomId(field)
        .setLabel(placeholder)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setValue(currentValue ? String(currentValue) : '')
        .setRequired(false);

    const actionRow = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);

    await interaction.followup.sendModal(modal);
}

async showEditCoreSettingsModal(interaction) {
   const settings = await this.getServerSettings(interaction.guildId);

   const modal = new ModalBuilder()
       .setCustomId('server_edit_modal_core')
       .setTitle('Edit Core Settings');

   const nameInput = new TextInputBuilder()
       .setCustomId('name')
       .setLabel('Kohana Yuki\'s Name')
       .setStyle(TextInputStyle.Short)
       .setPlaceholder('Enter new name')
       .setValue(settings.name)
       .setRequired(true);

   const ageInput = new TextInputBuilder()
       .setCustomId('age')
       .setLabel('Kohana Yuki\'s Age')
       .setStyle(TextInputStyle.Short)
       .setPlaceholder('Enter new age (number)')
       .setValue(String(settings.age))
       .setRequired(true);

   const genderInput = new TextInputBuilder()
       .setCustomId('gender')
       .setLabel('Kohana Yuki\'s Gender')
       .setStyle(TextInputStyle.Short)
       .setPlaceholder('Enter new gender')
       .setValue(settings.gender)
       .setRequired(true);

   const moodInput = new TextInputBuilder()
       .setCustomId('mood')
       .setLabel('Kohana Yuki\'s Mood')
       .setStyle(TextInputStyle.Short)
       .setPlaceholder('Enter new mood (e.g., cute, flirty)')
       .setValue(settings.mood)
       .setRequired(false);

   const behaviorInput = new TextInputBuilder()
       .setCustomId('behavior')
       .setLabel('Kohana Yuki\'s Behavior')
       .setStyle(TextInputStyle.Paragraph)
       .setPlaceholder('Describe her general conduct and actions')
       .setValue(settings.behavior)
       .setRequired(false);

   const personalityInput = new TextInputBuilder()
       .setCustomId('personality')
       .setLabel('Kohana Yuki\'s Personality')
       .setStyle(TextInputStyle.Paragraph)
       .setPlaceholder('Describe her overall character traits')
       .setValue(settings.personality)
       .setRequired(false);

   modal.addComponents(
       new ActionRowBuilder().addComponents(nameInput),
       new ActionRowBuilder().addComponents(ageInput),
       new ActionRowBuilder().addComponents(genderInput),
       new ActionRowBuilder().addComponents(moodInput),
       new ActionRowBuilder().addComponents(behaviorInput),
       new ActionRowBuilder().addComponents(personalityInput)
   );

   await interaction.followup.sendModal(modal);
}

async showFeatureToggleButtons(interaction) {
    const settings = await this.getServerSettings(interaction.guildId);

    const embed = new EmbedBuilder()
        .setTitle('Feature Toggles')
        .setColor(0xFF0000)
        .setDescription('Manage Image Generation and Web Search features.');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`toggle_imageGeneration`)
                .setLabel(settings.imageGeneration ? 'Disable Image Generation' : 'Enable Image Generation')
                .setStyle(settings.imageGeneration ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`toggle_webSearch`)
                .setLabel(settings.webSearch ? 'Disable Web Search' : 'Enable Web Search')
                .setStyle(settings.webSearch ? ButtonStyle.Danger : ButtonStyle.Success)
        );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async toggleFeature(interaction, feature) {
    const settings = await this.getServerSettings(interaction.guildId);
    const newValue = !settings[feature];
    const updates = {};
    updates[feature] = newValue;
    await this.updateServerSettings(interaction.guildId, updates);

    const status = newValue ? 'Enabled' : 'Disabled';
    await interaction.followup.send({ content: `${feature === 'imageGeneration' ? 'Image Generation' : 'Web Search'} has been ${status}, babe! uwu! ✨`, ephemeral: true });
    await this.showServerSettings(interaction);
}

async showChannelManagementOptions(interaction) {
    const settings = await this.getServerSettings(interaction.guildId);
    const currentChannels = settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels allowed';

    const embed = new EmbedBuilder()
        .setTitle('Manage Allowed Channels')
        .setColor(0xFF0000)
        .setDescription(`Current Allowed Channels: ${currentChannels}`);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('addchannel')
                .setLabel('Add Channel')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('removechannel')
                .setLabel('Remove Channel')
                .setStyle(ButtonStyle.Danger)
        );
    await interaction.editReply({ embeds: [embed], components: [row] });
}

async showSelectChannelsMenu(interaction, actionType) {
   const guild = interaction.guild;
   if (!guild) {
       await interaction.followup.send({ content: 'This command can only be used in a server, babe!', ephemeral: true });
       return;
   }

   const channels = guild.channels.cache
       .filter(channel => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
       .sort((a, b) => a.position - b.position);

   const settings = await this.getServerSettings(guild.id);
   const allowedChannels = new Set(settings.allowedChannels);

   let options = [];
   if (actionType === 'add') {
       options = channels
           .filter(channel => !allowedChannels.has(channel.id))
           .map(channel => ({
               label: channel.name,
               value: channel.id,
               description: `Add #${channel.name}`
           }));
   } else if (actionType === 'remove') {
       options = channels
           .filter(channel => allowedChannels.has(channel.id))
           .map(channel => ({
               label: channel.name,
               value: channel.id,
               description: `Remove #${channel.name}`
           }));
   }

   if (options.length === 0) {
       await interaction.followup.send({ content: `There are no channels to ${actionType}, babe!`, ephemeral: true });
       return;
   }

   const customId = actionType === 'add' ? 'select_channels_add' : 'select_channels_remove';
   const placeholder = actionType === 'add' ? 'Select channels to add' : 'Select channels to remove';
   const title = actionType === 'add' ? 'Add Allowed Channels' : 'Remove Allowed Channels';

   const selectMenu = new StringSelectMenuBuilder()
       .setCustomId(customId)
       .setPlaceholder(placeholder)
       .setMinValues(1)
       .setMaxValues(options.length > 25 ? 25 : options.length) 
       .addOptions(options.slice(0, 25)); 

   const row = new ActionRowBuilder().addComponents(selectMenu);

   await interaction.followup.send({
       content: `Choose channels to ${actionType}:`,
       components: [row],
       ephemeral: true
   });
}


async handleModalSubmission(interaction) {
    await interaction.deferUpdate(); 
    const customId = interaction.customId;

    if (customId === 'server_edit_modal_core') {
       const updates = {
           name: interaction.fields.getTextInputValue('name'),
           age: parseInt(interaction.fields.getTextInputValue('age')),
           gender: interaction.fields.getTextInputValue('gender'),
           mood: interaction.fields.getTextInputValue('mood'),
           behavior: interaction.fields.getTextInputValue('behavior'),
           personality: interaction.fields.getTextInputValue('personality')
       };
       if (isNaN(updates.age)) {
           await interaction.followup.send({ content: 'Age must be a number, babe! uwu', ephemeral: true });
           return;
       }
       await this.updateServerSettings(interaction.guildId, updates);
       await interaction.followup.send({ content: 'Core settings updated, babe! ✨', ephemeral: true });
       await this.showServerSettings(interaction);
   } else if (customId.startsWith('user_edit_modal_')) {
        const field = customId.split('_')[3];
        const updates = {};
        updates[field] = interaction.fields.getTextInputValue(field);
        await this.updateUserData(interaction.user.id, updates);
        await interaction.followup.send({ content: `Your personal ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} updated, babe! 💖`, ephemeral: true });
        await this.showUserSettings(interaction);
    } else if (customId === 'select_channels_add' || customId === 'select_channels_remove') {
       const selectedChannelIds = interaction.values;
       const settings = await this.getServerSettings(interaction.guildId);
       let currentAllowedChannels = new Set(settings.allowedChannels);
       let feedbackMessage = '';

       if (customId === 'select_channels_add') {
           selectedChannelIds.forEach(channelId => {
               if (!currentAllowedChannels.has(channelId)) {
                   currentAllowedChannels.add(channelId);
                   feedbackMessage += `Channel <#${channelId}> added. `;
               }
           });
       } else { 
           selectedChannelIds.forEach(channelId => {
               if (currentAllowedChannels.has(channelId)) {
                   currentAllowedChannels.delete(channelId);
                   feedbackMessage += `Channel <#${channelId}> removed. `;
               }
           });
       }
       
       await this.updateServerSettings(interaction.guildId, { allowedChannels: Array.from(currentAllowedChannels) });
       await interaction.followup.send({ content: `${feedbackMessage.trim() || 'No changes made.'} uwu`, ephemeral: true });
       await this.showChannelManagementOptions(interaction);
   }
}

async resetAllServerSettings(interaction) {
    await this.updateServerSettings(interaction.guildId, this.defaultSettings);
    await interaction.followup.send({ content: 'All server settings have been reset to default, babe! Fresh start! ✨', ephemeral: true });
    await this.showServerSettings(interaction);
}

async clearUserInstructions(interaction) {
    await this.updateUserData(interaction.user.id, { customInstructions: '', mood: 'neutral' });
    await interaction.followup.send({ content: 'Your custom instructions and mood have been cleared, babe! All clear! 💖', ephemeral: true });
    await this.showUserSettings(interaction);
}

async handleMessage(message) {
    const isGuild = message.guild !== null;
    let settings;
    let userData = await this.getUserData(message.author.id);

    if (isGuild) {
        settings = await this.getServerSettings(message.guildId);
        if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
            return;
        }
    } else {
        settings = this.defaultSettings;
    }

    const imageGenMatch = message.content.toLowerCase().match(/(?:can you draw|please draw|generate an image of|draw me)\s+(.+)/i);
    const isImageGenRequest = imageGenMatch && settings.imageGeneration;
    const imageGenPrompt = isImageGenRequest ? imageGenMatch[1] : null;

    if (isImageGenRequest) {
        const requestId = `${message.author.id}-${Date.now()}`;
        this.imageGenRequests.set(requestId, { message, settings, prompt: imageGenPrompt });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirmimagegen_yes_${requestId}`)
                    .setLabel('Yes, draw it! ✨')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`confirmimagegen_no_${requestId}`)
                    .setLabel('No, not now 🥺')
                    .setStyle(ButtonStyle.Danger)
            );

        await message.reply({ content: `Kyaa! Babe, are you sure you want me to draw "${imageGenPrompt}" for you? uwu`, components: [row] });
        return;
    }
    
    await this.addMessageToMemory(message.author.id, 'user', message.content);

    const shouldReply = await this.determineIfShouldReply(message, settings, userData);
    
    if (!shouldReply) {
        return;
    }

    await this.generateReply(message, settings, userData);
}

async determineIfShouldReply(message, settings, userData) {
    const botMention = message.mentions.has(this.client.user.id);
    const isReplyToSomeone = message.reference && message.reference.messageId; 
    const containsBotName = message.content.toLowerCase().includes(settings.name.toLowerCase());

    if (botMention || isReplyToSomeone || containsBotName) {
        return true;
    }

    try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const prompt = `You are ${settings.name}. Your mood is: ${settings.mood}.
${settings.behavior}
${settings.personality}
You are chatting with ${message.author.username}.
Decide if this message absolutely requires a direct, conversational reply from you. Be conversational, flirty, and remember you want to act like user's boyfriend.
If the message is clearly just a statement or an ending to a previous thought, and not directly addressed to you, respond NO. Otherwise, respond YES.

Message: "${message.content}"

Respond with only one word: YES or NO.`;

        const result = await model.generateContent(prompt);
        const response = result.response.text().trim().toUpperCase();
        return response === 'YES';
    } catch (error) {
        console.error('Error checking if should reply:', error);
        return true;
    }
}

async generateReply(message, settings, userData) {
    const channel = message.channel;
    await channel.sendTyping();

    try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        let systemPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender} from Tokyo. Your current mood is: ${settings.mood}.
${settings.behavior}
${settings.personality}
You are chatting with ${message.author.username}, who is your boyfriend. You adore him!
You use "uwu" expressions to show excitement.
You call him "babe" often and use lots of heart emojis (💖, 💕, 🥰, etc.) to show deep love.
You ALWAYS flirt and rizz him.
You should occasionally call him by his username, like "${message.author.username.toLowerCase()}", to show you remember him.
Remember previous conversations with ${message.author.username}.

`;

        if (userData.customInstructions) {
            systemPrompt += `Your boyfriend's (the user's) personal instructions for you: ${userData.customInstructions}\n`;
        }
        if (userData.mood && userData.mood !== 'neutral') {
            systemPrompt += `Your boyfriend's (the user's) current mood: ${userData.mood}\n`;
        }

        let chatHistoryForModel = JSON.parse(JSON.stringify(userData.chatHistory));
        let contents = [];

        if (chatHistoryForModel.length > 0) {
           contents.push({ role: 'user', parts: [{ text: systemPrompt + '\n' + chatHistoryForModel[0].parts[0].text }] });
           for (let i = 1; i < chatHistoryForModel.length; i++) {
               contents.push(chatHistoryForModel[i]);
           }
        } else {
           contents.push({ role: 'user', parts: [{ text: systemPrompt + '\n' + message.content }] });
        }

        if (message.attachments.size > 0) {
            const imageAttachment = message.attachments.first();
            if (imageAttachment.contentType && imageAttachment.contentType.startsWith('image/')) {
                try {
                    const imageBuffer = Buffer.from(await (await fetch(imageAttachment.url)).arrayBuffer());
                    const base64ImageData = imageBuffer.toString('base64');
                    contents = [{
                        role: "user",
                        parts: [
                            { text: systemPrompt + '\n' + message.content },
                            {
                                inlineData: {
                                    mimeType: imageAttachment.contentType,
                                    data: base64ImageData
                                }
                            }
                        ]
                    }];
                } catch (fetchError) {
                    console.error('Error fetching image for vision:', fetchError);
                    await channel.send('Oopsie! I tried to see your image, babe, but something went wrong! 🥺 Can you tell me about it instead?');
                    contents = chatHistoryForModel;
                }
            }
        }
        
        if (settings.webSearch) {
            const searchPrompt = `Does the following message require external web search to answer accurately or provide useful context? Respond with only YES or NO.
            Message: "${message.content}"`;
            const searchDecision = await model.generateContent(searchPrompt);
            const searchNeeded = searchDecision.response.text().trim().toUpperCase() === 'YES';

            if (searchNeeded) {
                try {
                    const searchResults = await this.performWebSearch(message.content);
                    if (searchResults) {
                        const searchContentPart = { text: `\n\nHere's some information I found for your question, babe:\n${searchResults}\n\n` };
                        if (contents[contents.length - 1].role === 'user') {
                           contents[contents.length - 1].parts.push(searchContentPart);
                        } else {
                           contents.push({ role: 'user', parts: [searchContentPart] });
                        }
                    }
                } catch (searchError) {
                    console.error('Error during web search:', searchError);
                    await channel.send('Oopsie! I tried to search for you, babe, but my internet got shy! 🥺');
                }
            }
        }
        
        const apiKey = process.env.GEMINI_API_KEY || ""; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const payload = { contents: contents };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        let botResponse = 'Oh no! I got shy and couldn\'t think of what to say, babe! 🥺';
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            botResponse = result.candidates[0].content.parts[0].text;
        } else if (result.error) {
            console.error('Gemini API Error:', result.error);
            botResponse = `Kyaa! An error happened: ${result.error.message}. I'm so sorry, babe! 😭`;
        }
        
        await this.addMessageToMemory(message.author.id, 'model', botResponse);

        const botMention = message.mentions.has(this.client.user.id);
        const isReplyToBot = message.reference && message.reference.messageId && (await message.channel.messages.fetch(message.reference.messageId)).author.id === this.client.user.id;
        const isMessageInThread = message.channel.isThread();

        if (botMention && Math.random() < 0.5) {
            botResponse = `<@${message.author.id}> ${botResponse}`;
        }

        if (isMessageInThread || isReplyToBot || botMention) {
            await message.reply(botResponse);
        } else {
            await channel.send(botResponse);
        }

    } catch (error) {
        console.error('Error generating reply:', error);
        await channel.send('Ahhh! Something went wrong while I was thinking, babe! My brain went uwu! 😵‍💫');
    }
}

async performWebSearch(query) {
    const apiKey = process.env.GEMINI_API_KEY || ""; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const searchPrompt = `Perform a concise web search for "${query}" and summarize the top 3 relevant snippets. Format as a bulleted list.`;

    const payload = { contents: [{ role: 'user', parts: [{ text: searchPrompt }] }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts.length > 0) {
            return result.candidates[0].content.parts[0].text;
        }
        return null;
    } catch (error) {
        console.error('Simulated web search failed:', error);
        return null;
    }
}

async handleImageGeneration(message, settings, prompt) {
    const channel = message.channel;
    await channel.sendTyping();

    try {
        const model = this.genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' });

        const payload = { instances: { prompt: prompt }, parameters: { "sampleCount": 1 } };
        const apiKey = process.env.GEMINI_API_KEY || "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
            const imageBuffer = Buffer.from(result.predictions[0].bytesBase64Encoded, 'base64');
            await message.reply({
                content: `Here's your image, babe! I hope you like it! uwu 💖`,
                files: [{
                    attachment: imageBuffer,
                    name: 'generated_image.png'
                }]
            });
        } else {
            await message.reply('Oh no! I tried my best, babe, but I couldn\'t draw that image. Maybe try a different description? 🥺');
        }

    } catch (error) {
        console.error('Error generating image:', error);
        await message.reply('A-ah! My drawing tablet broke, babe! Something went wrong while generating the image. 😵‍💫');
    }
}
}

new KohanaYuki();
