const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getServerSettings, updateServerSettings, defaultSettings, getUserData, updateUserData } = require('./database');
const { handleImageGeneration } = require('./ai');

async function handleInteraction(interaction, client) {
    try {
        if (interaction.customId && interaction.customId.startsWith('confirmimagegen')) {
            return await handleImageGeneration(interaction);
        }

        if (!interaction.isMessageComponent()) return;

        const [mainId, ...args] = interaction.customId.split('_');

        if (interaction.isStringSelectMenu()) {
            await interaction.deferUpdate();
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
                        .setTitle('Settings Reset Complete! ✨')
                        .setColor(0xFFB6C1)
                        .setDescription('I\'ve reset all server settings to their defaults, babe! 💖');
                    await interaction.editReply({ embeds: [resetEmbed], components: [] });
                    break;
                case 'edit_user_instructions':
                    await showUserInstructionsModal(interaction);
                    break;
                case 'clear_user_instructions':
                    await updateUserData(interaction.user.id, { customInstructions: '' }, client.db);
                    const clearEmbed = new EmbedBuilder()
                        .setTitle('Instructions Cleared! 💖')
                        .setColor(0xFFB6C1)
                        .setDescription('I\'ve cleared your custom instructions. We can start fresh! 💖');
                    await interaction.editReply({ embeds: [clearEmbed], components: [] });
                    break;
            }
        } else if (interaction.isButton()) {
            await interaction.deferUpdate();
            switch (mainId) {
                case 'toggle':
                    const feature = args[0];
                    const settings = await getServerSettings(interaction.guildId, client.db);
                    const newValue = !settings[feature];
                    await updateServerSettings(interaction.guildId, { [feature]: newValue }, client.db);
                    await showFeatureToggles(interaction, `I've ${newValue ? 'enabled' : 'disabled'} ${feature === 'imageGeneration' ? 'Image Generation' : 'Web Search'}!`);
                    break;
            }
        } else if (interaction.isChannelSelectMenu()) {
            await interaction.deferUpdate();
            if (mainId === 'addchannels') {
                const settings = await getServerSettings(interaction.guildId, client.db);
                const updatedChannels = Array.from(new Set([...settings.allowedChannels, ...interaction.values]));
                await updateServerSettings(interaction.guildId, { allowedChannels: updatedChannels }, client.db);
                
                const addEmbed = new EmbedBuilder()
                    .setTitle('Channels Added! ✨')
                    .setColor(0xFFB6C1)
                    .setDescription(`Okay, babe! I can now talk in ${interaction.values.map(id => `<#${id}>`).join(', ')}! uwu`);
                await interaction.editReply({ embeds: [addEmbed], components: [] });
            } else if (mainId === 'removechannels') {
                const settings = await getServerSettings(interaction.guildId, client.db);
                const updatedChannels = settings.allowedChannels.filter(id => !interaction.values.includes(id));
                await updateServerSettings(interaction.guildId, { allowedChannels: updatedChannels }, client.db);
                
                const removeEmbed = new EmbedBuilder()
                    .setTitle('Channels Removed! 🥺')
                    .setColor(0xFFB6C1)
                    .setDescription(`Aww, okay... I won't talk in ${interaction.values.map(id => `<#${id}>`).join(', ')} anymore. 🥺`);
                await interaction.editReply({ embeds: [removeEmbed], components: [] });
            }
        } else if (interaction.isModalSubmit()) {
            await interaction.deferReply({ ephemeral: true });
            switch (mainId) {
                case 'personaModal':
                    const name = interaction.fields.getTextInputValue('nameInput');
                    const age = parseInt(interaction.fields.getTextInputValue('ageInput'));
                    const gender = interaction.fields.getTextInputValue('genderInput');
                    const behavior = interaction.fields.getTextInputValue('behaviorInput');
                    const personality = interaction.fields.getTextInputValue('personalityInput');
                    const mood = interaction.fields.getTextInputValue('moodInput');

                    if (name.length > 10) {
                        return interaction.followUp({ content: 'Name cannot exceed 10 characters, babe!', ephemeral: true });
                    }
                    if (isNaN(age)) {
                        return interaction.followUp({ content: 'Age has to be a number, babe!', ephemeral: true });
                    }
                    if (!['female', 'male'].includes(gender.toLowerCase())) {
                        return interaction.followUp({ content: 'Gender must be "female" or "male", babe!', ephemeral: true });
                    }
                    if (behavior.split(/\s+/).length > 1000 || behavior.length > 4000) { // Check both word count and Discord API char limit
                        return interaction.followUp({ content: 'Behavior cannot exceed 1000 words or 4000 characters, babe!', ephemeral: true });
                    }
                    const moodsArray = mood.split(',').map(m => m.trim()).filter(m => m.length > 0);
                    if (moodsArray.length > 10 || mood.split(/\s+/).length > 100 || mood.length > 700) { // Check moods constraints
                        return interaction.followUp({ content: 'Moods cannot exceed 10 entries, 100 words total, or 700 characters, babe!', ephemeral: true });
                    }

                    await updateServerSettings(interaction.guildId, { name, age, gender, behavior, personality, mood }, client.db);
                    
                    const personaEmbed = new EmbedBuilder()
                        .setTitle('Persona Updated! 🥰')
                        .setColor(0xFFB6C1)
                        .setDescription('My persona has been updated! Thanks for the makeover! 🥰')
                        .addFields(
                            { name: 'New Name', value: name, inline: true },
                            { name: 'New Age', value: age.toString(), inline: true },
                            { name: 'New Gender', value: gender, inline: true }
                        );
                    await interaction.followUp({ embeds: [personaEmbed], ephemeral: true });
                    break;
                case 'userInstructionsModal':
                    const customInstructions = interaction.fields.getTextInputValue('instructionsInput');
                    await updateUserData(interaction.user.id, { customInstructions }, client.db);
                    
                    const instructionsEmbed = new EmbedBuilder()
                        .setTitle('Instructions Saved! 💖')
                        .setColor(0xFFB6C1)
                        .setDescription('I\'ve saved your special instructions, babe! I\'ll keep them in mind. 💖');
                    await interaction.followUp({ embeds: [instructionsEmbed], ephemeral: true });
                    break;
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Something went wrong, babe! 🥺', ephemeral: true }).catch(() => {});
        } else if (interaction.deferred) {
            await interaction.followUp({ content: 'Something went wrong, babe! 🥺', ephemeral: true }).catch(() => {});
        }
    }
}

async function showPersonaModal(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const modal = new ModalBuilder().setCustomId('personaModal').setTitle('Edit My Persona & Behavior');
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nameInput').setLabel("My Name (max 10 chars)").setStyle(TextInputStyle.Short).setValue(settings.name).setMaxLength(10)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ageInput').setLabel("My Age (numbers only)").setStyle(TextInputStyle.Short).setValue(String(settings.age))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('genderInput').setLabel("My Gender (female/male)").setStyle(TextInputStyle.Short).setValue(settings.gender).setPlaceholder('female or male')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('behaviorInput').setLabel("My Behavior (max 1000 words / 4000 chars)").setStyle(TextInputStyle.Paragraph).setValue(settings.behavior).setMaxLength(4000)), // Adjusted max length
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('personalityInput').setLabel("My Personality").setStyle(TextInputStyle.Paragraph).setValue(settings.personality)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('moodInput').setLabel("My Moods (max 10, 100 words / 700 chars total)").setStyle(TextInputStyle.Paragraph).setValue(settings.mood).setMaxLength(700)), // Adjusted max length
    );
    await interaction.showModal(modal);
}

