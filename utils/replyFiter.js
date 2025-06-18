const { generateContent } = require('../config/gemini');

class ReplyFilter {
    constructor() {
        this.filterCache = new Map();
        this.cacheTimeout = 300000; // 5 minutes
    }

    async shouldReplyToMessage(message, context = {}) {
        const cacheKey = this.generateCacheKey(message, context);
        
        if (this.filterCache.has(cacheKey)) {
            const cached = this.filterCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.shouldReply;
            }
            this.filterCache.delete(cacheKey);
        }

        try {
            const decision = await this.analyzeMessage(message, context);
            
            this.filterCache.set(cacheKey, {
                shouldReply: decision,
                timestamp: Date.now()
            });

            this.cleanupCache();
            return decision;
        } catch (error) {
            console.error('Reply filter error:', error);
            return this.getFallbackDecision(message, context);
        }
    }

    async analyzeMessage(message, context) {
        const prompt = this.buildAnalysisPrompt(message, context);
        
        const response = await generateContent(prompt);
        const decision = response.trim().toUpperCase();
        
        return decision === 'YES';
    }

    buildAnalysisPrompt(message, context) {
        let prompt = `Analyze if this message requires a thoughtful reply from a human-like Discord bot named ${context.botName || 'Kohana'}.\n\n`;
        
        prompt += `Guidelines for replying:
- Reply to direct questions, requests for help, or meaningful conversations
- Reply to emotional expressions (happy, sad, excited, etc.)
- Reply to messages that seem to want engagement or response
- DO NOT reply to simple greetings like "hi", "hello" unless they seem to want conversation
- DO NOT reply to random statements, spam, or filler messages
- DO NOT reply to messages that are clearly not directed at anyone
- DO NOT reply to very short messages without context
- Consider the conversational context and flow\n\n`;

        if (context.isMentioned) {
            prompt += `Bot was mentioned or replied to - higher chance of replying.\n`;
        }

        if (context.recentActivity) {
            prompt += `Recent conversation activity in channel.\n`;
        }

        if (context.userHistory) {
            prompt += `User has chatted with bot before.\n`;
        }

        prompt += `Message to analyze: "${message}"\n\n`;
        prompt += `Respond with only one word: YES or NO`;

        return prompt;
    }

    getFallbackDecision(message, context) {
        const msg = message.toLowerCase().trim();
        
        if (context.isMentioned || context.isReply) {
            return Math.random() > 0.3;
        }

        if (msg.includes('?')) {
            return Math.random() > 0.4;
        }

        if (msg.length < 3) {
            return false;
        }

        if (['hi', 'hello', 'hey', 'yo', 'sup'].includes(msg)) {
            return Math.random() > 0.8;
        }

        const emotionalWords = ['sad', 'happy', 'excited', 'angry', 'worried', 'tired', 'bored', 'lonely'];
        if (emotionalWords.some(word => msg.includes(word))) {
            return Math.random() > 0.3;
        }

        return Math.random() > 0.7;
    }

    generateCacheKey(message, context) {
        const contextStr = JSON.stringify({
            isMentioned: context.isMentioned || false,
            isReply: context.isReply || false,
            botName: context.botName || 'Kohana'
        });
        return `${message.toLowerCase().trim()}_${contextStr}`;
    }

    cleanupCache() {
        if (this.filterCache.size > 1000) {
            const now = Date.now();
            for (const [key, value] of this.filterCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.filterCache.delete(key);
                }
            }
        }
    }

    async processMultipleMessages(messages, context) {
        const results = [];
        
        for (const message of messages) {
            const shouldReply = await this.shouldReplyToMessage(message, context);
            results.push({
                message,
                shouldReply
            });
            
            if (shouldReply) {
                break;
            }
        }
        
        return results;
    }
}

module.exports = new ReplyFilter();
