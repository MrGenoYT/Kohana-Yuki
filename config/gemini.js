const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const getModel = (modelName = 'gemini-2.0-flash-exp') => {
    return genAI.getGenerativeModel({ model: modelName });
};

const generateContent = async (prompt, model = 'gemini-2.0-flash-exp') => {
    try {
        const geminiModel = getModel(model);
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
};

const generateImage = async (prompt) => {
    try {
        const model = getModel('gemini-2.0-flash-exp');
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{
                    text: `Generate an image: ${prompt}`
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
            }
        });
        
        const response = await result.response;
        return response;
    } catch (error) {
        console.error('Image generation error:', error);
        throw error;
    }
};

const shouldReply = async (message) => {
    try {
        const response = await generateContent(
            `Decide if this message requires a reply. Respond with only one word: YES or NO. Message: "${message}"`
        );
        return response.trim().toUpperCase() === 'YES';
    } catch (error) {
        console.error('Reply filter error:', error);
        return Math.random() > 0.7;
    }
};

module.exports = {
    getModel,
    generateContent,
    generateImage,
    shouldReply
};
