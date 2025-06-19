const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getServerSettings, getUserData, addMessageToMemory } = require('./database');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const imageGenRequests = new Map();

async function handleMessage(message, client) {
    const settings = message.guild ? await getServerSettings(message.guild.id, client.db) : require('./database').defaultSettings;

    if (message.guild && settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
        return;
    }

    const userData = await getUserData(message.author.id, client.db);

    const imageGenMatch = message.content.match(/^(draw|create|make an image of)\s(.+)/i);
    if (imageGenMatch && settings.imageGeneration) {
        return await handleImageGenerationRequest(message, imageGenMatch[2].trim());
    }

    const botMention = message.mentions.has(client.user.id);
    const isReplyToBot = message.reference && (await message.channel.messages.fetch(message.reference.messageId)).author.id === client.user.id;
    const containsName = message.content.toLowerCase().includes(settings.name.toLowerCase());

    if (botMention || isReplyToBot || containsName || message.channel.isDMBased()) {
        await addMessageToMemory(message.author.id, 'user', message.content, client.db);
        await generateReply(message, client, settings, userData);
    }
}

async function generateReply(message, client, settings, userData) {
    await message.channel.sendTyping();

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender}.
Mood: ${settings.mood}
Behavior: ${settings.behavior}
Personality: ${settings.personality}
You are talking to ${message.author.username}.
Your chat history with them is below. Be consistent.
${userData.customInstructions ? `User's special instructions for you: ${userData.customInstructions}` : ''}`;

    try {
        const chat = model.startChat({
            history: userData.chatHistory,
            generationConfig: {
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(systemPrompt + "\n\nUser's new message: " + message.content);
        const responseText = result.response.text();

        await addMessageToMemory(message.author.id, 'model', responseText, client.db);

        if (responseText) {
            await message.reply(responseText);
        } else {
             await message.reply("I'm not sure what to say, babe... 🥺");
        }
    } catch (error) {
        console.error('Error generating reply:', error);
        await message.reply('A-ah! My brain went fuzzy and I couldn\'t think of a reply, babe! 😵‍💫');
    }
}

async function handleImageGenerationRequest(message, prompt) {
    const requestId = `${message.author.id}-${Date.now()}`;
    imageGenRequests.set(requestId, { message, prompt });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirmimagegen_yes_${requestId}`).setLabel('Yes, draw it! ✨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`confirmimagegen_no_${requestId}`).setLabel('No, not now 🥺').setStyle(ButtonStyle.Danger)
    );

    await message.reply({
        content: `Kyaa! Babe, are you sure you want me to draw "${prompt}" for you? uwu`,
        components: [row]
    });

    setTimeout(() => imageGenRequests.delete(requestId), 5 * 60 * 1000);
}


async function handleImageGeneration(interaction) {
     const [,, action, requestId] = interaction.customId.split('_');
     const request = imageGenRequests.get(requestId);

     if (!request) {
         return interaction.update({ content: 'Sorry babe, that request expired. 🥺 Please ask me again!', components: [] });
     }

     if (action === 'no') {
         imageGenRequests.delete(requestId);
         return interaction.update({ content: 'Okay, no image for now! Let me know if you change your mind! 💖', components: [] });
     }

     await interaction.update({ content: 'Okay! I\'m concentrating... uwu ✨', components: [] });
     const { message, prompt } = request;

     try {
         const model = genAI.getGenerativeModel({ model: "imagen-3" });
         const result = await model.generateContent(prompt);
         const image = result.response.candidates[0].content.parts[0].fileData;
        
         const buffer = Buffer.from(image.data, 'base64');
         const attachment = new AttachmentBuilder(buffer, { name: 'kohana-art.png' });

         await message.reply({
             content: `Here's your drawing, babe! I hope you like it! uwu 💖`,
             files: [attachment]
         });

     } catch (error) {
         console.error("Image generation error:", error);
         await message.reply('Oh no! I tried my best, babe, but I couldn\'t draw that. Maybe try a different description? 🥺');
     } finally {
         imageGenRequests.delete(requestId);
     }
}


module.exports = { handleMessage, handleImageGeneration, handleImageGenerationRequest };
