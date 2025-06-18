// src/index.js
require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Collection, PermissionsBitField } = require('discord.js');
const { connectDB } = require('./database/mongo');
const { registerCommands, handleInteractions } = require('./commands/settings');
const { getBotPersonality, updateBotPersonality, getChatHistory, saveChatHistory, getBotSettings, getBotDefaultInstructions } = require('./database/mongo');
const { generateText, generateImage, decideToReply } = require('./ai/gemini');
const { fetchGif } = require('./utils/helpers');

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Simple health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'Kohana Yuki Discord Bot is running!',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`Express server is running on port ${PORT}`);
});

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// Create a collection for commands
client.commands = new Collection();

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const TENOR_API_KEY = process.env.TENOR_API_KEY;

// Default bot personality (can be overwritten by settings)
const defaultBotPersonality = {
    name: 'Kohana Yuki',
    age: '15',
    gender: 'female',
    mood: 'happy',
    customInstructions: 'I live in Tokyo, and I like to watch anime and play games. I consider myself a human.',
    imageGenerationEnabled: false,
    webSearchEnabled: false
};

// --- Discord Client Events ---

// Bot Ready Event
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await connectDB();
    console.log('MongoDB connected.');

    // Register slash commands globally (for simplicity, can be per-guild if needed)
    await registerCommands(client, DISCORD_CLIENT_ID);
    console.log('Slash commands registered.');
});

// Guild Join Event (Bot joins a server)
client.on('guildCreate', async (guild) => {
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
    try {
        // Create a role named "Kohana Yuki" in red
        let role = guild.roles.cache.find(r => r.name === defaultBotPersonality.name);
        if (!role) {
            role = await guild.roles.create({
                name: defaultBotPersonality.name,
                color: 'Red',
                reason: 'Bot self-assigned role for identity',
            });
            console.log(`Created role '${defaultBotPersonality.name}' in ${guild.name}`);
        }

        // Assign the role to the bot
        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.roles.cache.has(role.id)) {
            await botMember.roles.add(role);
            console.log(`Assigned role '${defaultBotPersonality.name}' to bot in ${guild.name}`);
        }

        // Initialize default settings for the new guild
        await updateBotPersonality(guild.id, defaultBotPersonality);
        console.log(`Initialized default settings for guild ${guild.name}`);

    } catch (error) {
        console.error(`Error during guildCreate for ${guild.name}:`, error);
    }
});

// Interaction Create Event (Slash Commands, Buttons, Modals, Select Menus)
client.on('interactionCreate', async (interaction) => {
    // Handle /settings command interactions
    await handleInteractions(interaction, client, defaultBotPersonality);
});

