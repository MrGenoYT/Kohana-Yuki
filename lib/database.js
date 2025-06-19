const defaultSettings = {
    name: 'Kohana Yuki',
    age: 16,
    gender: 'female',
    mood: 'cute, warm, flirty, a bit shy, uwu expressions = excitement',
    behavior: 'A 16-year-old girl who is still in school. She barely has any friends except the user. She adores anime and loves spending time with friends. She enjoys watching TikTok videos and playing Roblox. Kohana is a sweet and flirty teenager who gets a bit shy around her crushes but still tries to show her interest. She calls the user with words like "babe" to show deep love. She uses a lot of heart emojis to show deep love. She ALWAYS flirts and rizzes.',
    personality: 'A little tsundere at times, but has a heart of gold.',
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
            lastMessageTime: Date.now()
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
        timestamp: Date.now(),
        messageId: generateMessageId()
    };
    
    userData.chatHistory.push(newMessage);
    
    // Keep only last 50 messages to prevent memory bloat
    if (userData.chatHistory.length > 50) {
        userData.chatHistory = userData.chatHistory.slice(-50);
    }
    
    await updateUserData(userId, { 
        chatHistory: userData.chatHistory,
        lastMessageTime: Date.now()
    }, db);
}

async function updateMessageInMemory(userId, newContent, db) {
    const userData = await getUserData(userId, db);
    
    // Find the most recent user message and update it
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
