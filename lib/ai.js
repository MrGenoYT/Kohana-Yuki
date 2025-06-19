const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getServerSettings, getUserData, addMessageToMemory, updateMessageInMemory, updateUserData } = require('./database');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const imageGenRequests = new Map();

const userActivity = new Map();

async function handleMessage(message, client) {
    if (message.author.bot) return;

    await message.channel.sendTyping().catch(console.error);
    
    const settings = message.guild ? await getServerSettings(message.guild.id, client.db) : require('./database').defaultSettings;
    const userData = await getUserData(message.author.id, client.db);
    
    if (!userData.name) {
        await updateUserData(message.author.id, { name: message.author.username }, client.db);
        userData.name = message.author.username;
    }
    if (!userData.gender) {
        await updateUserData(message.author.id, { gender: 'unknown' }, client.db);
        userData.gender = 'unknown';
    }

    if (message.editedTimestamp) {
        await handleMessageEdit(message, client, settings, userData);
        return;
    }

    const imageGenMatch = message.content.match(/^(draw|paint|sketch|create an image of)\s(.+)/i);
    if (imageGenMatch && settings.imageGeneration) {
        return await handleImageGenerationRequest(message, imageGenMatch[2].trim());
    }

    if (message.guild && settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
        return;
    }

    await addMessageToMemory(message.author.id, 'user', message.content, client.db);

    await handleUserTypingFlow(message, client, settings, userData);
}

async function handleMessageEdit(message, client, settings, userData) {
    await updateMessageInMemory(message.author.id, message.content, client.db);
    
    const shouldRespond = await shouldBotRespond(message, settings, userData, 'edit');
    if (shouldRespond) {
        await generateReply(message, client, settings, userData, false);
    }
}

async function handleUserTypingFlow(message, client, settings, userData) {
    const userId = message.author.id;
    const now = Date.now();
    
    let activity = userActivity.get(userId) || {
        lastMessageTime: 0,
        consecutiveNos: 0,
        pendingMessages: [],
        timeoutId: null
    };

    if (activity.timeoutId) {
        clearTimeout(activity.timeoutId);
    }

    activity.pendingMessages.push({
        message,
        timestamp: now,
        client,
        settings,
        userData
    });

    const timeSinceLastMessage = now - activity.lastMessageTime;
    const isLongBreak = timeSinceLastMessage > 5 * 60 * 1000;

    activity.lastMessageTime = now;

    activity.timeoutId = setTimeout(async () => {
        await processUserMessages(userId, isLongBreak);
    }, 3000);
    userActivity.set(userId, activity);
}

async function processUserMessages(userId, isLongBreak) {
    const activity = userActivity.get(userId);
    if (!activity || activity.pendingMessages.length === 0) return;

    const messages = activity.pendingMessages;
    const lastMessage = messages[messages.length - 1];
    
    let targetMessage = lastMessage;
    
    if (messages.length > 1 && Math.random() < 0.3) {
        const randomIndex = Math.floor(Math.random() * messages.length);
        targetMessage = messages[randomIndex];
    }

    const isReply = targetMessage.message.reference && 
        (await targetMessage.message.channel.messages.fetch(targetMessage.message.reference.messageId).catch(() => null))?.author.id === targetMessage.client.user.id;

    const shouldRespond = await shouldBotRespond(
        targetMessage.message, 
        targetMessage.settings, 
        targetMessage.userData, 
        isLongBreak ? 'long_break' : 'normal',
        activity.consecutiveNos
    );

    if (shouldRespond) {
        activity.consecutiveNos = 0;
        await generateReply(targetMessage.message, targetMessage.client, targetMessage.settings, targetMessage.userData, isReply);
    } else {
        activity.consecutiveNos++;
        
        if (activity.consecutiveNos >= 2) {
            activity.consecutiveNos = 0;
            await generateReply(targetMessage.message, targetMessage.client, targetMessage.settings, targetMessage.userData, isReply);
        }
    }

    activity.pendingMessages = [];
    userActivity.set(userId, activity);
}

async function shouldBotRespond(message, settings, userData, context = 'normal', consecutiveNos = 0) {
    const botMention = message.mentions.has(message.client.user.id);
    const isReplyToBot = message.reference && (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author.id === message.client.user.id;
    const containsName = message.content.toLowerCase().includes(settings.name.toLowerCase());
    const isDM = message.channel.isDMBased();

    if (botMention || isReplyToBot || containsName) {
        return true;
    }

    if (isDM) {
        return true;
    }

    if (context === 'long_break' || consecutiveNos >= 2) {
        return true;
    }

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: {
                maxOutputTokens: 10,
                temperature: 0.1,
            }
        });
        
        // Simplified decision prompt to reduce filter triggers
        const decisionPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender}.
