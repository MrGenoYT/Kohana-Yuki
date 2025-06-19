const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getServerSettings, updateServerSettings, defaultSettings, getUserData, updateUserData } = require('./database');
const { handleDrawingRequest } = require('./ai'); // Renamed handleImageGeneration to handleDrawingRequest

// Helper function to create and show a modal
async function showModal(interaction, customId, title, fields) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    for (const field of fields) {
        const textInput = new TextInputBuilder()
            .setCustomId(field.customId)
            .setLabel(field.label)
            .setStyle(field.style)
            .setRequired(field.required)
            .setMinLength(field.minLength || 0)
            .setMaxLength(field.maxLength || 4000) // Default to Discord's max, will be overridden by specific limits
            .setPlaceholder(field.placeholder || '')
            .setValue(field.value || '');

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    }

    await interaction.showModal(modal);
}

async function handleInteraction(interaction, client) {
    try {
        // Confirm image generation (now drawing request)
        if (interaction.customId && interaction.customId.startsWith('confirmdrawing')) {
            return await handleDrawingRequest(interaction);
        }

        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            await interaction.deferReply({ ephemeral: true }); // Defer reply for modal submissions

            const { customId } = interaction;

            if (customId === 'edit_persona_modal') {
                const name = interaction.fields.getTextInputValue('persona_name');
                const age = parseInt(interaction.fields.getTextInputValue('persona_age'));
                const gender = interaction.fields.getTextInputValue('persona_gender');
                const mood = interaction.fields.getTextInputValue('persona_mood');
                const behavior = interaction.fields.getTextInputValue('persona_behavior');

                // Validate inputs
                if (name.length > 10) {
                    return await interaction.editReply({ content: 'Babe, my name can\'t be longer than 10 characters! 🥺' });
                }
                if (isNaN(age) || age < 1 || age > 99) { // Simple age validation
                    return await interaction.editReply({ content: 'Babe, age must be a numeric value between 1 and 99! 🥺' });
                }
                if (!['male', 'female'].includes(gender.toLowerCase())) {
                    return await interaction.editReply({ content: 'Babe, gender must be either "male" or "female"! 🥺' });
                }
                if (mood.split(',').length > 10 || mood.length > 100) {
                     return await interaction.editReply({ content: 'Babe, you can only set up to 10 moods, and they should be within 100 characters! 🥺' });
                }
                if (behavior.length > 1000) {
                    return await interaction.editReply({ content: 'Babe, my behavior description can\'t be longer than 1000 characters! 🥺' });
                }


                await updateServerSettings(interaction.guildId, { name, age, gender, mood, behavior }, client.db);
                await interaction.editReply({ content: 'Yay! My persona settings have been updated, babe! 💖' });
            } else if (customId === 'edit_user_instructions_modal') {
                const customInstructions = interaction.fields.getTextInputValue('user_instructions');
                if (customInstructions.length > 1000) {
                    return await interaction.editReply({ content: 'Babe, your custom instructions can\'t be longer than 1000 characters! 🥺' });
                }
                await updateUserData(interaction.user.id, { customInstructions }, client.db);
                await interaction.editReply({ content: 'Yay! Your personal instructions have been updated, babe! 💖' });
            }
            return;
        }

        // Only process message components (buttons, select menus) after this point
        if (!interaction.isMessageComponent()) return;

        await interaction.deferUpdate(); // Defer updates for all message components

        const [mainId, ...args] = interaction.customId.split('_');

        if (interaction.isStringSelectMenu()) {
            const value = interaction.values[0];
            switch (value) {
                case 'edit_persona':
                    await showPersonaModal(interaction);
                    break;
                case 'manage_features':
                    await showFeatureToggles(interaction);
                    break;
                case 'manage_channels':
                    await showChannelManager(interaction);
                    break;
                case 'reset_server_settings':
                    await updateServerSettings(interaction.guildId, defaultSettings, client.db);
                    const resetEmbed = new EmbedBuilder()
                        .setTitle('Settings Reset! 🔄')
                        .setColor(0xFFB6C1)
                        .setDescription('All server settings have been reset to default, babe! ✨');
                    await interaction.editReply({ embeds: [resetEmbed], components: [] }); // Clear components after reset
                    break;
                case 'edit_user_instructions':
                    await showUserInstructionsModal(interaction);
                    break;
                case 'clear_user_instructions':
                    await updateUserData(interaction.user.id, { customInstructions: '' }, client.db);
                    const clearEmbed = new EmbedBuilder()
                        .setTitle('Instructions Cleared! 🗑️')
                        .setColor(0xFFB6C1)
                        .setDescription('Your personal instructions have been cleared, babe! ✨');
                    await interaction.editReply({ embeds: [clearEmbed] });
                    break;
            }
        } else if (interaction.isButton()) {
            switch (mainId) {
                case 'toggleimagegen':
                    const currentSettings = await getServerSettings(interaction.guildId, client.db);
                    await updateServerSettings(interaction.guildId, { imageGeneration: !currentSettings.imageGeneration }, client.db);
                    await showFeatureToggles(interaction); // Refresh the feature toggles view
                    break;
                case 'togglewebsearch':
                    const currentSettingsSearch = await getServerSettings(interaction.guildId, client.db);
                    await updateServerSettings(interaction.guildId, { webSearch: !currentSettingsSearch.webSearch }, client.db);
                    await showFeatureToggles(interaction); // Refresh the feature toggles view
                    break;
            }
        } else if (interaction.isChannelSelectMenu()) {
            if (mainId === 'addchannels') {
                const selectedChannels = interaction.values;
                const settings = await getServerSettings(interaction.guildId, client.db);
                const newAllowedChannels = [...new Set([...settings.allowedChannels, ...selectedChannels])];
                await updateServerSettings(interaction.guildId, { allowedChannels: newAllowedChannels }, client.db);
                await showChannelManager(interaction); // Refresh the channel manager view
            } else if (mainId === 'removechannels') {
                const selectedChannels = interaction.values;
                const settings = await getServerSettings(interaction.guildId, client.db);
                const newAllowedChannels = settings.allowedChannels.filter(id => !selectedChannels.includes(id));
                await updateServerSettings(interaction.guildId, { allowedChannels: newAllowedChannels }, client.db);
                await showChannelManager(interaction); // Refresh the channel manager view
            }
        }

    } catch (error) {
        console.error('Error in handleInteraction:', error);
        // If deferUpdate was called, use editReply; otherwise, use reply.
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'Oh no! Something went wrong while handling your request, babe! 🥺', ephemeral: true });
        } else {
            await interaction.reply({ content: 'Oh no! Something went wrong while handling your request, babe! 🥺', ephemeral: true });
        }
    }
}

