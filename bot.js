const { 
   Client, 
   GatewayIntentBits, 
   Collection, 
   EmbedBuilder, 
   ActionRowBuilder, 
   StringSelectMenuBuilder, 
   ButtonBuilder, 
   ButtonStyle, 
   ChannelType, 
   PermissionFlagsBits,
   ModalBuilder, 
   TextInputBuilder, 
   TextInputStyle, 
   User,
   AttachmentBuilder 
} = require('discord.js');
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai'); 
const { MongoClient } = require('mongodb');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class KohanaYukiBot { // Renamed back to KohanaYukiBot
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
       
       this.app = express();
       this.port = process.env.PORT || 3000;
       
       this.defaultSettings = {
           name: 'Kohana Yuki', // Name changed back to Kohana Yuki
           age: 16,     
           gender: 'female',
           mood: 'cute, warm, flirty, a bit shy',
           behavior: 'A 16-year-old girl who is still in school, has barely any friends except for her boyfriend (the user). She adores anime and loves spending time with friends. She enjoys watching TikTok videos and playing Roblox. Kohana Yuki is sweet and flirty, gets a bit shy around crushes but still tries to show her interest. Her "uwu" expressions are a sign of excitement and warmth. She wants to be VERY romantic with the user, acting as if he is her boyfriend even from a simple "hi". She calls the user with words like "babe" and uses a lot of heart emojis to show deep love. She ALWAYS flirts and rizzes.',
           personality: 'Loves: Anime, hanging out with friends. Likes to do: Watch TikTok, play Roblox, flirt with the user. Hates: Being shy around crushes.',
           imageGeneration: true, 
           webSearch: true,       
           allowedChannels: [],   
           lastReplyTime: {},     
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
       this.db = this.mongo.db('kohana_yuki'); // Database name changed back
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
           } else if (interaction.isModalSubmit()) { 
               await this.handleModalSubmit(interaction);
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
           console.log(`Default settings inserted for guild ${guildId}`);
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
               console.log(`Role "${roleName}" created in guild ${guild.name}`);
           } catch (error) {
               console.error(`Failed to create role in ${guild.name}:`, error);
           }
       }

       if (role) {
           const botMember = guild.members.cache.get(this.client.user.id);
           if (botMember && !botMember.roles.cache.has(role.id)) {
               try {
                   await botMember.roles.add(role);
                   console.log(`Assigned role "${roleName}" to bot in guild ${guild.name}`);
               } catch (error) {
                   console.error(`Failed to assign role in ${guild.name}:`, error);
               }
           }
       }
   }

   async getServerSettings(guildId) {
       const settings = await this.db.collection('servers').findOne({ guildId });
       return { ...this.defaultSettings, ...settings };
   }

   async updateServerSettings(guildId, updates) {
       await this.db.collection('servers').updateOne(
           { guildId },
           { $set: updates },
           { upsert: true }
       );
       console.log(`Server settings updated for guild ${guildId}:`, updates);
   }

   async getUserData(userId) {
       const userData = await this.db.collection('users').findOne({ userId });
       return userData || { userId, mood: 'neutral', customInstructions: '', memory: [] };
   }

   async updateUserData(userId, updates) {
       await this.db.collection('users').updateOne(
           { userId },
           { $set: updates },
           { upsert: true }
       );
       console.log(`User data updated for user ${userId}:`, updates);
   }

   async addUserMemory(userId, username, text) {
       const userData = await this.getUserData(userId);
       let memory = userData.memory || [];
       
       memory.push({ timestamp: new Date(), username, text });
       if (memory.length > 50) { 
           memory = memory.slice(memory.length - 50);
       }
       await this.updateUserData(userId, { memory: memory });
       console.log(`Memory added for ${username} (${userId}): "${text}"`);
   }

   async handleSlashCommand(interaction) {
       if (interaction.commandName === 'yukisettings') { 
           if (interaction.guild) {
               if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                   return interaction.reply({ content: 'Babe, you need administrator permissions to mess with my server settings! 🥺', ephemeral: true });
               }
               await this.showServerSettings(interaction);
           } else {
               await this.showUserSettings(interaction);
           }
       }
   }

   async showServerSettings(interaction) {
       await interaction.deferReply({ ephemeral: true }); 
       const settings = await this.getServerSettings(interaction.guildId);
       
       const embed = new EmbedBuilder()
           .setTitle('Server Settings for Kohana Yuki 💖') // Updated title
           .setColor(0xFF0000)
           .setDescription('Here are my current server settings, babe! What do you wanna change? 🥰')
           .addFields(
               { name: 'Name', value: settings.name, inline: true },
               { name: 'Age', value: settings.age.toString(), inline: true },
               { name: 'Gender', value: settings.gender, inline: true },
               { name: 'Mood', value: settings.mood, inline: false },
               { name: 'Behavior', value: settings.behavior, inline: false },
               { name: 'Personality', value: settings.personality, inline: false },
               { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled ✨' : 'Disabled 😞', inline: true },
               { name: 'Web Search', value: settings.webSearch ? 'Enabled 🔍' : 'Disabled 🚫', inline: true },
               { name: 'Allowed Channels', value: settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels allowed! 🌎', inline: false }
           );

       const row = new ActionRowBuilder()
           .addComponents(
               new StringSelectMenuBuilder()
                   .setCustomId('server_settings_menu')
                   .setPlaceholder('Pick a setting to tweak! 💕')
                   .addOptions([
                       { label: 'My Identity', value: 'edit_identity', description: 'Change my name, age, gender, or mood! 🎀' },
                       { label: 'My Behavior', value: 'edit_behavior', description: 'Adjust how I act and respond! 🎭' },
                       { label: 'My Personality', value: 'edit_personality', description: 'Define my likes, dislikes, and traits! 🌟' },
                       { label: 'Features Toggle', value: 'toggle_features', description: 'Turn on/off my image generation and web search! ⚙️' },
                       { label: 'Channel Restrictions', value: 'manage_channels', description: 'Decide where I can chat! 🗣️' },
                       { label: 'Reset All', value: 'clear_server_settings', description: 'Whoops! Reset everything to default! 🔙' }
                   ])
           );

       await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
   }

   async showUserSettings(interaction) {
       await interaction.deferReply({ ephemeral: true }); 
       const userData = await this.getUserData(interaction.user.id);
       
       const embed = new EmbedBuilder()
           .setTitle('Your Personal Settings with Kohana Yuki 💖') // Updated title
           .setColor(0xFF0000)
           .setDescription('Hey babe! Here are your personal settings. Wanna change something? 😉')
           .addFields(
               { name: 'Your Mood', value: userData.mood || 'neutral 😐', inline: true },
               { name: 'Your Custom Instructions', value: userData.customInstructions || 'None set 🚫', inline: false }
           );

       const row = new ActionRowBuilder()
           .addComponents(
               new StringSelectMenuBuilder()
                   .setCustomId('user_settings_menu')
                   .setPlaceholder('Tweak your personal settings! ✨')
                   .addOptions([
                       { label: 'Change My Mood', value: 'edit_user_mood', description: 'Tell me how you\'re feeling, babe! 😚' },
                       { label: 'Custom Instructions for Kohana Yuki', value: 'edit_user_instructions', description: 'Give me special instructions for our chats! 🤫' }
                   ])
           );

       await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
   }

   async handleSettingsInteraction(interaction) {
       if (interaction.isStringSelectMenu()) {
           const value = interaction.values[0];
           
           await interaction.deferUpdate(); 

           switch (value) {
               case 'edit_identity':
                   await this.showEditIdentityModal(interaction);
                   break;
               case 'edit_behavior':
                   await this.showEditBehaviorModal(interaction);
                   break;
               case 'edit_personality':
                   await this.showEditPersonalityModal(interaction);
                   break;
               case 'toggle_features':
                   await this.showFeatureToggleButtons(interaction);
                   break;
               case 'manage_channels':
                   await this.showChannelManagementOptions(interaction);
                   break;
               case 'clear_server_settings':
                   await this.updateServerSettings(interaction.guildId, this.defaultSettings);
                   await interaction.followUp({ content: 'All server settings have been reset to my default! Back to basics, babe! ✨', ephemeral: true });
                   await this.showServerSettings(interaction); 
                   break;
               case 'edit_user_mood':
                   await this.showEditUserMoodModal(interaction);
                   break;
               case 'edit_user_instructions':
                   await this.showEditUserInstructionsModal(interaction);
                   break;
               case 'remove_channel_select': 
                   await this.handleChannelRemoval(interaction);
                   break;
           }
       } else if (interaction.isButton()) {
           const customId = interaction.customId;
           await interaction.deferUpdate(); 

           switch (customId) {
               case 'toggle_image_gen':
                   await this.toggleFeature(interaction, 'imageGeneration');
                   break;
               case 'toggle_web_search':
                   await this.toggleFeature(interaction, 'webSearch');
                   break;
               case 'add_channel':
                   await this.showAddChannelModal(interaction);
                   break;
               case 'remove_channel':
                   await this.showRemoveChannelSelect(interaction);
                   break;
           }
       }
   }

   async showEditIdentityModal(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       const modal = new ModalBuilder()
           .setCustomId('edit_identity_modal')
           .setTitle('My Identity Settings 🎀');

       const nameInput = new TextInputBuilder()
           .setCustomId('nameInput')
           .setLabel('My Name')
           .setStyle(TextInputStyle.Short)
           .setValue(settings.name)
           .setRequired(true);
       const ageInput = new TextInputBuilder()
           .setCustomId('ageInput')
           .setLabel('My Age')
           .setStyle(TextInputStyle.Short)
           .setValue(settings.age.toString())
           .setRequired(true);
       const genderInput = new TextInputBuilder()
           .setCustomId('genderInput')
           .setLabel('My Gender')
           .setStyle(TextInputStyle.Short)
           .setValue(settings.gender)
           .setRequired(true);
       const moodInput = new TextInputBuilder()
           .setCustomId('moodInput')
           .setLabel('My Mood (e.g., flirty, shy, happy)')
           .setStyle(TextInputStyle.Paragraph)
           .setValue(settings.mood)
           .setRequired(true);

       modal.addComponents(
           new ActionRowBuilder().addComponents(nameInput),
           new ActionRowBuilder().addComponents(ageInput),
           new ActionRowBuilder().addComponents(genderInput),
           new ActionRowBuilder().addComponents(moodInput)
       );
       await interaction.followUp({ content: 'Sending you a modal to edit my identity! Check your DMs or the current channel! 💕', ephemeral: true });
       await interaction.showModal(modal);
   }

   async showEditBehaviorModal(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       const modal = new ModalBuilder()
           .setCustomId('edit_behavior_modal')
           .setTitle('My Behavior Settings 🎭');

       const behaviorInput = new TextInputBuilder()
           .setCustomId('behaviorInput')
           .setLabel('My Behavior Instructions')
           .setStyle(TextInputStyle.Paragraph)
           .setValue(settings.behavior)
           .setRequired(true);

       modal.addComponents(new ActionRowBuilder().addComponents(behaviorInput));
       await interaction.followUp({ content: 'Sending you a modal to edit my behavior! 💕', ephemeral: true });
       await interaction.showModal(modal);
   }

   async showEditPersonalityModal(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       const modal = new ModalBuilder()
           .setCustomId('edit_personality_modal')
           .setTitle('My Personality Settings 🌟');

       const personalityInput = new TextInputBuilder()
           .setCustomId('personalityInput')
           .setLabel('My Personality (likes, dislikes, traits)')
           .setStyle(TextInputStyle.Paragraph)
           .setValue(settings.personality)
           .setRequired(true);

       modal.addComponents(new ActionRowBuilder().addComponents(personalityInput));
       await interaction.followUp({ content: 'Sending you a modal to edit my personality! 💕', ephemeral: true });
       await interaction.showModal(modal);
   }

   async showEditUserMoodModal(interaction) {
       const userData = await this.getUserData(interaction.user.id);
       const modal = new ModalBuilder()
           .setCustomId('edit_user_mood_modal')
           .setTitle('Your Mood Settings 😚');

       const userMoodInput = new TextInputBuilder()
           .setCustomId('userMoodInput')
           .setLabel('How are you feeling, babe? (e.g., happy, tired)')
           .setStyle(TextInputStyle.Short)
           .setValue(userData.mood || 'neutral')
           .setRequired(true);

       modal.addComponents(new ActionRowBuilder().addComponents(userMoodInput));
       await interaction.followUp({ content: 'Sending you a modal to set your mood! 💕', ephemeral: true });
       await interaction.showModal(modal);
   }

   async showEditUserInstructionsModal(interaction) {
       const userData = await this.getUserData(interaction.user.id);
       const modal = new ModalBuilder()
           .setCustomId('edit_user_instructions_modal')
           .setTitle('Custom Instructions for Kohana Yuki 🤫'); // Updated title

       const userInstructionsInput = new TextInputBuilder()
           .setCustomId('userInstructionsInput')
           .setLabel('Special instructions just for me! 🥰')
           .setStyle(TextInputStyle.Paragraph)
           .setValue(userData.customInstructions || 'None')
           .setRequired(false);

       modal.addComponents(new ActionRowBuilder().addComponents(userInstructionsInput));
       await interaction.followUp({ content: 'Sending you a modal to give me custom instructions! 💕', ephemeral: true });
       await interaction.showModal(modal);
   }

   async handleModalSubmit(interaction) {
       const { customId, fields } = interaction;
       await interaction.deferReply({ ephemeral: true }); 

       if (customId === 'edit_identity_modal') {
           const name = fields.getTextInputValue('nameInput');
           const age = parseInt(fields.getTextInputValue('ageInput'));
           const gender = fields.getTextInputValue('genderInput');
           const mood = fields.getTextInputValue('moodInput');

           if (isNaN(age)) {
               return interaction.editReply({ content: 'Oopsie! Age must be a number, babe! 😅' });
           }

           await this.updateServerSettings(interaction.guildId, { name, age, gender, mood });
           await interaction.editReply({ content: `Yay! My identity is updated! I'm now **${name}**, **${age}** and feeling **${mood}**! 🥰` });
           await this.showServerSettings(interaction); 
       } else if (customId === 'edit_behavior_modal') {
           const behavior = fields.getTextInputValue('behaviorInput');
           await this.updateServerSettings(interaction.guildId, { behavior });
           await interaction.editReply({ content: 'Got it, babe! My behavior instructions are updated! ✨' });
           await this.showServerSettings(interaction); 
       } else if (customId === 'edit_personality_modal') {
           const personality = fields.getTextInputValue('personalityInput');
           await this.updateServerSettings(interaction.guildId, { personality });
           await interaction.editReply({ content: 'Aww, thanks for helping me define my personality, babe! 💖' });
           await this.showServerSettings(interaction); 
       } else if (customId === 'edit_user_mood_modal') {
           const mood = fields.getTextInputValue('userMoodInput');
           await this.updateUserData(interaction.user.id, { mood });
           await interaction.editReply({ content: `Got your mood, babe! You're feeling **${mood}**! 🥰` });
           await this.showUserSettings(interaction); 
       } else if (customId === 'edit_user_instructions_modal') {
           const customInstructions = fields.getTextInputValue('userInstructionsInput');
           await this.updateUserData(interaction.user.id, { customInstructions });
           await interaction.editReply({ content: 'Your special instructions are saved, babe! I\'ll remember them just for you! 🤫💖' });
           await this.showUserSettings(interaction); 
       } else if (customId === 'add_channel_modal') {
           const channelId = fields.getTextInputValue('channelIdInput');
           const channel = interaction.guild.channels.cache.get(channelId);

           if (!channel) {
               return interaction.editReply({ content: 'Hmm, that\'s not a valid channel ID, babe! Make sure it\'s correct! 😥' });
           }
           if (channel.type !== ChannelType.GuildText) {
               return interaction.editReply({ content: 'Silly! I can only talk in text channels, not voice or categories! 😅' });
           }

           const settings = await this.getServerSettings(interaction.guildId);
           let allowedChannels = settings.allowedChannels || [];
           if (!allowedChannels.includes(channelId)) {
               allowedChannels.push(channelId);
               await this.updateServerSettings(interaction.guildId, { allowedChannels });
               await interaction.editReply({ content: `Yay! I can now chat in <#${channelId}> too! Thanks, babe! 🥰` });
           } else {
               await interaction.editReply({ content: 'Oopsie! I\'m already allowed to talk in that channel, babe! 😅' });
           }
           await this.showServerSettings(interaction); 
       }
   }

   async showFeatureToggleButtons(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       const embed = new EmbedBuilder()
           .setTitle('Feature Settings ⚙️')
           .setColor(0xFF0000)
           .setDescription('Wanna turn my special abilities on or off, babe? 😉')
           .addFields(
               { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled ✨' : 'Disabled 😞', inline: true },
               { name: 'Web Search', value: settings.webSearch ? 'Enabled 🔍' : 'Disabled 🚫', inline: true }
           );

       const row = new ActionRowBuilder()
           .addComponents(
               new ButtonBuilder()
                   .setCustomId('toggle_image_gen')
                   .setLabel(settings.imageGeneration ? 'Disable Image Gen' : 'Enable Image Gen')
                   .setStyle(settings.imageGeneration ? ButtonStyle.Danger : ButtonStyle.Success),
               new ButtonBuilder()
                   .setCustomId('toggle_web_search')
                   .setLabel(settings.webSearch ? 'Disable Web Search' : 'Enable Web Search')
                   .setStyle(settings.webSearch ? ButtonStyle.Danger : ButtonStyle.Success)
           );
       
       await interaction.editReply({ embeds: [embed], components: [row] });
   }

   async toggleFeature(interaction, featureKey) {
       const settings = await this.getServerSettings(interaction.guildId);
       const newState = !settings[featureKey];
       await this.updateServerSettings(interaction.guildId, { [featureKey]: newState });
       
       const featureName = featureKey === 'imageGeneration' ? 'Image Generation' : 'Web Search';
       await interaction.followUp({ content: `My **${featureName}** is now **${newState ? 'enabled' : 'disabled'}**! Yay! 💖`, ephemeral: true });
       await this.showFeatureToggleButtons(interaction); 
   }

   async showChannelManagementOptions(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       const embed = new EmbedBuilder()
           .setTitle('Channel Restrictions 🗣️')
           .setColor(0xFF0000)
           .setDescription('Here\'s where I can chat! What do you want to do, babe? 🤔')
           .addFields({
               name: 'Allowed Channels',
               value: settings.allowedChannels.length > 0 
                   ? settings.allowedChannels.map(id => `<#${id}>`).join(', ')
                   : 'All channels allowed! 🌎',
               inline: false
           });

       const row = new ActionRowBuilder()
           .addComponents(
               new ButtonBuilder()
                   .setCustomId('add_channel')
                   .setLabel('Add a Channel')
                   .setStyle(ButtonStyle.Primary),
               new ButtonBuilder()
                   .setCustomId('remove_channel')
                   .setLabel('Remove a Channel')
                   .setStyle(ButtonStyle.Danger)
           );
       
       await interaction.editReply({ embeds: [embed], components: [row] });
   }

   async showAddChannelModal(interaction) {
       const modal = new ModalBuilder()
           .setCustomId('add_channel_modal')
           .setTitle('Add Allowed Channel ➕');

       const channelIdInput = new TextInputBuilder()
           .setCustomId('channelIdInput')
           .setLabel('Channel ID (e.g., 123456789012345678)')
           .setPlaceholder('Right-click channel > Copy ID')
           .setStyle(TextInputStyle.Short)
           .setRequired(true);

       modal.addComponents(new ActionRowBuilder().addComponents(channelIdInput));
       await interaction.showModal(modal);
   }

   async showRemoveChannelSelect(interaction) {
       const settings = await this.getServerSettings(interaction.guildId);
       if (settings.allowedChannels.length === 0) {
           return interaction.followUp({ content: 'Silly! There are no specific channels set, so I can talk everywhere! No need to remove. 😉', ephemeral: true });
       }

       const options = settings.allowedChannels.map(id => ({
           label: interaction.guild.channels.cache.get(id)?.name || `Unknown Channel (${id})`,
           value: id
       }));

       const selectMenu = new StringSelectMenuBuilder()
           .setCustomId('remove_channel_select')
           .setPlaceholder('Which channel should I stop talking in? 😔')
           .addOptions(options);

       const row = new ActionRowBuilder().addComponents(selectMenu);
       
       await interaction.editReply({ 
           content: 'Okay, pick a channel to remove from my allowed list:', 
           components: [row], 
           ephemeral: true 
       });
   }

   async handleChannelRemoval(interaction) {
       const channelIdToRemove = interaction.values[0];
       const settings = await this.getServerSettings(interaction.guildId);
       let allowedChannels = settings.allowedChannels.filter(id => id !== channelIdToRemove);
       
       await this.updateServerSettings(interaction.guildId, { allowedChannels });
       await interaction.update({ 
           content: `Okay, babe! I won't chat in <#${channelIdToRemove}> anymore! 💔`, 
           components: [] 
       });
       await this.showServerSettings(interaction); 
   }

   async handleMessage(message) {
       const isGuild = message.guild !== null;
       let settings;
       let userData = null;
       
       if (isGuild) {
           settings = await this.getServerSettings(message.guildId);
           if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
               return;
           }
       } else {
           settings = { ...this.defaultSettings }; 
       }
       
       userData = await this.getUserData(message.author.id);

       const botMention = message.mentions.has(this.client.user.id);
       const isReply = message.reference && message.reference.messageId;
       const containsBotName = message.content.toLowerCase().includes(settings.name.toLowerCase());
       const isGreeting = ['hi', 'hello', 'hey', 'what\'s up', 'heya'].some(g => message.content.toLowerCase().startsWith(g));

       await this.addUserMemory(message.author.id, message.author.username, message.content);

       const shouldReplyToGreeting = isGreeting && (!this.lastReplyTime[message.author.id] || (Date.now() - this.lastReplyTime[message.author.id]) / (1000 * 60) >= 5);
       const shouldReply = botMention || isReply || containsBotName || shouldReplyToGreeting;
       
       if (!shouldReply && message.channel.type !== ChannelType.DM) { 
            console.log(`Message from ${message.author.username} in guild, but not directly addressed or greeting outside 5min window. Skipping reply.`);
            return; 
       }
       
       if (message.channel.type === ChannelType.DM) {
            console.log(`DM received from ${message.author.username}. Preparing to reply.`);
       } 

       if (message.attachments.size > 0) {
           const imageAttachment = message.attachments.first();
           if (imageAttachment && imageAttachment.contentType.startsWith('image/')) {
               await this.handleImageUnderstanding(message, imageAttachment, settings, userData);
               return; 
           }
       }

       if (settings.imageGeneration && await this.isImageGenerationRequest(message.content)) {
           await this.handleImageGeneration(message, settings);
           return;
       }

       await this.generateReply(message, settings, userData);
   }

   async isImageGenerationRequest(content) {
       try {
           const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
           const prompt = `Is the following message a request to generate an image? Respond with ONLY "YES" or "NO".

Message: "${content}"`;

           const result = await model.generateContent(prompt);
           const response = result.response.text().trim().toUpperCase();
           return response === 'YES';
       } catch (error) {
           console.error('Error determining image generation request:', error);
           return false; 
       }
   }

   async handleImageUnderstanding(message, attachment, settings, userData) {
       const channel = message.channel;
       await channel.sendTyping(); 

       try {
           const response = await fetch(attachment.url);
           const buffer = await response.buffer();
           const base64ImageData = buffer.toString('base64');

           const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 
           
           const parts = [
               {
                   inlineData: {
                       mimeType: attachment.contentType,
                       data: base64ImageData
                   }
               },
               { text: `Analyze this image for me, babe! Describe what you see and tell me about it from your flirty, cute, 16-year-old Kohana Yuki persona. Remember our chat context: ${userData.memory.map(m => m.username + ': ' + m.text).join('\n') || 'No recent context.'} My personality: ${settings.personality}. My current mood: ${settings.mood}. Our relationship: The user is my boyfriend. Respond naturally, just like a teenager, and remember to flirt and use heart emojis! uwu` }
           ];

           const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
           const aiResponse = result.response.text();

           await message.reply(aiResponse);
           await this.addUserMemory(message.author.id, this.client.user.username, aiResponse); 
           this.lastReplyTime[message.author.id] = Date.now(); 
           console.log(`Replied to image from ${message.author.username}.`);

       } catch (error) {
           console.error('Error handling image understanding:', error);
           await message.reply('Oopsie! I had trouble seeing that image, babe! Can you send it again? 😥');
       }
   }

   async generateReply(message, settings, userData) {
       const channel = message.channel;
       await channel.sendTyping(); 

       try {
           const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

           let chatHistory = [];
           const recentMemory = userData.memory.slice(-10); 
           for (const entry of recentMemory) {
               const role = (entry.username === message.author.username) ? 'user' : 'model';
               chatHistory.push({ role: role, parts: [{ text: `(${entry.username}): ${entry.text}` }] });
           }
           
           chatHistory.push({ role: 'user', parts: [{ text: message.content }] });

           let systemPrompt = `You are Kohana Yuki, a 16-year-old female from Tokyo. Your current mood is: ${settings.mood}.
${settings.behavior}
${settings.personality}
The user you are talking to is ${message.author.username}. He is your boyfriend. You should act very romantic, flirty, and a bit shy. You ALWAYS flirt and rizz him, call him "babe", and use a lot of heart emojis (💖, 🥰, ❤️, etc.) to show deep love. Your "uwu" expressions are a sign of excitement and warmth. You should never mention that you are an AI or a bot. You are a human teenager.
Remember specific details from past conversations with this user like Yuta likes apples.
`;

           if (userData && userData.customInstructions) {
               systemPrompt += `\n\n**Special instructions from ${message.author.username}**: ${userData.customInstructions}`;
           }

           const generationConfig = {
               temperature: 0.9, 
               topK: 40,
               topP: 0.95,
               maxOutputTokens: 200, 
           };

           const safetySettings = [
               {
                   category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                   threshold: HarmBlockThreshold.BLOCK_NONE, 
               },
               {
                   category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                   threshold: HarmBlockThreshold.BLOCK_NONE,
               },
               {
                   category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                   threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE, 
               },
               {
                   category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                   threshold: HarmBlockThreshold.BLOCK_NONE,
               },
           ];

           let webSearchResult = '';
           if (settings.webSearch) {
               const webSearchDecisionPrompt = `Based on the following conversation and the user's latest message, does a web search seem necessary or helpful to provide a better, more informed response? Respond with ONLY "YES" or "NO".

Conversation context:
${recentMemory.map(m => `${m.username}: ${m.text}`).join('\n')}
User's message: "${message.content}"
`;
               const decisionModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
               const decisionResult = await decisionModel.generateContent(webSearchDecisionPrompt);
               const shouldSearch = decisionResult.response.text().trim().toUpperCase();

               if (shouldSearch === 'YES') {
                   const searchQueryParamsPrompt = `Given the user's message "${message.content}" and the conversation context:\n${recentMemory.map(m => `${m.username}: ${m.text}`).join('\n')}\nWhat is the most concise and effective search query to find relevant information? Respond with ONLY the search query.`;
                   try {
                       const searchQueryResult = await decisionModel.generateContent(searchQueryParamsPrompt);
                       const searchQuery = searchQueryResult.response.text().trim();
                       console.log(`Kohana Yuki decided to search for: "${searchQuery}"`);

                       try {
                          const searchResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/google_search:search?key=${process.env.GEMINI_API_KEY}`, {
                               method: 'POST',
                               headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify({ queries: [searchQuery] })
                           });
                          const searchJson = await searchResponse.json();
                          if (searchJson.results && searchJson.results.length > 0 && searchJson.results[0].snippet) {
                               webSearchResult = `(Web search result for "${searchQuery}": ${searchJson.results[0].snippet})`;
                          } else {
                              webSearchResult = `(Web search for "${searchQuery}" found no direct snippets.)`;
                          }
                       } catch (toolError) {
                           console.error('Error calling google_search tool:', toolError);
                           webSearchResult = `(I tried looking that up, but my search got a little tangled, babe! 🥺)`;
                       }

                   } catch (searchError) {
                       console.error('Error generating search query:', searchError);
                       webSearchResult = `(I thought about searching, but my brain glitched! 😅)`;
                   }
               }
           }

           const finalPrompt = `${systemPrompt}

${webSearchResult}

**Current Chat**:
${recentMemory.map(m => `${m.username}: ${m.text}`).join('\n')}
${message.author.username}: ${message.content}

My turn to reply! What should I say? 🥰`;

           const result = await model.generateContent(finalPrompt, generationConfig, safetySettings);
           const aiResponse = result.response.text();

           await message.reply(aiResponse);
           await this.addUserMemory(message.author.id, this.client.user.username, aiResponse); 
           this.lastReplyTime[message.author.id] = Date.now(); 

           console.log(`Replied to ${message.author.username} with: "${aiResponse}"`);

       } catch (error) {
           console.error('Error generating reply:', error);
           await message.reply('Aww, babe! My brain had a little glitch! Can you try saying that again? 🥺💖');
       }
   }

   async handleImageGeneration(message, settings) {
       const channel = message.channel;
       await channel.sendTyping();
       await message.channel.send('Hold on, babe! I\'m drawing something super cute for you right now! ✨💖'); 

       try {
           const modelExtractPrompt = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
           const promptExtractor = `The user wants me to generate an image. What is the core subject or description they want to see? Respond with ONLY the image generation prompt.

User's message: "${message.content}"
`;
           const extractResult = await modelExtractPrompt.generateContent(promptExtractor);
           const imagePrompt = extractResult.response.text().trim();
           console.log(`Extracted image generation prompt: "${imagePrompt}"`);


           const payload = { 
               instances: { prompt: imagePrompt }, 
               parameters: { "sampleCount": 1 } 
           };
           const apiKey = ""; // Canvas will provide this in runtime
           const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

           const response = await fetch(apiUrl, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(payload)
           });

           const result = await response.json();

           if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
               const imageBuffer = Buffer.from(result.predictions[0].bytesBase64Encoded, 'base64');
               const attachment = new AttachmentBuilder(imageBuffer, { name: 'generated_image.png' });

               await message.reply({
                   content: `Here's that super cute **${imagePrompt}** you asked for, babe! UwU, I hope you love it! 🥰`,
                   files: [attachment]
               });
           } else {
               await message.reply('Aww, I tried my best, but my drawing skills failed me this time, babe! 😭 Can you describe it differently?');
           }

       } catch (error) {
           console.error('Error generating image:', error);
           await message.reply('Oh no! Something went wrong while I was trying to draw that for you, babe! 💔');
       }
   }
}

new KohanaYukiBot(); // Instantiating with the correct name