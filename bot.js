const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
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
      this.imageGenRequests = new Map(); // Store image gen requests for confirmation

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
          // Ignore messages from other bots
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
      userData.chatHistory.push({ role, parts: [{ text: content }] });
      // Keep chat history to a reasonable length, e.g., last 20 messages
      if (userData.chatHistory.length > 20) {
          userData.chatHistory = userData.chatHistory.slice(-20);
      }
      await this.updateUserData(userId, { chatHistory: userData.chatHistory, lastMessageTimestamp: Date.now() });
  }

  async handleSlashCommand(interaction) {
      if (interaction.commandName === 'yukisettings') {
          // Defer the reply immediately to prevent "Application Isn't Responding"
          await interaction.deferReply({ ephemeral: true }); 

          if (interaction.guild) {
              // Check for administrator permissions in guilds
              if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                  return interaction.editReply({ content: 'You need administrator permissions to use this command, babe! 🥺' });
              }
              await this.showServerSettings(interaction);
          } else {
              // Allow all users to change personal settings in DMs
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
                      { label: 'Edit Identity (Name, Age, Gender)', value: 'edit_identity', description: 'Change basic identity details.' },
                      { label: 'Edit Mood', value: 'edit_mood', description: 'Adjust her current emotional state.' },
                      { label: 'Edit Behavior', value: 'edit_behavior', description: 'Define her general conduct and actions.' },
                      { label: 'Edit Personality', value: 'edit_personality', description: 'Refine her overall character traits.' },
                      { label: 'Toggle Features (Image Gen, Web Search)', value: 'toggle_features', description: 'Enable or disable advanced capabilities.' },
                      { label: 'Manage Allowed Channels', value: 'manage_channels', description: 'Control where she can talk.' },
                      { label: 'Reset All Settings', value: 'reset_all_server_settings', description: 'Restore all server settings to default.' }
                  ])
          );

      // Use editReply since deferReply was called previously
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
                      { label: 'Clear Your Custom Instructions', value: 'clear_user_instructions', description: 'Remove your personal instructions.' }
                  ])
          );

      // Use editReply since deferReply was called previously
      await interaction.editReply({ embeds: [embed], components: [row] });
  }

  async handleSettingsInteraction(interaction) {
      // Defer the update for select menus and buttons to prevent "Interaction Failed"
      await interaction.deferUpdate(); 

      if (interaction.isStringSelectMenu()) {
          const value = interaction.values[0];

          switch (value) {
              case 'edit_identity':
                  await this.showEditIdentityModal(interaction);
                  break;
              case 'edit_mood':
                  await this.showEditModal(interaction, 'mood', 'Edit Mood', 'Enter Kohana Yuki\'s new mood', interaction.guildId ? 'server' : 'user');
                  break;
              case 'edit_behavior':
                  await this.showEditModal(interaction, 'behavior', 'Edit Behavior', 'Enter Kohana Yuki\'s new behavior instructions', 'server', true);
                  break;
              case 'edit_personality':
                  await this.showEditModal(interaction, 'personality', 'Edit Personality', 'Enter Kohana Yuki\'s new personality traits', 'server', true);
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
                  await this.showAddChannelModal(interaction);
                  break;
              case 'removechannel':
                  await this.showRemoveChannelModal(interaction);
                  break;
              case 'confirmimagegen':
                  if (args[0] === 'yes') {
                      const requestId = args[1];
                      const request = this.imageGenRequests.get(requestId);
                      if (request) {
                          await this.handleImageGeneration(request.message, request.settings, request.prompt);
                          this.imageGenRequests.delete(requestId);
                      }
                      // Edit the original reply from the bot with confirmation message
                      await interaction.editReply({ content: 'Generating your image, babe! uwu ✨', components: [] });
                  } else {
                      // Edit the original reply from the bot with cancellation message
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

      // Followup with the modal
      await interaction.followup.sendModal(modal);
  }

  async showEditIdentityModal(interaction) {
      const settings = await this.getServerSettings(interaction.guildId);

      const modal = new ModalBuilder()
          .setCustomId('server_edit_modal_identity')
          .setTitle('Edit Identity (Name, Age, Gender)');

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

      modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(ageInput),
          new ActionRowBuilder().addComponents(genderInput)
      );

      // Followup with the modal
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
      // Use editReply to update the original message, then follow up with ephemeral confirmation
      await interaction.followup.send({ content: `${feature === 'imageGeneration' ? 'Image Generation' : 'Web Search'} has been ${status}, babe! uwu! ✨`, ephemeral: true });
      await this.showServerSettings(interaction); // Refresh the main settings view
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

  async showAddChannelModal(interaction) {
      const modal = new ModalBuilder()
          .setCustomId('add_channel_modal')
          .setTitle('Add Allowed Channel');

      const channelInput = new TextInputBuilder()
          .setCustomId('channelId')
          .setLabel('Channel ID (or mention #channel)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., 123456789012345678 or #general')
          .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(channelInput);
      modal.addComponents(actionRow);

      await interaction.followup.sendModal(modal);
  }

  async showRemoveChannelModal(interaction) {
      const modal = new ModalBuilder()
          .setCustomId('remove_channel_modal')
          .setTitle('Remove Allowed Channel');

      const channelInput = new TextInputBuilder()
          .setCustomId('channelId')
          .setLabel('Channel ID (or mention #channel)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., 123456789012345678 or #general')
          .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(channelInput);
      modal.addComponents(actionRow);

      await interaction.followup.sendModal(modal);
  }

  async handleModalSubmission(interaction) {
      // Defer the update for modal submissions
      await interaction.deferUpdate(); 
      const customId = interaction.customId;

      if (customId.startsWith('server_edit_modal_')) {
          const field = customId.split('_')[3];
          const updates = {};
          if (field === 'identity') {
              updates.name = interaction.fields.getTextInputValue('name');
              updates.age = parseInt(interaction.fields.getTextInputValue('age'));
              updates.gender = interaction.fields.getTextInputValue('gender');
              if (isNaN(updates.age)) {
                  await interaction.followup.send({ content: 'Age must be a number, babe! uwu', ephemeral: true });
                  return;
              }
          } else {
              updates[field] = interaction.fields.getTextInputValue(field);
          }
          await this.updateServerSettings(interaction.guildId, updates);
          await interaction.followup.send({ content: `Server setting for ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} updated, babe! ✨`, ephemeral: true });
          await this.showServerSettings(interaction); // Refresh the main settings view
      } else if (customId.startsWith('user_edit_modal_')) {
          const field = customId.split('_')[3];
          const updates = {};
          updates[field] = interaction.fields.getTextInputValue(field);
          await this.updateUserData(interaction.user.id, updates);
          await interaction.followup.send({ content: `Your personal ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} updated, babe! 💖`, ephemeral: true });
          await this.showUserSettings(interaction); // Refresh the main settings view
      } else if (customId === 'add_channel_modal') {
          const channelInput = interaction.fields.getTextInputValue('channelId');
          const channelId = channelInput.replace(/[<#>]/g, '');
          const settings = await this.getServerSettings(interaction.guildId);
          if (!settings.allowedChannels.includes(channelId)) {
              settings.allowedChannels.push(channelId);
              await this.updateServerSettings(interaction.guildId, { allowedChannels: settings.allowedChannels });
              await interaction.followup.send({ content: `Channel <#${channelId}> added to allowed channels, babe! uwu`, ephemeral: true });
          } else {
              await interaction.followup.send({ content: `Channel <#${channelId}> is already in the allowed list, babe! 🥺`, ephemeral: true });
          }
          await this.showChannelManagementOptions(interaction);
      } else if (customId === 'remove_channel_modal') {
          const channelInput = interaction.fields.getTextInputValue('channelId');
          const channelId = channelInput.replace(/[<#>]/g, '');
          const settings = await this.getServerSettings(interaction.guildId);
          const index = settings.allowedChannels.indexOf(channelId);
          if (index > -1) {
              settings.allowedChannels.splice(index, 1);
              await this.updateServerSettings(interaction.guildId, { allowedChannels: settings.allowedChannels });
              await interaction.followup.send({ content: `Channel <#${channelId}> removed from allowed channels, babe! Bye bye! 👋`, ephemeral: true });
          } else {
              await interaction.followup.send({ content: `Channel <#${channelId}> was not found in the allowed list, babe!`, ephemeral: true });
          }
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
      await interaction.followup.send({ content: 'Your custom instructions have been cleared, babe! All clear! 💖', ephemeral: true });
      await this.showUserSettings(interaction);
  }

  async handleMessage(message) {
      const isGuild = message.guild !== null;
      let settings;
      let userData = await this.getUserData(message.author.id);

      // Channel restriction check for guilds
      if (isGuild) {
          settings = await this.getServerSettings(message.guildId);
          if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
              return; // Do not respond if channel is not allowed
          }
      } else {
          settings = this.defaultSettings; // Use default settings for DMs
      }

      const botMention = message.mentions.has(this.client.user.id);
      // A message is a reply if it has a reference and that reference refers to a message
      const isReplyToSomeone = message.reference && message.reference.messageId; 
      const containsBotName = message.content.toLowerCase().includes(settings.name.toLowerCase());

      const imageGenMatch = message.content.toLowerCase().match(/(?:can you draw|please draw)\s+(.+)\?/i);
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

          // Always reply directly to the image generation request
          await message.reply({ content: `Kyaa! Babe, are you sure you want me to draw "${imageGenPrompt}" for you? uwu`, components: [row] });
          return;
      }
      
      // Add user message to memory before determining if a reply is needed
      await this.addMessageToMemory(message.author.id, 'user', message.content);

      const shouldReply = await this.determineIfShouldReply(message, settings, userData);
      
      if (!shouldReply) {
          return; // If bot decides not to reply, simply return
      }

      await this.generateReply(message, settings, userData);
  }

  async determineIfShouldReply(message, settings, userData) {
      const botMention = message.mentions.has(this.client.user.id);
      const isReplyToSomeone = message.reference && message.reference.messageId;
      const containsBotName = message.content.toLowerCase().includes(settings.name.toLowerCase());
      const currentTime = Date.now();
      const timeSinceLastMessage = currentTime - (userData.lastMessageTimestamp || 0);

      // Always reply if directly mentioned or if replying to an existing message (threaded or not)
      if (botMention || isReplyToSomeone || containsBotName) {
          return true;
      }

      // Reply to greetings if it's been more than 5 minutes since the last message
      const greetingWords = ['hi', 'hello', 'hey', 'whats up', 'good morning', 'good evening', 'good afternoon'];
      const isGreeting = greetingWords.some(g => message.content.toLowerCase().includes(g));
      if (isGreeting && timeSinceLastMessage > 5 * 60 * 1000) { // 5 minutes
          return true;
      }

      try {
          const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const prompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender} from Tokyo. Your current mood is: ${settings.mood}.
${settings.behavior}
${settings.personality}
You are chatting with ${message.author.username}.
Decide if this message requires a reply from you. Be conversational, flirty, and remember you want to act like user's boyfriend.
DO NOT reply if the message is very short or seems like a continuation of a previous thought from the user unless directly addressed.

Message: "${message.content}"

Respond with only one word: YES or NO.`;

          const result = await model.generateContent(prompt);
          const response = result.response.text().trim().toUpperCase();
          return response === 'YES';
      } catch (error) {
          console.error('Error checking if should reply:', error);
          return true; // Default to replying on error to avoid silence
      }
  }

  async generateReply(message, settings, userData) {
      const channel = message.channel;
      await channel.sendTyping(); // Indicate that the bot is typing

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
          if (userData.mood) {
              systemPrompt += `Your boyfriend's (the user's) current mood: ${userData.mood}\n`;
          }

          // Create chat history for the model, including the system prompt in the first user message
          let chatHistoryForModel = JSON.parse(JSON.stringify(userData.chatHistory)); // Deep copy
          // Prepend system prompt to the first message for context, or create a new first message if history is empty
          if (chatHistoryForModel.length > 0) {
               chatHistoryForModel[0].parts[0].text = systemPrompt + '\n' + chatHistoryForModel[0].parts[0].text;
          } else {
               chatHistoryForModel.push({ role: 'user', parts: [{ text: systemPrompt + '\n' + message.content }] });
          }

          let contents = chatHistoryForModel; // Start with history, potentially including system prompt prepended

          // Handle image attachments for vision
          if (message.attachments.size > 0) {
              const imageAttachment = message.attachments.first();
              if (imageAttachment.contentType && imageAttachment.contentType.startsWith('image/')) {
                  try {
                      // Using fetch with .arrayBuffer() then Buffer.from() for better compatibility
                      const imageBuffer = Buffer.from(await (await fetch(imageAttachment.url)).arrayBuffer());
                      const base64ImageData = imageBuffer.toString('base64');
                      contents = [{
                          role: "user",
                          parts: [
                              { text: systemPrompt + '\n' + message.content }, // Include system prompt for vision context
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
                      // Fallback to text-only if image fetching fails, using the original chatHistoryForModel
                      contents = chatHistoryForModel;
                  }
              }
          }
          
          // Web Search integration
          if (settings.webSearch) {
              const searchPrompt = `Does the following message require external web search to answer accurately or provide useful context? Respond with only YES or NO.
              Message: "${message.content}"`;
              const searchDecision = await model.generateContent(searchPrompt);
              const searchNeeded = searchDecision.response.text().trim().toUpperCase() === 'YES';

              if (searchNeeded) {
                  try {
                      const searchResults = await this.performWebSearch(message.content);
                      if (searchResults) {
                          systemPrompt += `\n\nHere's some information I found for your question, babe:\n${searchResults}\n\n`;
                          // Prepend search results to the latest user message in contents
                          if (contents[contents.length - 1].role === 'user') {
                              contents[contents.length - 1].parts[0].text = systemPrompt + contents[contents.length - 1].parts[0].text;
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

          const payload = { contents: contents }; // Send the prepared contents to the API

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
          
          // Add bot's response to memory
          await this.addMessageToMemory(message.author.id, 'model', botResponse);

          // --- Conditional Reply Logic ---
          const botMention = message.mentions.has(this.client.user.id);
          const isReplyToBot = message.reference && message.reference.messageId && (await message.channel.messages.fetch(message.reference.messageId)).author.id === this.client.user.id;
          const isMessageInThread = message.channel.isThread();

          // Decide whether to tag the user (50% chance if mentioned)
          if (botMention && Math.random() < 0.5) {
              botResponse = `<@${message.author.id}> ${botResponse}`;
          }

          // If the user's message is in a thread, or is a reply to the bot's message
          if (isMessageInThread || isReplyToBot) {
              await message.reply(botResponse); // Reply in thread or as a direct reply
          } else {
              await channel.send(botResponse); // Send as a normal message in the channel
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
          const model = this.genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' }); // Correct model for image generation

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