async function showPersonaModal(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    await showModal(interaction, 'edit_persona_modal', 'Edit My Persona', [
        {
            customId: 'persona_name',
            label: 'My Name (max 10 chars)',
            style: TextInputStyle.Short,
            required: true,
            maxLength: 10,
            value: settings.name
        },
        {
            customId: 'persona_age',
            label: 'My Age (numeric, 1-99)',
            style: TextInputStyle.Short,
            required: true,
            value: settings.age.toString()
        },
        {
            customId: 'persona_gender',
            label: 'My Gender (male/female)',
            style: TextInputStyle.Short,
            required: true,
            value: settings.gender || 'female' // Default to female if not set
        },
        {
            customId: 'persona_mood',
            label: 'My Moods (e.g., cute, flirty - max 100 chars, 10 moods)',
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: 100,
            value: settings.mood
        },
        {
            customId: 'persona_behavior',
            label: 'My Behavior (max 1000 chars)',
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: 1000,
            value: settings.behavior
        }
    ]);
}

async function showUserInstructionsModal(interaction) {
    const userData = await getUserData(interaction.user.id, interaction.client.db);
    await showModal(interaction, 'edit_user_instructions_modal', 'Edit Your Personal Instructions', [
        {
            customId: 'user_instructions',
            label: 'Your Custom Instructions for me (max 1000 chars)',
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: 1000,
            value: userData.customInstructions || ''
        }
    ]);
}


async function showFeatureToggles(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const embed = new EmbedBuilder()
        .setTitle('Manage Features! ✨')
        .setColor(0xFFB6C1)
        .setDescription('Toggle my super cool features on or off, babe! 💖');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('toggleimagegen')
                .setLabel('Drawing Feature')
                .setStyle(settings.imageGeneration ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.imageGeneration ? '🎨' : '🚫'), // Changed emoji for drawing
            new ButtonBuilder()
                .setCustomId('togglewebsearch')
                .setLabel('Web Search')
                .setStyle(settings.webSearch ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.webSearch ? '✅' : '❌')
        );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showChannelManager(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const embed = new EmbedBuilder()
        .setTitle('Manage Allowed Channels 💬')
        .setColor(0xFFB6C1)
        .setDescription('Use the menus below to add or remove channels I can chat in. If no channels are selected, I can chat everywhere!\\n\\n**Current Channels:** ' + (settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels! uwu'));

    const addMenu = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('addchannels')
            .setPlaceholder('➕ Click to ADD channels!')
            .setMinValues(1)
            .setMaxValues(10)
            .addChannelTypes(ChannelType.GuildText)
    );
    const removeMenu = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('removechannels')
            .setPlaceholder('➖ Click to REMOVE channels!')
            .setMinValues(1)
            .setMaxValues(10)
            .addChannelTypes(ChannelType.GuildText)
    );

    await interaction.editReply({ embeds: [embed], components: [addMenu, removeMenu] });
}

module.exports = { handleInteraction };

    