// Message Create Event (Handling AI responses)
client.on('messageCreate', async (message) => {
    // Ignore bot's own messages
    if (message.author.bot) return;

    // Determine if it's a DM or guild message
    const isDM = message.channel.type === 1; // DM channel type

    // Get bot settings for the context (guild or user)
    let botSettings;
    let botIdForContext;
    if (isDM) {
        botIdForContext = message.author.id; // Use user ID for DM context
        botSettings = await getBotPersonality(message.author.id, true); // True for isDM
    } else {
        botIdForContext = message.guild.id; // Use guild ID for server context
        botSettings = await getBotPersonality(message.guild.id, false); // False for isDM

        // Check if the bot should only chat in specific channels
        const guildSettings = await getBotSettings(message.guild.id);
        const allowedChannels = guildSettings?.allowedChannels || [];

        if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
            return; // Ignore messages in channels not explicitly allowed
        }
    }

    // Apply default personality if no custom settings exist
    const currentBotPersonality = { ...defaultBotPersonality, ...(botSettings || {}) };

    // Update bot role name if the name was changed in settings
    if (!isDM && message.guild) {
        const botMember = await message.guild.members.fetch(client.user.id);
        let currentBotRole = botMember.roles.cache.find(r => r.name === currentBotPersonality.name);

        if (!currentBotRole) {
            // Find old role if name changed
            const oldRole = botMember.roles.cache.find(r => r.name === defaultBotPersonality.name || r.name === botSettings?.name);
            if (oldRole) {
                await oldRole.setName(currentBotPersonality.name, 'Bot name changed via settings');
                currentBotRole = oldRole;
                console.log(`Updated role name to '${currentBotPersonality.name}' in ${message.guild.name}`);
            } else {
                // If no role exists, create a new one
                currentBotRole = await message.guild.roles.create({
                    name: currentBotPersonality.name,
                    color: 'Red',
                    reason: 'Bot name updated via settings and role not found',
                });
                await botMember.roles.add(currentBotRole);
                console.log(`Created and assigned new role '${currentBotPersonality.name}' in ${message.guild.name}`);
            }
        }
    }

    // Get chat history for context
    const chatHistory = await getChatHistory(botIdForContext, message.author.id, isDM);

    // Construct prompt for AI
    let userPrompt = message.content;
    let baseInstructions = currentBotPersonality.customInstructions;
    if (baseInstructions.trim() === '') {
        baseInstructions = await getBotDefaultInstructions(); // Fetch default instructions from DB if custom is empty
    }

    const fullPrompt = `You are ${currentBotPersonality.name}, a ${currentBotPersonality.age} year old ${currentBotPersonality.gender} human living in Tokyo. Your current mood is ${currentBotPersonality.mood}. ${baseInstructions} You are talking to ${message.author.username}. Remember their name is ${message.author.username}. Only reply when necessary. Do not reply to every message. Avoid being overly talkative.`;

    let imageBase64 = null;
    let isImagePrompt = false;

    // Check for attachments for OCR/Image Generation
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            // Attempt to fetch and convert image to base64 for Gemini Vision
            try {
                const response = await fetch(attachment.url);
                const buffer = await response.buffer();
                imageBase64 = buffer.toString('base64');
                isImagePrompt = true;
                console.log('Image attachment detected and converted to base64.');
            } catch (error) {
                console.error('Error processing image attachment:', error);
            }
        }
    }

    // Determine if the bot should reply based on AI analysis
    const shouldReply = await decideToReply(fullPrompt, userPrompt, chatHistory);

    if (shouldReply) {
        message.channel.sendTyping(); // Show typing indicator

        try {
            let replyContent = '';
            let imageUrl = null;

            // Handle image generation request if toggled on
            if (currentBotPersonality.imageGenerationEnabled && userPrompt.toLowerCase().includes('generate image of')) {
                const imagePrompt = userPrompt.toLowerCase().replace('generate image of', '').trim();
                if (imagePrompt) {
                    message.channel.send('Generating image, please wait...');
                    imageUrl = await generateImage(imagePrompt);
                    if (imageUrl) {
                        replyContent = `Here's an image based on your request:`;
                        await message.reply({ content: replyContent, files: [imageUrl] });
                    } else {
                        replyContent = 'Sorry, I could not generate an image for that request.';
                        await message.reply(replyContent);
                    }
                    // Save chat history after image generation response
                    await saveChatHistory(botIdForContext, message.author.id, isDM, 'user', message.content);
                    await saveChatHistory(botIdForContext, message.author.id, isDM, 'bot', replyContent);
                    return; // Stop further processing for image generation requests
                }
            }

            // Standard AI response (chat or OCR if image attached)
            if (isImagePrompt && imageBase64) {
                replyContent = await generateText(fullPrompt, userPrompt, chatHistory, imageBase64);
            } else {
                replyContent = await generateText(fullPrompt, userPrompt, chatHistory);
            }

            if (replyContent) {
                // Occasional GIF sending
                if (Math.random() < 0.2 && TENOR_API_KEY) { // 20% chance to send a GIF
                    const gifSearchTerm = replyContent.split(' ')[0] || 'happy'; // Use first word of reply or 'happy'
                    const gifUrl = await fetchGif(gifSearchTerm);
                    if (gifUrl) {
                        await message.reply({ content: replyContent, files: [gifUrl] });
                    } else {
                        await message.reply(replyContent);
                    }
                } else {
                    await message.reply(replyContent);
                }

                // Save user and bot messages to MongoDB for context
                await saveChatHistory(botIdForContext, message.author.id, isDM, 'user', message.content);
                await saveChatHistory(botIdForContext, message.author.id, isDM, 'bot', replyContent);
            }
        } catch (error) {
            console.error('Error generating AI response:', error);
            message.channel.send('Sorry, I encountered an error trying to respond. Please try again later.');
        }
    } else {
        // Save user message even if bot doesn't reply, for future context
        await saveChatHistory(botIdForContext, message.author.id, isDM, 'user', message.content);
    }
});

// Log in to Discord
client.login(DISCORD_BOT_TOKEN);
