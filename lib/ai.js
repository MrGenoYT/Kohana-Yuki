const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getServerSettings, getUserData, addMessageToMemory, updateMessageInMemory, summarizeChatHistory } = require('./database');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios'); // For web search

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const imageGenRequests = new Map();
const userActivity = new Map();

// Helper to get the correct model based on user settings
function getChatModel(settings) {
    // Always use gemini-2.5-flash for chat
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

function getDrawingModel() {
    // Always use gemini-2.0-flash for drawing
    return genAI.getGenerativeModel({ model: "imagen-3.0-generate-002" }); // Ensure this is the correct model name for image generation in Gemini
}

// Function to perform web search using Gemini 2.5 Flash
async function performWebSearch(query) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Using gemini-2.5-flash for web search
        const result = await model.generateContent(`Perform a web search for: ${query}. Provide a concise summary of the findings.`);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Web search error:", error);
        return "I couldn't find anything for that, babe! The internet connection seems a bit fuzzy. 🥺";
    }
}

async function handleMessage(message, client) {
    if (message.author.bot) return;

    const settings = message.guild ? await getServerSettings(message.guild.id, client.db) : require('./database').defaultSettings;
    const userData = await getUserData(message.author.id, client.db);

    // Update user's last activity time
    userActivity.set(message.author.id, Date.now());

    if (message.editedTimestamp) {
        await handleMessageEdit(message, client, settings, userData);
        return;
    }

    // Check for drawing request
    const drawingMatch = message.content.match(/^(draw|paint|create a drawing of|make a painting of|sketch)\s(.+)/i);
    if (drawingMatch && settings.imageGeneration) {
        return await handleDrawingRequestConfirmation(message, drawingMatch[2].trim());
    }

    // Check allowed channels for guild messages
    if (message.guild && settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
        return;
    }

    // Add user message to memory
    await addMessageToMemory(message.author.id, 'user', message.content, client.db);

    // Summarize chat history if it exceeds 50 messages
    if (userData.chatHistory.length > 50) {
        await summarizeChatHistory(message.author.id, client.db);
    }

    await handleUserTypingFlow(message, client, settings, userData);
}

async function handleMessageEdit(message, client, settings, userData) {
    await updateMessageInMemory(message.author.id, message.content, client.db);
    // After editing, decide if a new response is needed or just update memory
    // For simplicity, we won't re-generate a response on edit unless specifically requested.
}

