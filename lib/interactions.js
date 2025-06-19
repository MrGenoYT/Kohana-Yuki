const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getServerSettings, updateServerSettings, defaultSettings, getUserData, updateUserData } = require('./database');

async function handleInteraction(interaction, client) {
    if (!interaction.isMessageComponent()) return;

    await interaction.deferUpdate();
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
                await interaction.followUp({ content: 'I\'ve reset all server settings to their defaults, babe! ✨', ephemeral: true });
                break;
            case 'edit_user_instructions':
                 await showUserInstructionsModal(interaction);
                 break;
            case 'clear_user_instructions':
                 await updateUserData(interaction.user.id, { customInstructions: '' }, client.db);
                 await interaction.followUp({ content: 'I\'ve cleared your custom instructions. We can start fresh! 💖', ephemeral: true });
                 break;
        }
    } else if (interaction.isButton()) {
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
         if (mainId === 'addchannels') {
            const settings = await getServerSettings(interaction.guildId, client.db);
            const updatedChannels = Array.from(new Set([...settings.allowedChannels, ...interaction.values]));
            await updateServerSettings(interaction.guildId, { allowedChannels: updatedChannels }, client.db);
            await interaction.followUp({ content: `Okay, babe! I can now talk in ${interaction.values.map(id => `<#${id}>`).join(', ')}! uwu`, ephemeral: true });
        } else if (mainId === 'removechannels') {
            const settings = await getServerSettings(interaction.guildId, client.db);
            const updatedChannels = settings.allowedChannels.filter(id => !interaction.values.includes(id));
            await updateServerSettings(interaction.guildId, { allowedChannels: updatedChannels }, client.db);
            await interaction.followUp({ content: `Aww, okay... I won't talk in ${interaction.values.map(id => `<#${id}>`).join(', ')} anymore. 🥺`, ephemeral: true });
        }
    } else if (interaction.isModalSubmit()) {
        switch (mainId) {
            case 'personaModal':
                const name = interaction.fields.getTextInputValue('nameInput');
                const age = parseInt(interaction.fields.getTextInputValue('ageInput'));
                const gender = interaction.fields.getTextInputValue('genderInput');
                const behavior = interaction.fields.getTextInputValue('behaviorInput');
                const personality = interaction.fields.getTextInputValue('personalityInput');

                if (isNaN(age)) {
                    return interaction.followUp({ content: 'Age has to be a number, babe!', ephemeral: true });
                }

                await updateServerSettings(interaction.guildId, { name, age, gender, behavior, personality }, client.db);
                await interaction.followUp({ content: 'My persona has been updated! Thanks for the makeover! 🥰', ephemeral: true });
                break;
            case 'userInstructionsModal':
                 const customInstructions = interaction.fields.getTextInputValue('instructionsInput');
                 await updateUserData(interaction.user.id, { customInstructions }, client.db);
                 await interaction.followUp({ content: 'I\'ve saved your special instructions, babe! I\'ll keep them in mind. 💖', ephemeral: true });
                 break;
        }
    }
}

async function showPersonaModal(interaction) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const modal = new ModalBuilder().setCustomId('personaModal').setTitle('Edit My Persona & Behavior');
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nameInput').setLabel("My Name").setStyle(TextInputStyle.Short).setValue(settings.name)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ageInput').setLabel("My Age").setStyle(TextInputStyle.Short).setValue(String(settings.age))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('genderInput').setLabel("My Gender").setStyle(TextInputStyle.Short).setValue(settings.gender)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('behaviorInput').setLabel("My Behavior").setStyle(TextInputStyle.Paragraph).setValue(settings.behavior)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('personalityInput').setLabel("My Personality").setStyle(TextInputStyle.Paragraph).setValue(settings.personality)),
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

async function showFeatureToggles(interaction, followUpContent = null) {
    const settings = await getServerSettings(interaction.guildId, interaction.client.db);
    const embed = new EmbedBuilder().setTitle('Manage Features').setColor(0xFFB6C1).setDescription('Enable or disable my special abilities!');
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`toggle_imageGeneration`)
                .setLabel('Image Generation')
                .setStyle(settings.imageGeneration ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.imageGeneration ? '✅' : '❌'),
            new ButtonBuilder()
                .setCustomId(`toggle_webSearch`)
                .setLabel('Web Search')
                .setStyle(settings.webSearch ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(settings.webSearch ? '✅' : '❌')
        );
    if(followUpContent) {
        await interaction.followUp({ content: followUpContent, ephemeral: true });
    }
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
