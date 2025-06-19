const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getServerSettings, getUserData, addMessageToMemory, updateMessageInMemory } = require('./database');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const imageGenRequests = new Map();

// Track user activity and bot response patterns
const userActivity = new Map(); // userId -> { lastMessageTime, consecutiveNos, pendingMessages, timeoutId }

async function handleMessage(message, client) {
    if (message.author.bot) return;
    
    const settings = message.guild ? await getServerSettings(message.guild.id, client.db) : require('./database').defaultSettings;
    const userData = await getUserData(message.author.id, client.db);
    
    // Check if message is an edit
    if (message.editedTimestamp) {
        await handleMessageEdit(message, client, settings, userData);
        return;
    }

    // Handle image generation requests
    const imageGenMatch = message.content.match(/^(draw|create|make an image of)\s(.+)/i);
    if (imageGenMatch && settings.imageGeneration) {
        return await handleImageGenerationRequest(message, imageGenMatch[2].trim());
    }

    // Check channel permissions for guild messages
    if (message.guild && settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(message.channelId)) {
        return;
    }

    // Add message to memory
    await addMessageToMemory(message.author.id, 'user', message.content, client.db);

    // Check if user is actively typing (multiple messages in succession)
    await handleUserTypingFlow(message, client, settings, userData);
}

async function handleMessageEdit(message, client, settings, userData) {
    // Update the message in database
    await updateMessageInMemory(message.author.id, message.content, client.db);
    
    // Check if we should respond to the edited message
    const shouldRespond = await shouldBotRespond(message, settings, userData, 'edit');
    if (shouldRespond) {
        await generateReply(message, client, settings, userData);
    }
}

async function handleUserTypingFlow(message, client, settings, userData) {
    const userId = message.author.id;
    const now = Date.now();
    
    // Get or create user activity tracking
    let activity = userActivity.get(userId) || {
        lastMessageTime: 0,
        consecutiveNos: 0,
        pendingMessages: [],
        timeoutId: null
    };

    // Clear existing timeout
    if (activity.timeoutId) {
        clearTimeout(activity.timeoutId);
    }

    // Add current message to pending messages
    activity.pendingMessages.push({
        message,
        timestamp: now,
        client,
        settings,
        userData
    });

    // Check if this is after a long break (5+ minutes)
    const timeSinceLastMessage = now - activity.lastMessageTime;
    const isLongBreak = timeSinceLastMessage > 5 * 60 * 1000; // 5 minutes

    activity.lastMessageTime = now;

    // Set timeout to process messages after 5 seconds of inactivity
    activity.timeoutId = setTimeout(async () => {
        await processUserMessages(userId, isLongBreak);
    }, 5000);

    userActivity.set(userId, activity);
}

async function processUserMessages(userId, isLongBreak) {
    const activity = userActivity.get(userId);
    if (!activity || activity.pendingMessages.length === 0) return;

    const messages = activity.pendingMessages;
    const lastMessage = messages[messages.length - 1];
    
    // Decide which message to respond to
    let targetMessage = lastMessage;
    
    // Sometimes respond to earlier messages (30% chance if multiple messages)
    if (messages.length > 1 && Math.random() < 0.3) {
        const randomIndex = Math.floor(Math.random() * messages.length);
        targetMessage = messages[randomIndex];
    }

    // Determine if bot should respond
    const shouldRespond = await shouldBotRespond(
        targetMessage.message, 
        targetMessage.settings, 
        targetMessage.userData, 
        isLongBreak ? 'long_break' : 'normal',
        activity.consecutiveNos
    );

    if (shouldRespond) {
        activity.consecutiveNos = 0;
        await generateReply(targetMessage.message, targetMessage.client, targetMessage.settings, targetMessage.userData);
    } else {
        activity.consecutiveNos++;
        
        // Force response after 2 consecutive "no" decisions
        if (activity.consecutiveNos >= 2) {
            activity.consecutiveNos = 0;
            await generateReply(targetMessage.message, targetMessage.client, targetMessage.settings, targetMessage.userData);
        }
    }

    // Clear pending messages
    activity.pendingMessages = [];
    userActivity.set(userId, activity);
}

async function shouldBotRespond(message, settings, userData, context = 'normal', consecutiveNos = 0) {
    // Always respond to direct triggers
    const botMention = message.mentions.has(message.client.user.id);
    const isReplyToBot = message.reference && (await message.channel.messages.fetch(message.reference.messageId)).author.id === message.client.user.id;
    const containsName = message.content.toLowerCase().includes(settings.name.toLowerCase());
    const isDM = message.channel.isDMBased();

    if (botMention || isReplyToBot || containsName) {
        return true;
    }

    // Always respond in DMs
    if (isDM) {
        return true;
    }

    // Force response after long break or consecutive nos
    if (context === 'long_break' || consecutiveNos >= 2) {
        return true;
    }

    // Use AI to decide if message warrants a response
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const decisionPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender}.
Your personality: ${settings.personality}
Your behavior: ${settings.behavior}

Someone just said: "${message.content}"

Context: ${context === 'edit' ? 'This is an edited message' : 'This is a new message'}
Recent chat history with this user: ${userData.chatHistory.slice(-5).map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}

Should you respond to this message? Consider:
- Is it directed at you or asking a question?
- Is it something you'd naturally want to respond to given your personality?
- Does it seem like they want a conversation?
- Is it just a casual comment that doesn't need a response?

Respond with ONLY "YES" or "NO" - nothing else.`;

        const result = await model.generateContent(decisionPrompt);
        const decision = result.response.text().trim().toUpperCase();
        
        return decision === 'YES';
    } catch (error) {
        console.error('Error in AI decision making:', error);
        // Fallback: respond to questions and greetings
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

async function generateReply(message, client, settings, userData) {
    // Show typing for 2 seconds to feel more human
    await message.channel.sendTyping();
    await new Promise(resolve => setTimeout(resolve, 2000));

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemPrompt = `You are ${settings.name}, a ${settings.age}-year-old ${settings.gender}.
Mood: ${settings.mood}
Behavior: ${settings.behavior}
Personality: ${settings.personality}
You are talking to ${message.author.username}.
Your chat history with them is below. Be consistent and natural.
${userData.customInstructions ? `User's special instructions for you: ${userData.customInstructions}` : ''}

Remember: You decided to respond to this message because you felt it was worth responding to. Be natural and engaging.`;

    try {
        const chat = model.startChat({
            history: userData.chatHistory.slice(-20), // Keep last 20 messages for context
            generationConfig: {
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(systemPrompt + "\n\nUser's message: " + message.content);
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