async function showUserInstructionsModal(interaction) {
    const userData = await getUserData(interaction.user.id, interaction.client.db);
    const modal = new ModalBuilder().setCustomId('userInstructionsModal').setTitle('Your Custom Instructions');
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('instructionsInput')
                .setLabel("What should I know about you?")
                .setStyle(TextInputStyle.Paragraph)
                .setValue(userData.customInstructions || '')
                .setPlaceholder('e.g., "Always call me Captain." or "I prefer short and direct answers."')
        )
    );
    await interaction.showModal(modal);
}

async function showFeatureToggles(interaction, message = null) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const embed = new EmbedBuilder()
        .setTitle('Manage Features')
        .setColor(0xFFB6C1)
        .setDescription('Enable or disable my special abilities!')
        .addFields(
            { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled ✅' : 'Disabled ❌', inline: true },
            { name: 'Web Search', value: settings.webSearch ? 'Enabled ✅' : 'Disabled ❌', inline: true }
        );
    
    if (message) {
        embed.setFooter({ text: message });
    }
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`toggle_imageGeneration`)
                .setLabel('Toggle Image Generation')
                .setStyle(settings.imageGeneration ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.imageGeneration ? '✅' : '❌'),
            new ButtonBuilder()
                .setCustomId(`toggle_webSearch`)
                .setLabel('Toggle Web Search')
                .setStyle(settings.webSearch ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.webSearch ? '✅' : '❌')
        );
    
    await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showChannelManager(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const embed = new EmbedBuilder()
        .setTitle('Manage Allowed Channels')
        .setColor(0xFFB6C1)
        .setDescription('Use the menus below to add or remove channels I can chat in. If no channels are selected, I can chat everywhere!\n\n**Current Channels:** ' + (settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels! uwu'));

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

