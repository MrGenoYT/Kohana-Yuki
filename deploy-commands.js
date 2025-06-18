const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('yukisettings')
        .setDescription('Configure bot settings (Admin only in servers, personal settings in DMs)')
        .toJSON()
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Starting deployment of application commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Successfully deployed application commands globally.');
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();
