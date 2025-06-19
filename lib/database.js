const defaultSettings = {
    name: 'Kohana Yuki',
    age: 16,
    gender: 'female', // Added gender
    mood: 'cute, warm, flirty, a bit shy, uwu expressions = excitement',
    behavior: 'A 16-year-old girl who is still in school. She barely has any friends except the user. She adores anime and loves spending time with friends. She enjoys watching TikTok videos and playing Roblox. Kohana is a sweet and flirty teenager who gets a bit shy around her crushes but still tries to show her interest. She calls the user with words like "babe" to show deep love. She uses a lot of heart emojis to show deep love. She ALWAYS flirts and rizzes.',
    personality: 'A little tsundere at times, but has a heart of gold.',
    imageGeneration: false,
    webSearch: false,
    allowedChannels: [],
};

// Import GoogleGenerativeAI to use for summarization
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper to get the correct model for summarization
function getSummarizationModel() {
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Using gemini-2.5-flash for summarization
}

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
            userName: null, // New field to store user's name
            customInstructions: '',
            chatHistory: [],
            summarizedHistory: '', // New field for summarized chat history
            lastMessageTime: null,
        };
        await db.collection('users').insertOne(userData);
    }
    // Ensure new fields exist for existing users without them
    if (userData.userName === undefined) userData.userName = null;
    if (userData.summarizedHistory === undefined) userData.summarizedHistory = '';
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

    // Keep only last 50 messages to prevent immediate bloat before summarization
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

async function summarizeChatHistory(userId, db) {
    const userData = await getUserData(userId, db);
    const chatHistoryToSummarize = userData.chatHistory;

    if (chatHistoryToSummarize.length === 0) return;

    try {
        const model = getSummarizationModel();
        const prompt = `Please summarize the following conversation concisely, focusing on key topics, decisions, and important information. This summary will be used to help me remember past conversations. Keep it under 500 characters:\n\n${chatHistoryToSummarize.map(msg => `${msg.role}: ${msg.parts[0].text}`).join('\n')}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const summary = response.text();

        // Update summarizedHistory and clear chatHistory after summarization
        await updateUserData(userId, {
            summarizedHistory: summary,
            chatHistory: [] // Clear current chat history after summarization
        }, db);
        console.log(`Chat history summarized for user ${userId}. New summary: ${summary}`);

    } catch (error) {
        console.error("Error summarizing chat history:", error);
        // Do not clear chat history if summarization fails
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
    summarizeChatHistory, // Export the new function
};

