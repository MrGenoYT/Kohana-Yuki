const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { getServerSettings, getUserData } = require('../lib/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('yukisettings')
        .setDescription('Configure my settings for this server or your personal settings in DMs.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    async execute(interaction) {
        if (interaction.guild) {
            // Server settings
            const settings = await getServerSettings(interaction.guildId, interaction.client.db);
            const embed = new EmbedBuilder()
                .setTitle(`My Settings in ${interaction.guild.name} ⚙️`)
                .setColor(0xFFB6C1)
                .setDescription('Here you can change how I act and what I can do in this server, babe! 💖')
                .addFields(
                    { name: 'My Name', value: `${settings.name} (max 10 chars)`, inline: true },
                    { name: 'My Age', value: `${settings.age.toString()} (1-99)`, inline: true },
                    { name: 'My Gender', value: `${settings.gender || 'Not set'} (male/female)`, inline: true }, // Added gender
                    { name: 'My Mood', value: `${settings.mood} (max 100 chars, 10 moods)`, inline: false },
                    { name: 'My Behavior', value: `*${settings.behavior.substring(0, Math.min(settings.behavior.length, 100))}...* (max 1000 chars)`, inline: false },
                    { name: 'Drawing Feature', value: settings.imageGeneration ? 'Enabled 🎨' : 'Disabled 🚫', inline: true }, // Renamed
                    { name: 'Web Search', value: settings.webSearch ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                    { name: 'Allowed Channels', value: settings.allowedChannels.length > 0 ? settings.allowedChannels.map(id => `<#${id}>`).join(', ') : 'All channels! uwu', inline: false }
                );

             const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('server_settings_menu')
                        .setPlaceholder('Select a server setting to change! 💖')
                        .addOptions([
                            { label: 'Edit My Persona (Name, Age, Gender, Mood, Behavior)', value: 'edit_persona', description: 'Change how I act and identify.' },
                            { label: 'Manage Features (Drawing, Web Search)', value: 'manage_features', description: 'Toggle my special abilities.' },
                            { label: 'Manage Allowed Channels', value: 'manage_channels', description: 'Control where I can chat.' },
                            { label: 'Reset All Server Settings', value: 'reset_server_settings', description: 'Restore all settings to the default.' }
                        ])
                );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        } else {
            // User settings (in DMs)
            const userData = await getUserData(interaction.user.id, interaction.client.db);
            const embed = new EmbedBuilder()
                .setTitle('Your Personal Settings 💖')
                .setColor(0xFFB6C1)
                .setDescription('Here you can set special instructions for how I interact with you, babe! 💖')
                .addFields(
                    { name: 'Your Custom Instructions', value: `${userData.customInstructions || 'None set yet!'} (max 1000 chars)` }
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

