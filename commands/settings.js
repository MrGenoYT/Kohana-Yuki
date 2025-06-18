const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const Guild = require('../models/Guild');
const User = require('../models/User');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure bot settings'),
    
    async execute(interaction) {
        const isGuild = interaction.guild !== null;
        const isDM = !isGuild;
        
        if (isGuild && !interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({ 
                content: 'You need Administrator permissions to use this command.', 
                ephemeral: true 
            });
        }
        
        if (isGuild) {
            await showGuildSettings(interaction);
        } else {
            await showUserSettings(interaction);
        }
    }
};

const showGuildSettings = async (interaction) => {
    let guildSettings = await Guild.findOne({ guildId: interaction.guild.id });
    
    if (!guildSettings) {
        return await interaction.reply({ 
            content: 'Guild settings not found. Please ensure the bot has proper permissions.', 
            ephemeral: true 
        });
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Bot Configuration Panel')
        .setDescription('Configure your bot settings using the menu below')
        .addFields(
            { name: 'Current Name', value: guildSettings.botName, inline: true },
            { name: 'Current Age', value: guildSettings.botAge.toString(), inline: true },
            { name: 'Current Gender', value: guildSettings.botGender, inline: true },
            { name: 'Current Mood', value: guildSettings.botMood.join(', ') || 'None set', inline: false },
            { name: 'Image Generation', value: guildSettings.imageGeneration ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Web Search', value: guildSettings.webSearch ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Allowed Channels', value: guildSettings.allowedChannels.length > 0 ? `${guildSettings.allowedChannels.length} channels` : 'All channels', inline: true }
        )
        .setColor(0xFF0000)
        .setFooter({ text: 'Use the dropdown menu to modify settings' });
    
    if (guildSettings.imageGeneration) {
        embed.addFields({ 
            name: 'Image Generation Command', 
            value: `hi ${guildSettings.botName} can you draw a [description] for me?`, 
            inline: false 
        });
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('settings_menu')
        .setPlaceholder('Select a setting to modify')
        .addOptions([
            {
                label: 'Bot Identity',
                description: 'Change name, age, gender',
                value: 'identity'
            },
            {
                label: 'Bot Mood',
                description: 'Set current mood states',
                value: 'mood'
            },
            {
                label: 'Custom Behavior',
                description: 'Add behavior instructions',
                value: 'behavior'
            },
            {
                label: 'Custom Personality',
                description: 'Override personality settings',
                value: 'personality'
            },
            {
                label: 'Feature Toggles',
                description: 'Enable/disable features',
                value: 'features'
            },
            {
                label: 'Channel Permissions',
                description: 'Set allowed channels',
                value: 'channels'
            },
            {
                label: 'Clear All Settings',
                description: 'Reset to defaults',
                value: 'clear'
            }
        ]);
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
};

const showUserSettings = async (interaction) => {
    let user = await User.findOne({ userId: interaction.user.id });
    
    if (!user) {
        user = new User({
            userId: interaction.user.id,
            username: interaction.user.username
        });
        await user.save();
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Personal Settings')
        .setDescription('Configure your personal preferences')
        .addFields(
            { name: 'Your Mood', value: user.preferences.mood.join(', ') || 'None set', inline: true },
            { name: 'Preferred Name', value: user.preferences.preferredName || 'None set', inline: true },
            { name: 'Custom Instructions', value: user.preferences.customInstructions || 'None set', inline: false }
        )
        .setColor(0xFF0000)
        .setFooter({ text: 'Personal settings for DM conversations' });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('user_settings_menu')
        .setPlaceholder('Select a setting to modify')
        .addOptions([
            {
                label: 'Set Mood',
                description: 'Change your current mood',
                value: 'user_mood'
            },
            {
                label: 'Set Preferred Name',
                description: 'How the bot should address you',
                value: 'user_name'
            },
            {
                label: 'Custom Instructions',
                description: 'Personal behavior instructions',
                value: 'user_instructions'
            }
        ]);
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
};
