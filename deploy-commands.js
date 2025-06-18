const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Define the slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('yukisettings')
        .setDescription('Configure bot settings (Admin only in servers, personal settings in DMs)')
        .toJSON()
    // Add more SlashCommandBuilders here if you introduce more commands
];

// Initialize REST client with your bot's token
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Immediately-invoked async function to deploy commands
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // Deploy commands globally (or to specific guilds for faster updates during development)
        // For global commands: Routes.applicationCommands(process.env.CLIENT_ID)
        // For guild-specific commands: Routes.applicationGuildCommands(process.env.CLIENT_ID, 'YOUR_GUILD_ID')
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), // This deploys globally
            { body: commands }
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();

