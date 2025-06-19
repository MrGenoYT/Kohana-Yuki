const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getServerSettings, getUserData } = require('../lib/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('yukisettings')
        .setDescription('Configure my settings for this server or your personal settings in DMs.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    async execute(interaction) {
        if (interaction.guild) {
            const settings = await getServerSettings(interaction.guildId, interaction.client.db);
            const embed = new EmbedBuilder()
                .setTitle(`My Settings in ${interaction.guild.name}`)
                .setColor(0xFFB6C1)
                .setDescription('Here you can change how I act and what I can do in this server, babe!')
                .addFields(
                    { name: 'My Name', value: settings.name, inline: true },
                    { name: 'My Age', value: settings.age.toString(), inline: true },
                    { name: 'Image Generation', value: settings.imageGeneration ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                    { name: 'Web Search', value: settings.webSearch ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                    { name: 'Behavior', value: `*${settings.behavior.substring(0, Math.min(settings.behavior.length, 100))}...*` },
                    { name: 'Allowed Channels', value: settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels! uwu' }
                );

            // New action row for the "Edit Persona & Behavior" button
            const personaButtonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('edit_persona_button') // New custom ID for the button
                        .setLabel('Edit Persona & Behavior')
                        .setStyle(ButtonStyle.Primary) // A primary style button
                        .setEmoji('💅') // A fun emoji!
                );

            // Existing action row for other settings in a select menu
            const otherSettingsRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('server_settings_menu')
                        .setPlaceholder('Select other settings to change! ✨')
                        .addOptions([
                            // Removed 'edit_persona' from here as it's now a dedicated button
                            { label: 'Manage Features', value: 'manage_features', description: 'Enable or disable image generation and web search.' },
                            { label: 'Manage Allowed Channels', value: 'manage_channels', description: 'Choose which channels I can chat in.' },
                            { label: 'Reset All Server Settings', value: 'reset_server_settings', description: 'Restore all settings to the default.' }
                        ])
                );
            await interaction.reply({ embeds: [embed], components: [personaButtonRow, otherSettingsRow], ephemeral: true });

        } else {
            // This block is for DM settings, no changes needed here related to persona button
            const userData = await getUserData(interaction.user.id, interaction.client.db);
            const embed = new EmbedBuilder()
                .setTitle('Your Personal Settings')
                .setColor(0xFFB6C1)
                .setDescription('Here you can set special instructions for how I interact with you, babe! 💖')
                .addFields(
                    { name: 'Your Custom Instructions', value: userData.customInstructions || 'None set yet!' }
                );
             const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('user_settings_menu')
                        .setPlaceholder('Select a setting to change! 💖')
                        .addOptions([
                             { label: 'Edit Custom Instructions', value: 'edit_user_instructions', description: 'Give me special instructions for our chats.' },
                             { label: 'Clear Custom Instructions', value: 'clear_user_instructions', description: 'Remove your personal instructions.' }
                        ])
                );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
    },
};