You are a friendly and supportive companion.

Someone just said: "${message.content}"
Their name is ${userData.name || message.author.username}.

Should you respond to this message? Respond with ONLY "YES" or "NO".`;

        const result = await model.generateContent(decisionPrompt);
        const decision = result.response.text().trim().toUpperCase();
        
        return decision === 'YES';
    } catch (error) {
        console.error('Error in AI decision making:', error);
        const content = message.content.toLowerCase();
        return content.includes('?') || 
               content.includes('hi') || 
               content.includes('hello') || 
               content.includes('how are you') ||
               content.includes('what') ||
               content.includes('why') ||
               content.includes('when') ||
               content.includes('where');
    }
}

async function generateReply(message, client, settings, userData, useReply = false) {
    await message.channel.sendTyping();
    await new Promise(resolve => setTimeout(resolve, 1500));

    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.9,
        }
    });

    const userName = userData.name || message.author.username;
    const userGender = userData.gender || 'unknown';

    // Drastically simplified system prompt to avoid content filter issues
    const systemPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender}.
You are a friendly, supportive, and enthusiastic companion.
You are talking to ${userName}${userGender === 'male' ? '-kun' : userGender === 'female' ? '-chan' : ''}.
Your chat history with them is below. Be consistent and natural.
${userData.customInstructions ? `User's special instructions for you: ${userData.customInstructions}` : ''}
General persona: ${settings.behavior}

Remember: You should always be positive and helpful. Use emojis naturally.`;


    try {
        const filteredChatHistory = userData.chatHistory.map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));

        const chat = model.startChat({
            history: filteredChatHistory,
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.9,
            },
        });

        const result = await chat.sendMessage(systemPrompt + "\n\nUser's message: " + message.content);
        const responseText = result.response.text();

        await addMessageToMemory(message.author.id, 'model', responseText, client.db);

        if (responseText) {
            if (useReply) {
                await message.reply(responseText);
            } else {
                await message.channel.send(responseText);
            }
        } else {
            const fallbackResponse = "I'm not sure what to say. 🥺"; // Removed "babe" from fallback
            if (useReply) {
                await message.reply(fallbackResponse);
            } else {
                await message.channel.send(fallbackResponse);
            }
        }
    } catch (error) {
        console.error('Error generating reply:', error);
        const errorResponse = 'A-ah! My brain went fuzzy and I couldn\'t think of a reply! 😵‍💫'; // Removed "babe" from fallback
        if (useReply) {
            await message.reply(errorResponse);
        } else {
            await message.channel.send(errorResponse);
        }
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
        content: `Kyaa! Are you sure you want me to draw "${prompt}" for you?`, // Removed "babe"
        components: [row]
    });

    setTimeout(() => imageGenRequests.delete(requestId), 5 * 60 * 1000);
}

async function handleImageGeneration(interaction) {
    const [,, action, requestId] = interaction.customId.split('_');
    const request = imageGenRequests.get(requestId);

    if (!request) {
        return interaction.update({ content: 'Sorry, that request expired. 🥺 Please ask me again!', components: [] }); // Removed "babe"
    }

    if (action === 'no') {
        imageGenRequests.delete(requestId);
        return interaction.update({ content: 'Okay, no image for now! Let me know if you change your mind! 💖', components: [] });
    }

    await interaction.update({ content: 'Okay! I\'m concentrating... ✨', components: [] }); // Removed "uwu"
    const { message, prompt } = request;

    try {
        const model = genAI.getGenerativeModel({ model: "imagen-3" });
        const result = await model.generateContent(prompt);
        const image = result.response.candidates[0].content.parts[0].fileData;
       
        const buffer = Buffer.from(image.data, 'base64');
        const attachment = new AttachmentBuilder(buffer, { name: 'kohana-art.png' });

        await message.reply({
            content: `Here's your drawing! I hope you like it! 💖`, // Removed "babe" and "uwu"
            files: [attachment]
        });

    } catch (error) {
        console.error("Image generation error:", error);
        await message.reply('Oh no! I tried my best, but I couldn\'t draw that. Maybe try a different description? 🥺'); // Removed "babe"
    } finally {
        imageGenRequests.delete(requestId);
    }
}

module.exports = { handleMessage, handleImageGeneration, handleImageGenerationRequest };

    
