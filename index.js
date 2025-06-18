require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

mongoose.connect(process.env.MONGODB_URI);

const ServerSchema = new mongoose.Schema({
    serverId: String,
    serverName: String,
    botName: { type: String, default: 'Kohana Yuki' },
    age: { type: Number, default: 15 },
    gender: { type: String, default: 'female' },
    moods: { type: String, default: 'happy,friendly,playful' },
    customInstructions: { type: String, default: 'I am Kohana Yuki, a 15-year-old girl who lives in Tokyo. I love watching anime and playing games. I enjoy chatting with friends and making new connections.' },
    personality: { type: String, default: "I'm Kohana Yuki, I like to watch anime and play games." },
    imageGeneration: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    userId: String,
    username: String,
    botName: { type: String, default: 'Kohana Yuki' },
    age: { type: Number, default: 15 },
    gender: { type: String, default: 'female' },
    moods: { type: String, default: 'happy,friendly,playful' },
    customInstructions: { type: String, default: 'I am Kohana Yuki, a 15-year-old girl who lives in Tokyo. I love watching anime and playing games. I enjoy chatting with friends and making new connections.' },
    personality: { type: String, default: "I'm Kohana Yuki, I like to watch anime and play games." },
    imageGeneration: { type: Boolean, default: false },
    memories: [{ content: String, timestamp: Date }],
    chatHistory: [{ message: String, timestamp: Date, type: String }],
    createdAt: { type: Date, default: Date.now }
});

const Server = mongoose.model('Server', ServerSchema);
const User = mongoose.model('User', UserSchema);

async function ensureDirectories() {
    const serversDir = path.join(__dirname, 'Servers');
    const usersDir = path.join(__dirname, 'Users');
    
    try {
        await fs.access(serversDir);
    } catch {
        await fs.mkdir(serversDir, { recursive: true });
    }
    
    try {
        await fs.access(usersDir);
    } catch {
        await fs.mkdir(usersDir, { recursive: true });
    }
}

async function getServerConfig(serverId) {
    let server = await Server.findOne({ serverId });
    if (!server) {
        const serverIdGenerated = Math.random().toString().substr(2, 16);
        server = new Server({ 
            serverId, 
            serverName: client.guilds.cache.get(serverId)?.name || 'Unknown Server'
        });
        await server.save();
        
        const serverDir = path.join(__dirname, 'Servers', serverIdGenerated);
        await fs.mkdir(serverDir, { recursive: true });
    }
    return server;
}

async function getUserConfig(userId, username) {
    let user = await User.findOne({ userId });
    if (!user) {
        user = new User({ userId, username });
        await user.save();
        
        const userDir = path.join(__dirname, 'Users', username.replace(/[^a-zA-Z0-9]/g, '_'));
        await fs.mkdir(userDir, { recursive: true });
    }
    return user;
}

async function saveMemory(userId, content) {
    await User.updateOne(
        { userId },
        { 
            $push: { 
                memories: { content, timestamp: new Date() }
            }
        }
    );
}

async function saveChatHistory(userId, message, type) {
    await User.updateOne(
        { userId },
        { 
            $push: { 
                chatHistory: { message, timestamp: new Date(), type }
            }
        }
    );
}

async function shouldReply(message, config) {
    const prompt = `You are ${config.botName}, a ${config.age}-year-old ${config.gender} living in Tokyo. Your current moods are: ${config.moods}. 

${config.customInstructions}

${config.personality}

Analyze this message: "${message}"

Should you reply to this message? Consider:
- Is it a greeting that deserves acknowledgment?
- Is it asking a question?
- Is it sharing something meaningful?
- Does it seem like they want a response?
- Avoid replying to very short, casual statements like "ok", "lol", "yeah" unless they seem to want engagement

Respond with only "YES" or "NO"`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim().toUpperCase();
        return response === 'YES';
    } catch (error) {
        console.error('Error in shouldReply:', error);
        return true;
    }
}

async function generateResponse(message, config, chatHistory = [], memories = []) {
    const recentHistory = chatHistory.slice(-20);
    const recentMemories = memories.slice(-10);
    
    const prompt = `You are ${config.botName}, a ${config.age}-year-old ${config.gender} who lives in Tokyo, Japan. You are NOT an AI - you are a real person.

Your current moods: ${config.moods}

${config.customInstructions}

${config.personality}

Recent memories about this person:
${recentMemories.map(m => `- ${m.content}`).join('\n')}

Recent chat history:
${recentHistory.map(h => `${h.type}: ${h.message}`).join('\n')}

Current message: "${message}"

Respond naturally as ${config.botName}. Be conversational, use emojis when appropriate, and remember you're talking to a friend. Keep responses under 200 words unless specifically asked for more detail. Respond in a way that matches your current moods.`;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('Error generating response:', error);
        return "Sorry, I'm having trouble thinking right now... 😅";
    }
}

