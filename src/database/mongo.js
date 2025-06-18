// src/database/mongo.js
const mongoose = require('mongoose');
const { BotSettings, ChatHistory } = require('./schemas');
const crypto = require('crypto'); // For generating 16-digit IDs

const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            dbName: 'discord_ai_bot' // Specify the database name
        });
        console.log('MongoDB connected successfully!');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1); // Exit process with failure
    }
};

// Helper to generate a unique 16-digit ID
const generate16DigitId = () => {
    return crypto.randomBytes(8).toString('hex'); // 8 bytes = 16 hex characters
};

// Get bot personality settings for a given context (guild or DM user)
const getBotPersonality = async (id, isDM = false) => {
    try {
        const settings = await BotSettings.findById(id).lean();
        return settings;
    } catch (error) {
        console.error(`Error fetching bot personality for ${id}:`, error);
        return null;
    }
};

// Update bot personality settings for a given context (guild or DM user)
const updateBotPersonality = async (id, data, isDM = false) => {
    try {
        const serverId = isDM ? id : generate16DigitId(); // Generate new ID for server if not DM and not existing
        const defaultInstructions = "I'm Kohana Yuki, I live in Tokyo, and I like to watch anime and play games. I consider myself a human.";

        const updateData = {
            ...data,
            isDM: isDM,
            $setOnInsert: { // Only set these fields on initial creation
                _id: id,
                defaultInstructions: defaultInstructions
            }
        };

        const settings = await BotSettings.findOneAndUpdate(
            { _id: id },
            updateData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return settings;
    } catch (error) {
        console.error(`Error updating bot personality for ${id}:`, error);
        return null;
    }
};

// Get the default bot instructions
const getBotDefaultInstructions = async () => {
    try {
        // Since default instructions are stored on the BotSettings document,
        // we can fetch any existing document (e.g., a placeholder or the first one)
        // or just return the hardcoded default if no settings exist yet.
        const defaultSettings = await BotSettings.findOne({ defaultInstructions: { $exists: true } });
        if (defaultSettings) {
            return defaultSettings.defaultInstructions;
        } else {
            // If no settings document exists yet, return the hardcoded default
            return "I'm Kohana Yuki, I live in Tokyo, and I like to watch anime and play games. I consider myself a human.";
        }
    } catch (error) {
        console.error("Error fetching default bot instructions:", error);
        return "I'm Kohana Yuki, I live in Tokyo, and I like to watch anime and play games. I consider myself a human.";
    }
};


// Get general bot settings (including allowed channels) for a guild
const getBotSettings = async (guildId) => {
    try {
        const settings = await BotSettings.findById(guildId).lean();
        return settings;
    } catch (error) {
        console.error(`Error fetching bot settings for guild ${guildId}:`, error);
        return null;
    }
};

// Update allowed channels for a guild
const updateAllowedChannels = async (guildId, channelIds) => {
    try {
        const settings = await BotSettings.findByIdAndUpdate(
            guildId,
            { allowedChannels: channelIds },
            { new: true, upsert: true }
        );
        return settings;
    } catch (error) {
        console.error(`Error updating allowed channels for guild ${guildId}:`, error);
        return null;
    }
};

// Get chat history for a specific user within a context (guild or DM)
const getChatHistory = async (botContextId, userId, isDM = false, limit = 10) => {
    try {
        const historyDoc = await ChatHistory.findOne({ botContextId, userId, isDM }).lean();
        if (historyDoc) {
            // Return last 'limit' messages for context
            return historyDoc.history.slice(-limit);
        }
        return [];
    } catch (error) {
        console.error(`Error fetching chat history for ${userId} in ${botContextId}:`, error);
        return [];
    }
};

// Save a new message to chat history
const saveChatHistory = async (botContextId, userId, isDM, role, text) => {
    try {
        await ChatHistory.findOneAndUpdate(
            { botContextId, userId, isDM },
            { $push: { history: { role, parts: [{ text }] } } },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error(`Error saving chat history for ${userId} in ${botContextId}:`, error);
    }
};

// Clear all settings and chat history for a context (guild or DM user)
const clearAllData = async (id, isDM = false) => {
    try {
        await BotSettings.deleteOne({ _id: id, isDM });
        await ChatHistory.deleteMany({ botContextId: id, isDM });
        console.log(`Cleared all data for ${isDM ? 'DM user' : 'guild'} ${id}`);
        return true;
    } catch (error) {
        console.error(`Error clearing data for ${id}:`, error);
        return false;
    }
};

module.exports = {
    connectDB,
    generate16DigitId,
    getBotPersonality,
    updateBotPersonality,
    getBotSettings,
    updateAllowedChannels,
    getChatHistory,
    saveChatHistory,
    clearAllData,
    getBotDefaultInstructions
};