async function handleUserTypingFlow(message, client, settings, userData) {
    const channel = message.channel;
    let typingInterval;

    try {
        await channel.sendTyping();
        typingInterval = setInterval(() => channel.sendTyping(), 8000); // Keep typing every 8 seconds

        const chatModel = getChatModel(settings);

        // Construct chat history for Gemini, including user's custom instructions and bot persona
        let chatHistory = [];

        // Add persona and user instructions as system messages for context
        // Ensure these are at the beginning for better contextual understanding
        if (settings.behavior) {
            chatHistory.push({
                role: "user",
                parts: [{ text: `My name is ${settings.name}, I am ${settings.age} years old and I am ${settings.gender}. My mood is usually ${settings.mood}. My core behavior is: ${settings.behavior}` }]
            });
            chatHistory.push({ role: "model", parts: [{ text: "Okay, I understand your persona. I will act accordingly." }] });
        }
        if (settings.personality) {
            chatHistory.push({
                role: "user",
                parts: [{ text: `My personality is: ${settings.personality}` }]
            });
            chatHistory.push({ role: "model", parts: [{ text: "Got it! I'll keep that in mind." }] });
        }
        if (userData.customInstructions) {
            chatHistory.push({
                role: "user",
                parts: [{ text: `The user's special instructions for me are: ${userData.customInstructions}` }]
            });
            chatHistory.push({ role: "model", parts: [{ text: "Understood! I'll remember that for our chats." }] });
        }
        
        // Add summarized history if available
        if (userData.summarizedHistory && userData.summarizedHistory.length > 0) {
            chatHistory.push({ role: "user", parts: [{ text: `Here's a summary of our past conversation: ${userData.summarizedHistory}` }] });
            chatHistory.push({ role: "model", parts: [{ text: "Thanks for the reminder, babe! I remember." }] });
        }

        // Add recent chat history
        userData.chatHistory.forEach(msg => chatHistory.push(msg));

        // Attempt web search if enabled and relevant
        let webSearchResult = '';
        if (settings.webSearch && message.content.toLowerCase().includes('search for')) {
            const searchQuery = message.content.toLowerCase().split('search for')[1].trim();
            if (searchQuery) {
                webSearchResult = await performWebSearch(searchQuery);
                chatHistory.push({
                    role: "user",
                    parts: [{ text: `I found this information online about "${searchQuery}": ${webSearchResult}` }]
                });
                chatHistory.push({ role: "model", parts: [{ text: "Oh, that's interesting! Thanks for sharing, babe! 💖" }] });
            }
        }

        // Add a prompt to make the bot use the user's name sometimes
        const userName = userData.userName || message.author.username; // Use stored name or Discord username
        let finalPrompt = message.content;
        // Optionally inject user name into the prompt for personalization, but not always
        if (Math.random() < 0.2) { // 20% chance to use the name
            finalPrompt = `Remember the user's name is ${userName}. Respond to "${message.content}" and sometimes address the user as ${userName}.`;
        } else {
            finalPrompt = message.content;
        }

        // Add the current user message to the history for the API call
        // This will be added with the finalPrompt logic
        chatHistory.push({ role: "user", parts: [{ text: finalPrompt }] });

        const contents = chatHistory;
        const result = await chatModel.generateContent({
            contents: contents,
            generationConfig: {
                // Ensure the bot does not identify as an AI or language model
                // This is a prompt-level instruction
                stopSequences: ["I am an AI", "I am a large language model", "As an AI"],
            },
        });

        const response = await result.response;
        let responseText = response.text();

        // Ensure the bot doesn't accidentally identify as AI or language model
        responseText = responseText.replace(/I am an AI|I am a large language model|As an AI/gi, "I'm Kohana Yuki!");


        // Add model response to memory
        await addMessageToMemory(message.author.id, 'model', responseText, client.db);

        await message.reply(responseText);

    } catch (error) {
        console.error("Gemini API error:", error);
        // Add more specific error messages for debugging if needed
        if (error.response && error.response.status === 429) {
            await message.reply('Oopsie! I\'m getting a bit overwhelmed with requests right now, babe! Please try again in a moment. 💖');
        } else if (error.response && error.response.status >= 500) {
             await message.reply('Oh no, my brain got a little fuzzed on the server side! Please try again, babe! 🥺');
        }
        else {
            await message.reply('My brain got a little fuzzed, babe! I couldn\'t come up with a response. 🥺 Maybe try rephrasing?');
        }
    } finally {
        clearInterval(typingInterval);
    }
}

// Function to handle the confirmation for drawing requests
async function handleDrawingRequestConfirmation(message, prompt) {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    imageGenRequests.set(requestId, { message, prompt });

    const embed = new EmbedBuilder()
        .setTitle('Drawing Request! 🎨')
        .setColor(0xFFB6C1)
        .setDescription(`You asked me to draw: "${prompt}"\n\nIs that right, babe? 💖`);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirmdrawing_yes_${requestId}`)
                .setLabel('Yes, draw it!')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💖'),
            new ButtonBuilder()
                .setCustomId(`confirmdrawing_no_${requestId}`)
                .setLabel('No, cancel!')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
        );

    await message.reply({ embeds: [embed], components: [row] });
}


async function handleDrawingRequest(interaction) {
    const [,, action, requestId] = interaction.customId.split('_');
    const request = imageGenRequests.get(requestId);

    if (!request) {
        return interaction.update({ content: 'Sorry babe, that request expired. 🥺 Please ask me again!', components: [] });
    }

    if (action === 'no') {
        imageGenRequests.delete(requestId);
        return interaction.update({ content: 'Okay, no drawing for now! Let me know if you change your mind! 💖', components: [] });
    }

    await interaction.update({ content: 'Okay! I\'m concentrating on drawing... uwu ✨', components: [] });
    const { message, prompt } = request;

    try {
        const model = getDrawingModel(); // Use the dedicated drawing model
        const result = await model.generateContent(prompt);
        // The API response structure for image generation (imagen-3) is different
        // It returns fileData directly in result.response.candidates[0].content.parts[0].fileData
        const image = result.response.candidates[0].content.parts[0].fileData;
       
        const buffer = Buffer.from(image.data, 'base64');
        const attachment = new AttachmentBuilder(buffer, { name: 'kohana-art.png' });

        await message.reply({
            content: `Here's your drawing, babe! I hope you like it! uwu 💖`,
            files: [attachment]
        });

    } catch (error) {
        console.error("Drawing error:", error);
        await message.reply('Oh no! I tried my best, babe, but I couldn\'t draw that. Maybe try a different description? 🥺');
    } finally {
        imageGenRequests.delete(requestId);
    }
}

module.exports = { handleMessage, handleInteraction: handleDrawingRequest }; // Export handleDrawingRequest for interactions.js

