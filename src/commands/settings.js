// src/commands/settings.js
const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionsBitField, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { updateBotPersonality, getBotPersonality, clearAllData, getBotSettings, updateAllowedChannels, getBotDefaultInstructions } = require('../database/mongo');

const COMMAND_NAME = 'settings';
const PERSONALITY_MODAL_ID = 'personalityModal';
const TOGGLE_FEATURES_MODAL_ID = 'toggleFeaturesModal';
const SET_CHANNELS_MENU_ID = 'setChannelsMenu';
const REMOVE_CHANNELS_MENU_ID = 'removeChannelsMenu';
const CLEAR_BUTTON_ID = 'clearDataButton';

// Register Slash Commands
const registerCommands = async (client, clientId) => {
    const commands = [
        new SlashCommandBuilder()
            .setName(COMMAND_NAME)
            .setDescription('Manage the AI bot settings and personality.')
            .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Default to Admin only for guild
    ];

    try {
        // Register commands globally
        await client.application.commands.set(commands);
        console.log('Successfully registered slash commands globally.');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
};

// Handle Interactions
const handleInteractions = async (interaction, client, defaultBotPersonality) => {
    // Determine context ID (guild ID or user ID for DM) and if it's a DM
    const isDM = interaction.channel.type === 1; // DM channel type
    const contextId = isDM ? interaction.user.id : interaction.guild.id;

    if (interaction.isCommand() && interaction.commandName === COMMAND_NAME) {
        // Check permissions for guild usage
        if (!isDM && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'You need administrator permissions to use this command in a server.', ephemeral: true });
            return;
        }

        // Fetch current settings to pre-fill the modal
        const currentSettings = { ...defaultBotPersonality, ...(await getBotPersonality(contextId, isDM) || {}) };
        const defaultInstructions = await getBotDefaultInstructions(); // Fetch from DB or use hardcoded

        const embed = {
            color: 0xFF0000, // Red color
            title: `⚙️ ${currentSettings.name} Settings`,
            description: `Manage the personality and features of ${currentSettings.name}.`,
            fields: [
                { name: 'Name', value: currentSettings.name || 'N/A', inline: true },
                { name: 'Age', value: currentSettings.age || 'N/A', inline: true },
                { name: 'Gender', value: currentSettings.gender || 'N/A', inline: true },
                { name: 'Mood', value: currentSettings.mood || 'N/A', inline: true },
                { name: 'Image Generation', value: currentSettings.imageGenerationEnabled ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                { name: 'Web Search', value: currentSettings.webSearchEnabled ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                { name: 'Default Instructions', value: currentSettings.defaultInstructions || defaultInstructions, inline: false },
                { name: 'Custom Instructions', value: currentSettings.customInstructions || 'No custom instructions set.', inline: false },
            ],
            footer: {
                text: isDM ? 'These settings apply to your DM conversation.' : 'These settings apply to this server.'
            }
        };

        // Buttons for different setting categories
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('editPersonality')
                    .setLabel('Edit Bot Personality & Instructions')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('toggleFeatures')
                    .setLabel('Toggle Image Gen / Web Search')
                    .setStyle(ButtonStyle.Secondary),
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setChannels')
                    .setLabel('Set Allowed Channels')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('removeChannels')
                    .setLabel('Remove Allowed Channels')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(CLEAR_BUTTON_ID)
                    .setLabel('Clear All Data (Reset Bot)')
                    .setStyle(ButtonStyle.Danger),
            );

        await interaction.reply({
            embeds: [embed],
            components: [row1, row2],
            ephemeral: true // Only visible to the user who invoked the command
        });

    } else if (interaction.isButton()) {
        if (!isDM && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'You need administrator permissions to modify settings in a server.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'editPersonality') {
            const currentSettings = { ...defaultBotPersonality, ...(await getBotPersonality(contextId, isDM) || {}) };
            const defaultInstructions = await getBotDefaultInstructions(); // Fetch from DB or use hardcoded

            const modal = new ModalBuilder()
                .setCustomId(PERSONALITY_MODAL_ID)
                .setTitle('Edit Bot Personality & Instructions');

            const nameInput = new TextInputBuilder()
                .setCustomId('botName')
                .setLabel('Bot Name (max 10 letters)')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(10)
                .setRequired(true)
                .setValue(currentSettings.name);

            const ageInput = new TextInputBuilder()
                .setCustomId('botAge')
                .setLabel('Bot Age (e.g., 15, 20, unknown)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(currentSettings.age);

            const genderInput = new TextInputBuilder()
                .setCustomId('botGender')
                .setLabel('Bot Gender (male/female/transgender)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(currentSettings.gender);

            const moodInput = new TextInputBuilder()
                .setCustomId('botMood')
                .setLabel('Bot Mood (e.g., happy, sad, angry)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(currentSettings.mood);

            const defaultInstructionsInput = new TextInputBuilder()
                .setCustomId('defaultInstructions')
                .setLabel('Default Bot Instructions (limit 1000 words)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(5000) // Characters, not words, adjusting for practical input
                .setValue(defaultInstructions); // Display the actual default or saved default

            const customInstructionsInput = new TextInputBuilder()
                .setCustomId('customInstructions')
                .setLabel('Custom AI Instructions (limit 1000 words)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(5000) // Characters, adjusting for practical input
                .setValue(currentSettings.customInstructions || '');

            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(ageInput),
                new ActionRowBuilder().addComponents(genderInput),
                new ActionRowBuilder().addComponents(moodInput),
                new ActionRowBuilder().addComponents(defaultInstructionsInput),
                new ActionRowBuilder().addComponents(customInstructionsInput)
            );

            await interaction.showModal(modal);

        } else if (interaction.customId === 'toggleFeatures') {
            const currentSettings = { ...defaultBotPersonality, ...(await getBotPersonality(contextId, isDM) || {}) };

            const modal = new ModalBuilder()
                .setCustomId(TOGGLE_FEATURES_MODAL_ID)
                .setTitle('Toggle Bot Features');

            const imageGenInput = new TextInputBuilder()
                .setCustomId('imageGenToggle')
                .setLabel('Enable Image Generation? (yes/no)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(currentSettings.imageGenerationEnabled ? 'yes' : 'no');

            const webSearchInput = new TextInputBuilder()
                .setCustomId('webSearchToggle')
                .setLabel('Enable Web Search? (yes/no)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(currentSettings.webSearchEnabled ? 'yes' : 'no');

            modal.addComponents(
                new ActionRowBuilder().addComponents(imageGenInput),
                new ActionRowBuilder().addComponents(webSearchInput)
            );

            await interaction.showModal(modal);

        } else if (interaction.customId === 'setChannels') {
            if (isDM) {
                await interaction.reply({ content: 'Channel settings are only available in servers, not DMs.', ephemeral: true });
                return;
            }
            const guildChannels = interaction.guild.channels.cache
                .filter(channel => channel.type === 0) // Text channels
                .map(channel => ({
                    label: `#${channel.name}`,
                    value: channel.id,
                }));

            if (guildChannels.length === 0) {
                await interaction.reply({ content: 'No text channels found in this server.', ephemeral: true });
                return;
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(SET_CHANNELS_MENU_ID)
                .setPlaceholder('Select channels to allow the bot to chat in')
                .setMinValues(1)
                .setMaxValues(guildChannels.length > 25 ? 25 : guildChannels.length) // Max 25 options for select menu
                .addOptions(guildChannels.slice(0, 25)); // Discord select menus have a limit of 25 options

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({
                content: 'Select channels where I should exclusively chat. If no channels are set, I will chat in all channels.',
                components: [row],
                ephemeral: true
            });

        } else if (interaction.customId === 'removeChannels') {
            if (isDM) {
                await interaction.reply({ content: 'Channel settings are only available in servers, not DMs.', ephemeral: true });
                return;
            }
            const currentSettings = await getBotSettings(contextId);
            const allowedChannels = currentSettings?.allowedChannels || [];

            if (allowedChannels.length === 0) {
                await interaction.reply({ content: 'No channels are currently set for me to chat in.', ephemeral: true });
                return;
            }

            const allowedChannelOptions = allowedChannels.map(channelId => {
                const channel = interaction.guild.channels.cache.get(channelId);
                return {
                    label: channel ? `#${channel.name}` : `Unknown Channel (${channelId})`,
                    value: channelId,
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(REMOVE_CHANNELS_MENU_ID)
                .setPlaceholder('Select channels to remove from allowed list')
                .setMinValues(1)
                .setMaxValues(allowedChannelOptions.length > 25 ? 25 : allowedChannelOptions.length)
                .addOptions(allowedChannelOptions.slice(0, 25));

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({
                content: 'Select channels to remove from my allowed chat list.',
                components: [row],
                ephemeral: true
            });

        } else if (interaction.customId === CLEAR_BUTTON_ID) {
            await interaction.deferUpdate(); // Acknowledge button click immediately

            const confirmEmbed = {
                color: 0xFFCC00,
                title: '⚠️ Confirm Data Clear',
                description: 'Are you sure you want to clear all bot settings and chat history for this context? This action cannot be undone.',
            };

            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirmClear')
                        .setLabel('Yes, Clear All Data')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancelClear')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
            await interaction.followUp({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });

        } else if (interaction.customId === 'confirmClear') {
            await interaction.deferUpdate(); // Acknowledge button click

            const success = await clearAllData(contextId, isDM);
            if (success) {
                const updatedSettings = { ...defaultBotPersonality };
                await updateBotPersonality(contextId, updatedSettings, isDM); // Re-initialize with defaults

                if (!isDM && interaction.guild) {
                    // Reset role name if it exists and was changed
                    const botMember = await interaction.guild.members.fetch(client.user.id);
                    const oldRole = botMember.roles.cache.find(r => r.name !== updatedSettings.name);
                    if (oldRole) {
                        await oldRole.setName(updatedSettings.name, 'Bot reset to default name');
                        console.log(`Reset role name to '${updatedSettings.name}' in ${interaction.guild.name}`);
                    }
                }

                await interaction.followUp({ content: 'All bot data and settings have been cleared and reset to default!', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'Failed to clear data. Please try again.', ephemeral: true });
            }
        } else if (interaction.customId === 'cancelClear') {
            await interaction.update({ content: 'Data clear cancelled.', components: [], embeds: [] });
        }

    } else if (interaction.isModalSubmit()) {
        if (!isDM && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'You need administrator permissions to modify settings in a server.', ephemeral: true });
            return;
        }

        if (interaction.customId === PERSONALITY_MODAL_ID) {
            const name = interaction.fields.getTextInputValue('botName');
            const age = interaction.fields.getTextInputValue('botAge');
            const gender = interaction.fields.getTextInputValue('botGender').toLowerCase();
            const mood = interaction.fields.getTextInputValue('botMood');
            const defaultInstructions = interaction.fields.getTextInputValue('defaultInstructions');
            const customInstructions = interaction.fields.getTextInputValue('customInstructions');

            // Basic validation for gender
            const validGenders = ['male', 'female', 'transgender'];
            if (!validGenders.includes(gender)) {
                await interaction.reply({ content: 'Invalid gender. Please choose from: male, female, transgender.', ephemeral: true });
                return;
            }

            const updatedData = { name, age, gender, mood, customInstructions, defaultInstructions };
            const settings = await updateBotPersonality(contextId, updatedData, isDM);

            if (settings) {
                await interaction.reply({ content: 'Bot personality settings updated successfully!', ephemeral: true });

                // Update bot role name in the guild if name was changed
                if (!isDM && interaction.guild) {
                    const botMember = await interaction.guild.members.fetch(client.user.id);
                    let currentRole = botMember.roles.cache.find(r => r.name === settings.name);

                    if (!currentRole) {
                        const oldRole = botMember.roles.cache.find(r => r.name !== settings.name);
                        if (oldRole) {
                            await oldRole.setName(settings.name, 'Bot name changed via settings');
                            console.log(`Updated role name to '${settings.name}' in ${interaction.guild.name}`);
                        } else {
                            // If no role exists, create and assign
                            const newRole = await interaction.guild.roles.create({
                                name: settings.name,
                                color: 'Red',
                                reason: 'Bot name updated via settings',
                            });
                            await botMember.roles.add(newRole);
                            console.log(`Created and assigned new role '${settings.name}' in ${interaction.guild.name}`);
                        }
                    }
                }
            } else {
                await interaction.reply({ content: 'Failed to update bot personality settings.', ephemeral: true });
            }

        } else if (interaction.customId === TOGGLE_FEATURES_MODAL_ID) {
            const imageGenToggle = interaction.fields.getTextInputValue('imageGenToggle').toLowerCase();
            const webSearchToggle = interaction.fields.getTextInputValue('webSearchToggle').toLowerCase();

            const imageGenerationEnabled = imageGenToggle === 'yes';
            const webSearchEnabled = webSearchToggle === 'yes';

            const updatedData = { imageGenerationEnabled, webSearchEnabled };
            const settings = await updateBotPersonality(contextId, updatedData, isDM);

            if (settings) {
                await interaction.reply({ content: 'Bot feature toggles updated successfully!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Failed to update bot feature toggles.', ephemeral: true });
            }
        }

    } else if (interaction.isStringSelectMenu()) {
        if (!isDM && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'You need administrator permissions to modify channel settings in a server.', ephemeral: true });
            return;
        }

        if (interaction.customId === SET_CHANNELS_MENU_ID) {
            const selectedChannelIds = interaction.values;
            const currentSettings = await getBotSettings(contextId);
            const existingAllowedChannels = currentSettings?.allowedChannels || [];

            // Add new channels, ensuring no duplicates
            const newAllowedChannels = [...new Set([...existingAllowedChannels, ...selectedChannelIds])];

            const settings = await updateAllowedChannels(contextId, newAllowedChannels);
            if (settings) {
                const channelNames = selectedChannelIds.map(id => `#${interaction.guild.channels.cache.get(id)?.name}`).join(', ');
                await interaction.reply({ content: `Bot will now exclusively chat in: ${channelNames}.`, ephemeral: true });
            } else {
                await interaction.reply({ content: 'Failed to set allowed channels.', ephemeral: true });
            }

        } else if (interaction.customId === REMOVE_CHANNELS_MENU_ID) {
            const selectedChannelIdsToRemove = interaction.values;
            const currentSettings = await getBotSettings(contextId);
            const existingAllowedChannels = currentSettings?.allowedChannels || [];

            // Remove selected channels
            const newAllowedChannels = existingAllowedChannels.filter(id => !selectedChannelIdsToRemove.includes(id));

            const settings = await updateAllowedChannels(contextId, newAllowedChannels);
            if (settings) {
                const channelNames = selectedChannelIdsToRemove.map(id => `#${interaction.guild.channels.cache.get(id)?.name}`).join(', ');
                await interaction.reply({ content: `Bot will no longer chat in: ${channelNames}.`, ephemeral: true });
            } else {
                await interaction.reply({ content: 'Failed to remove allowed channels.', ephemeral: true });
            }
        }
    }
};

module.exports = { registerCommands, handleInteractions };
