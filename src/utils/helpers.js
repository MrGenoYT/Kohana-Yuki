// src/utils/helpers.js
const fetch = require('node-fetch');

const TENOR_API_KEY = process.env.TENOR_API_KEY;

// Function to fetch a GIF from Tenor
const fetchGif = async (searchTerm) => {
    if (!TENOR_API_KEY) {
        console.warn("TENOR_API_KEY is not set. Cannot fetch GIFs.");
        return null;
    }
    try {
        const response = await fetch(`https://g.tenor.com/v1/search?q=${encodeURIComponent(searchTerm)}&key=${TENOR_API_KEY}&limit=1&media_filter=minimal&contentfilter=high`);
        const data = await response.json();
        if (data && data.results && data.results.length > 0) {
            // Pick the first result's GIF URL (tinygif for smaller size)
            return data.results[0].media[0].tinygif.url;
        }
        return null;
    } catch (error) {
        console.error('Error fetching GIF from Tenor:', error);
        return null;
    }
};

module.exports = { fetchGif };