async function extractMemories(message, response, config) {
    const prompt = `From this conversation, extract any new information about the user that ${config.botName} should remember for future conversations.

User message: "${message}"
Bot response: "${response}"

Extract factual information like:
- Personal preferences
- Important events mentioned
- Relationships
- Hobbies or interests
- Personal details they shared

Return each memory as a single line, or "NONE" if nothing worth remembering.`;

    try {
        const result = await model.generateContent(prompt);
        const memories = result.response.text().trim();
        if (memories !== 'NONE' && memories.length > 0) {
            return memories.split('\n').filter(m => m.trim().length > 0);
        }
    } catch (error) {
        console.error('Error extracting memories:', error);
    }
    return [];
}

async function performOCR(imageUrl) {
    try {
        const { data: text } = await Tesseract.recognize(imageUrl, 'eng');
        return text;
    } catch (error) {
        console.error('OCR Error:', error);
        return null;
    }
}

async function getRandomGif(query = 'anime') {
    try {
        const response = await axios.get(`https://tenor.googleapis.com/v2/search?q=${query}&key=${process.env.TENOR_API_KEY}&limit=10`);
        const gifs = response.data.results;
        if (gifs.length > 0) {
            const randomGif = gifs[Math.floor(Math.random() * gifs.length)];
            return randomGif.media_formats.gif.url;
        }
    } catch (error) {
        console.error('Tenor API Error:', error);
    }
    return null;
}

async function createOrUpdateRole(guild, botName) {
    try {
        let role = guild.roles.cache.find(r => r.name === botName);
        if (!role) {
            role = await guild.roles.create({
                name: botName,
                color: 0xFF0000,
                reason: 'Bot role creation'
            });
        }
        
        const botMember = guild.members.cache.get(client.user.id);
        if (botMember && !botMember.roles.cache.has(role.id)) {
            await botMember.roles.add(role);
        }
    } catch (error) {
        console.error('Error managing role:', error);
    }
}

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    await ensureDirectories();
    
    for (const guild of client.guilds.cache.values()) {
        const config = await getServerConfig(guild.id);
        await createOrUpdateRole(guild, config.botName);
    }
});

