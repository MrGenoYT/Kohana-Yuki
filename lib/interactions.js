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
            const value = interaction.values[0];
            switch (value) {
                case 'edit_persona':
                    await interaction.deferUpdate(); 
                    const personaDashboardEmbed = new EmbedBuilder()
                        .setTitle('Yuki\'s Persona Dashboard! 💖') // Updated title
                        .setColor(0xFFB6C1)
                        .setDescription('Here you can change my core persona, babe! This is how I will generally behave.');
                    
                    const changePersonaButtonRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('show_persona_modal_button')
                                .setLabel('Change My Persona') // Updated label
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('✍️')
                        );
                    
                    await interaction.editReply({ 
                        embeds: [personaDashboardEmbed], 
                        components: [changePersonaButtonRow] 
                    });
                    break;
                case 'manage_features':
                    await interaction.deferUpdate();
                    await showFeatureToggles(interaction);
                    break;
                case 'manage_channels':
                    await interaction.deferUpdate();
                    await showChannelManager(interaction);
                    break;
                case 'reset_server_settings':
                    await interaction.deferUpdate();
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
                    await interaction.deferUpdate();
                    await updateUserData(interaction.user.id, { customInstructions: '' }, client.db);
                    const clearEmbed = new EmbedBuilder()
                        .setTitle('Instructions Cleared! 💖')
                        .setColor(0xFFB6C1)
                        .setDescription('I\'ve cleared your custom instructions. We can start fresh! 💖');
                    await interaction.editReply({ embeds: [clearEmbed], components: [] });
                    break;
            }
        } else if (interaction.isButton()) {
            switch (mainId) {
                case 'toggle':
                    await interaction.deferUpdate();
                    const feature = args[0];
                    const settings = await getServerSettings(interaction.guildId, client.db);
                    const newValue = !settings[feature];
                    await updateServerSettings(interaction.guildId, { [feature]: newValue }, client.db);
                    await showFeatureToggles(interaction, `I've ${newValue ? 'enabled' : 'disabled'} ${feature === 'imageGeneration' ? 'Image Generation' : 'Web Search'}!`);
                    break;
                case 'show_persona_modal_button':
                    await showPersonaModal(interaction);
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
                    const personaDescription = interaction.fields.getTextInputValue('personaDescriptionInput'); // Get the single input
                    
                    // Simple length validation for the consolidated persona description
                    if (personaDescription.length > 4000) {
                        return interaction.followUp({ content: 'Your persona description cannot exceed 4000 characters, babe!', ephemeral: true });
                    }

                    // Update only the 'behavior' field with the new description
                    await updateServerSettings(interaction.guildId, { behavior: personaDescription }, client.db); 
                    
                    const personaEmbed = new EmbedBuilder()
                        .setTitle('My Persona Updated! 🥰')
                        .setColor(0xFFB6C1)
                        .setDescription('My core persona has been updated! Thanks for the makeover! 🥰');
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
    const modal = new ModalBuilder().setCustomId('personaModal').setTitle('My Persona (About Me)'); // Simplified title
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('personaDescriptionInput') // Single input ID
                .setLabel("Tell me about my persona (Max 4000 chars)") // Simplified label
                .setStyle(TextInputStyle.Paragraph) // Large text area
                .setValue(settings.behavior || '') // Use 'behavior' as the source for the description
                .setPlaceholder('e.g., "I am a friendly AI companion who loves to chat about anime and games. I use positive emojis."')
                .setMaxLength(4000)
        )
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
        .setDescription('Use the menus below to add or remove channels I can chat in. If no channels are selected, I can chat everywhere!\n\n**Current Channels:** ' + (settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels! 💖'));

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

