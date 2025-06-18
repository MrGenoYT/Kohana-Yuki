const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const createDirectoryStructure = async (type, identifier) => {
    try {
        const dirPath = path.join(__dirname, '..', type, identifier);
        await fs.mkdir(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    } catch (error) {
        console.error('Error creating directory:', error);
    }
};

const generateUniqueId = () => {
    return Math.random().toString(36).substring(2, 18);
};

const getRandomGif = async () => {
    try {
        if (!process.env.TENOR_API_KEY) return null;
        
        const searchTerms = ['anime happy', 'cute anime', 'kawaii', 'anime excited', 'anime cheerful'];
        const randomTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
        
        const response = await axios.get(`https://tenor.googleapis.com/v2/search`, {
            params: {
                q: randomTerm,
                key: process.env.TENOR_API_KEY,
                limit: 20,
                contentfilter: 'medium'
            }
        });
        
        if (response.data && response.data.results.length > 0) {
            const randomGif = response.data.results[Math.floor(Math.random() * response.data.results.length)];
            return randomGif.media_formats.gif.url;
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching GIF:', error);
        return null;
    }
};

const truncateText = (text, maxLength) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
};

module.exports = {
    createDirectoryStructure,
    generateUniqueId,
    getRandomGif,
    truncateText
};
