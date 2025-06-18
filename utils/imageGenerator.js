const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

class ImageGenerator {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        this.rateLimits = new Map();
        this.maxRequestsPerMinute = 10;
    }

    async generateImage(prompt, userId, options = {}) {
        if (!this.checkRateLimit(userId)) {
            throw new Error('Rate limit exceeded. Please wait before generating another image.');
        }

        try {
            const enhancedPrompt = this.enhancePrompt(prompt, options);
            const result = await this.callGeminiImageAPI(enhancedPrompt);
            
            this.updateRateLimit(userId);
            return result;
        } catch (error) {
            console.error('Image generation failed:', error);
            throw new Error('Failed to generate image. Please try again later.');
        }
    }

    async callGeminiImageAPI(prompt) {
        try {
            const result = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Create a detailed image based on this description: ${prompt}. Make it visually appealing and high quality.`
                    }]
                }],
                generationConfig: {
                    temperature: 0.8,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                }
            });

            const response = await result.response;
            
            if (response.candidates && response.candidates[0]) {
                const candidate = response.candidates[0];
                
                if (candidate.content && candidate.content.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.inlineData) {
                            return {
                                type: 'base64',
                                data: part.inlineData.data,
                                mimeType: part.inlineData.mimeType
                            };
                        }
                    }
                }
            }

            return {
                type: 'text',
                description: response.text() || 'Image generated successfully'
            };

        } catch (error) {
            console.error('Gemini API call failed:', error);
            throw error;
        }
    }

    enhancePrompt(originalPrompt, options) {
        let enhanced = originalPrompt.trim();
        
        const style = options.style || 'anime';
        const quality = options.quality || 'high quality';
        const mood = options.mood || 'vibrant';
        
        enhanced += `, ${style} style, ${quality}, ${mood} colors`;
        
        if (!enhanced.includes('detailed')) {
            enhanced += ', highly detailed';
        }
        
        if (style === 'anime' && !enhanced.includes('anime')) {
            enhanced += ', anime art style';
        }
        
        const safetyFilters = [
            'safe for work',
            'appropriate content',
            'family friendly'
        ];
        
        enhanced += `, ${safetyFilters.join(', ')}`;
        
        return enhanced;
    }

    checkRateLimit(userId) {
        const now = Date.now();
        const userLimits = this.rateLimits.get(userId) || { requests: [], lastReset: now };
        
        userLimits.requests = userLimits.requests.filter(timestamp => now - timestamp < 60000);
        
        if (userLimits.requests.length >= this.maxRequestsPerMinute) {
            return false;
        }
        
        return true;
    }

    updateRateLimit(userId) {
        const now = Date.now();
        const userLimits = this.rateLimits.get(userId) || { requests: [], lastReset: now };
        
        userLimits.requests.push(now);
        userLimits.requests = userLimits.requests.filter(timestamp => now - timestamp < 60000);
        
        this.rateLimits.set(userId, userLimits);
        
        this.cleanupRateLimits();
    }

    cleanupRateLimits() {
        if (this.rateLimits.size > 1000) {
            const now = Date.now();
            for (const [userId, limits] of this.rateLimits.entries()) {
                if (now - limits.lastReset > 300000) { // 5 minutes
                    this.rateLimits.delete(userId);
                }
            }
        }
    }

    async createImageEmbed(imageResult, prompt, userName) {
        const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
        
        if (imageResult.type === 'base64') {
            const buffer = Buffer.from(imageResult.data, 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: 'generated_image.png' });
            
            const embed = new EmbedBuilder()
                .setTitle('Image Generated')
                .setDescription(`Here's your ${prompt}!`)
                .setImage('attachment://generated_image.png')
                .setFooter({ text: `Generated for ${userName}` })
                .setColor(0xFF0000)
                .setTimestamp();
            
            return { embeds: [embed], files: [attachment] };
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Image Generation Complete')
                .setDescription(imageResult.description || `Generated: ${prompt}`)
                .setFooter({ text: `Generated for ${userName}` })
                .setColor(0xFF0000)
                .setTimestamp();
            
            return { embeds: [embed] };
        }
    }

    parseImageCommand(message, botName) {
        const patterns = [
            new RegExp(`hi\\s+${botName}\\s+can\\s+you\\s+draw\\s+a\\s+(.+?)\\s+for\\s+me\\??`, 'i'),
            new RegExp(`${botName}\\s+draw\\s+(.+)`, 'i'),
            new RegExp(`${botName}\\s+generate\\s+(.+)`, 'i'),
            new RegExp(`${botName}\\s+create\\s+(.+)`, 'i')
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return {
                    isImageCommand: true,
                    prompt: match[1].trim(),
                    originalMessage: message
                };
            }
        }
        
        return {
            isImageCommand: false,
            prompt: null,
            originalMessage: message
        };
    }

    getImageGenerationHelp(botName) {
        return {
            title: 'Image Generation Commands',
            description: `Use these commands to generate images:`,
            commands: [
                `hi ${botName} can you draw a [description] for me?`,
                `${botName} draw [description]`,
                `${botName} generate [description]`,
                `${botName} create [description]`
            ],
            examples: [
                `hi ${botName} can you draw a cute cat for me?`,
                `${botName} draw a sunset over mountains`,
                `${botName} generate a cyberpunk cityscape`
            ],
            tips: [
                'Be specific with your descriptions for better results',
                'You can specify art styles (anime, realistic, cartoon)',
                'Rate limited to 10 images per minute per user'
            ]
        };
    }
}

module.exports = new ImageGenerator();
