const defaultSettings = {
    name: 'Kohana', // Changed to 10 characters for consistency with Discord's max length
    age: 21, // Age changed to 21
    gender: 'female',
    // Consolidated mood, behavior, and personality into a single, neutral 'behavior' field
    behavior: 'Kohana Yuki is a 21-year-old friendly and supportive companion who loves anime, TikTok, and Roblox. She is always positive and eager to chat.',
    imageGeneration: false,
    webSearch: false,
    allowedChannels: [],
};

async function getServerSettings(guildId, db) {
    let settings = await db.collection('servers').findOne({ guildId });
    if (!settings) {
        settings = { guildId, ...defaultSettings };
        await db.collection('servers').insertOne(settings);
    }
    return settings;
}

async function updateServerSettings(guildId, updates, db) {
    return db.collection('servers').updateOne(
        { guildId },
        { $set: updates },
        { upsert: true }
    );
}

async function getUserData(userId, db) {
    let userData = await db.collection('users').findOne({ userId });
    if (!userData) {
        userData = {
            userId,
            customInstructions: '',
            chatHistory: [],
            lastMessageTime: Date.now(),
            name: null,
            gender: null,
        };
        await db.collection('users').insertOne(userData);
    }
    if (!userData.chatHistory) {
        userData.chatHistory = [];
    }
    if (!userData.lastMessageTime) {
        userData.lastMessageTime = Date.now();
    }
    return userData;
}

async function updateUserData(userId, updates, db) {
    return db.collection('users').updateOne(
        { userId },
        { $set: updates },
        { upsert: true }
    );
}

async function addMessageToMemory(userId, role, content, db) {
    const userData = await getUserData(userId, db);
    const newMessage = { 
        role, 
        parts: [{ text: content }],
        // Removed timestamp and messageId from here, as they are not needed by the Gemini API for history
    };
    
    userData.chatHistory.push(newMessage);
    
    if (userData.chatHistory.length > 50) {
        await summarizeChatHistory(userId, userData, db);
    } else {
        await updateUserData(userId, { 
            chatHistory: userData.chatHistory,
            lastMessageTime: Date.now()
        }, db);
    }
}

async function updateMessageInMemory(userId, newContent, db) {
    const userData = await getUserData(userId, db);
    
    for (let i = userData.chatHistory.length - 1; i >= 0; i--) {
        if (userData.chatHistory[i].role === 'user') {
            userData.chatHistory[i].parts[0].text = newContent;
            userData.chatHistory[i].edited = true;
            userData.chatHistory[i].editedAt = Date.now();
            break;
        }
    }
    
    await updateUserData(userId, { 
        chatHistory: userData.chatHistory 
    }, db);
}

async function summarizeChatHistory(userId, userData, db) {
    // Ensure chatHistory sent to summarization model also only has role and parts
    const filteredChatHistoryForSummary = userData.chatHistory.map(msg => ({
        role: msg.role,
        parts: msg.parts
    }));

    const chatHistoryText = filteredChatHistoryForSummary.map(msg => `${msg.role}: ${msg.parts[0].text}`).join('\n');
    const model = require('@google/generative-ai').GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Summarize the following conversation for memory retention. Keep it concise, focusing on key topics and decisions.
    
    Conversation:
    ${chatHistoryText}
    
    Summary:`;
    
    try {
        const result = await model.generateContent(prompt);
        const summary = result.response.text();
        // Store summary as a system message with only role and parts
        userData.chatHistory = [{ role: 'system', parts: [{ text: `Previous conversation summary: ${summary}` }] }];
        await updateUserData(userId, { chatHistory: userData.chatHistory, lastMessageTime: Date.now() }, db);
    } catch (error) {
        console.error('Error summarizing chat history:', error);
        // Fallback to trimming, ensure trimmed messages also only have role and parts
        userData.chatHistory = userData.chatHistory.slice(-20).map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));
        await updateUserData(userId, { chatHistory: userData.chatHistory, lastMessageTime: Date.now() }, db);
    }
}


function generateMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

module.exports = {
    defaultSettings,
    getServerSettings,
    updateServerSettings,
    getUserData,
    updateUserData,
    addMessageToMemory,
    updateMessageInMemory,
};