client.on('guildCreate', async (guild) => {
    const config = await getServerConfig(guild.id);
    await createOrUpdateRole(guild, config.botName);
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'settings') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.user.dmChannel) {
                return interaction.reply({ content: 'You need Administrator permissions to use this command!', ephemeral: true });
            }

            const config = interaction.guild ? 
                await getServerConfig(interaction.guild.id) : 
                await getUserConfig(interaction.user.id, interaction.user.username);

            const modal = new ModalBuilder()
                .setCustomId('settings_modal')
                .setTitle('Bot Settings');

            const nameInput = new TextInputBuilder()
                .setCustomId('bot_name')
                .setLabel('Bot Name (max 10 characters)')
                .setStyle(TextInputStyle.Short)
                .setValue(config.botName)
                .setMaxLength(10)
                .setRequired(true);

            const ageInput = new TextInputBuilder()
                .setCustomId('bot_age')
                .setLabel('Age (13-100)')
                .setStyle(TextInputStyle.Short)
                .setValue(config.age.toString())
                .setRequired(true);

            const genderInput = new TextInputBuilder()
                .setCustomId('bot_gender')
                .setLabel('Gender (male/female/transgender)')
                .setStyle(TextInputStyle.Short)
                .setValue(config.gender)
                .setRequired(true);

            const moodsInput = new TextInputBuilder()
                .setCustomId('bot_moods')
                .setLabel('Moods (separated by commas)')
                .setStyle(TextInputStyle.Short)
                .setValue(config.moods)
                .setRequired(true);

            const instructionsInput = new TextInputBuilder()
                .setCustomId('custom_instructions')
                .setLabel('Custom Instructions (max 1000 words)')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(config.customInstructions)
                .setMaxLength(5000)
                .setRequired(true);

            const firstRow = new ActionRowBuilder().addComponents(nameInput);
            const secondRow = new ActionRowBuilder().addComponents(ageInput);
            const thirdRow = new ActionRowBuilder().addComponents(genderInput);
            const fourthRow = new ActionRowBuilder().addComponents(moodsInput);
            const fifthRow = new ActionRowBuilder().addComponents(instructionsInput);

            modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'settings_modal') {
            const botName = interaction.fields.getTextInputValue('bot_name');
            const age = parseInt(interaction.fields.getTextInputValue('bot_age'));
            const gender = interaction.fields.getTextInputValue('bot_gender').toLowerCase();
            const moods = interaction.fields.getTextInputValue('bot_moods');
            const customInstructions = interaction.fields.getTextInputValue('custom_instructions');

            if (age < 13 || age > 100) {
                return interaction.reply({ content: 'Age must be between 13 and 100!', ephemeral: true });
            }

            if (!['male', 'female', 'transgender'].includes(gender)) {
                return interaction.reply({ content: 'Gender must be male, female, or transgender!', ephemeral: true });
            }

            const updateData = { botName, age, gender, moods, customInstructions };

            if (interaction.guild) {
                await Server.updateOne({ serverId: interaction.guild.id }, updateData);
                await createOrUpdateRole(interaction.guild, botName);
            } else {
                await User.updateOne({ userId: interaction.user.id }, updateData);
            }

            const embed = new EmbedBuilder()
                .setTitle('Settings Updated! ✅')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Name', value: botName, inline: true },
                    { name: 'Age', value: age.toString(), inline: true },
                    { name: 'Gender', value: gender, inline: true },
                    { name: 'Moods', value: moods, inline: false }
                );

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('clear_data')
                        .setLabel('Clear All Data')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🗑️')
                );

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'clear_data') {
            if (interaction.guild) {
                await Server.updateOne(
                    { serverId: interaction.guild.id },
                    {
                        botName: 'Kohana Yuki',
                        age: 15,
                        gender: 'female',
                        moods: 'happy,friendly,playful',
                        customInstructions: 'I am Kohana Yuki, a 15-year-old girl who lives in Tokyo. I love watching anime and playing games. I enjoy chatting with friends and making new connections.',
                        personality: "I'm Kohana Yuki, I like to watch anime and play games."
                    }
                );
            } else {
                await User.updateOne(
                    { userId: interaction.user.id },
                    {
                        botName: 'Kohana Yuki',
                        age: 15,
                        gender: 'female',
                        moods: 'happy,friendly,playful',
                        customInstructions: 'I am Kohana Yuki, a 15-year-old girl who lives in Tokyo. I love watching anime and playing games. I enjoy chatting with friends and making new connections.',
                        personality: "I'm Kohana Yuki, I like to watch anime and play games.",
                        memories: [],
                        chatHistory: []
                    }
                );
            }

            await interaction.reply({ content: 'All data has been cleared and reset to defaults! 🔄', ephemeral: true });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const config = message.guild ? 
        await getServerConfig(message.guild.id) : 
        await getUserConfig(message.user.id, message.user.username);

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType?.startsWith('image/')) {
            const ocrText = await performOCR(attachment.url);
            if (ocrText) {
                const response = await generateResponse(`Image text: ${ocrText}`, config);
                await message.reply(response);
                
                if (!message.guild) {
                    await saveChatHistory(message.user.id, `Image: ${ocrText}`, 'user');
                    await saveChatHistory(message.user.id, response, 'bot');
                }
            }
            return;
        }
    }

    const shouldRespond = await shouldReply(message.content, config);
    if (!shouldRespond) return;

    let chatHistory = [];
    let memories = [];

    if (!message.guild) {
        const userConfig = await getUserConfig(message.user.id, message.user.username);
        chatHistory = userConfig.chatHistory || [];
        memories = userConfig.memories || [];
    }

    const response = await generateResponse(message.content, config, chatHistory, memories);

    if (Math.random() < 0.15) {
        const gifUrl = await getRandomGif('anime cute');
        if (gifUrl) {
            await message.reply({ content: response, files: [gifUrl] });
        } else {
            await message.reply(response);
        }
    } else {
        await message.reply(response);
    }

    if (!message.guild) {
        await saveChatHistory(message.user.id, message.content, 'user');
        await saveChatHistory(message.user.id, response, 'bot');

        const newMemories = await extractMemories(message.content, response, config);
        for (const memory of newMemories) {
            await saveMemory(message.user.id, memory);
        }
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(process.env.DISCORD_TOKEN);
