const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Path to store API keys
const API_KEYS_PATH = path.join(process.cwd(), 'config', 'api_keys.json');

// Initialize API keys storage
let apiKeys = {
    openrouter: [],
    gemini: [],
    gemini_flash: [], // Add this new API type
    currentIndex: {
        openrouter: 0,
        gemini: 0,
        gemini_flash: 0 // Add index for the new API type
    },
    lastRotation: {
        openrouter: Date.now(),
        gemini: Date.now(),
        gemini_flash: Date.now() // Add rotation timestamp for the new API type
    }
};

// Load API keys from file
async function loadApiKeys() {
    try {
        if (await fs.pathExists(API_KEYS_PATH)) {
            apiKeys = await fs.readJson(API_KEYS_PATH);
            
            // Ensure the new gemini_flash field exists
            if (!apiKeys.gemini_flash) {
                apiKeys.gemini_flash = [];
            }
            if (!apiKeys.currentIndex.gemini_flash) {
                apiKeys.currentIndex.gemini_flash = 0;
            }
            if (!apiKeys.lastRotation.gemini_flash) {
                apiKeys.lastRotation.gemini_flash = Date.now();
            }
            
            console.log(`Loaded ${apiKeys.openrouter.length} OpenRouter keys, ${apiKeys.gemini.length} Gemini keys, and ${apiKeys.gemini_flash.length} Gemini Flash keys`);
        } else {
            // Create default structure if file doesn't exist
            await fs.ensureDir(path.dirname(API_KEYS_PATH));
            await saveApiKeys();
            console.log('Created new API keys file');
        }
    } catch (error) {
        console.error('Error loading API keys:', error);
    }
}

// Save API keys to file
async function saveApiKeys() {
    try {
        await fs.writeJson(API_KEYS_PATH, apiKeys, { spaces: 2 });
    } catch (error) {
        console.error('Error saving API keys:', error);
    }
}

// Add a new API key
async function addApiKey(service, key) {
    // Validate service
    if (!apiKeys[service]) {
        return { success: false, message: `Invalid service: ${service}. Available services: openrouter, gemini, gemini_flash` };
    }
    
    // Check if key already exists
    if (apiKeys[service].includes(key)) {
        return { success: false, message: `Key already exists for ${service}` };
    }
    
    // Add key
    apiKeys[service].push(key);
    await saveApiKeys();
    
    return { success: true, message: `Added new key for ${service}` };
}

// Remove an API key
async function removeApiKey(service, key) {
    // Validate service
    if (!apiKeys[service]) {
        return { success: false, message: `Invalid service: ${service}. Available services: openrouter, gemini, gemini_flash` };
    }
    
    // Check if key exists
    const index = apiKeys[service].indexOf(key);
    if (index === -1) {
        return { success: false, message: `Key not found for ${service}` };
    }
    
    // Remove key
    apiKeys[service].splice(index, 1);
    
    // Reset index if needed
    if (apiKeys.currentIndex[service] >= apiKeys[service].length && apiKeys[service].length > 0) {
        apiKeys.currentIndex[service] = 0;
    }
    
    await saveApiKeys();
    
    return { success: true, message: `Removed key from ${service}` };
}

// Get all API keys
async function listApiKeys() {
    const result = {};
    
    for (const service in apiKeys) {
        if (Array.isArray(apiKeys[service])) {
            result[service] = {
                count: apiKeys[service].length,
                keys: apiKeys[service].map(key => `${key.substring(0, 5)}...${key.substring(key.length - 5)}`)
            };
        }
    }
    
    return result;
}

// Get next API key with rotation
function getNextApiKey(service) {
    // Validate service
    if (!apiKeys[service] || !Array.isArray(apiKeys[service]) || apiKeys[service].length === 0) {
        console.error(`No API keys available for ${service}`);
        return null;
    }
    
    // Get current index
    const index = apiKeys.currentIndex[service];
    
    // Get key
    const key = apiKeys[service][index];
    
    // Update index for next call
    apiKeys.currentIndex[service] = (index + 1) % apiKeys[service].length;
    
    // Update last rotation timestamp
    apiKeys.lastRotation[service] = Date.now();
    
    // Save changes
    saveApiKeys();
    
    return key;
}

// Initialize on module load
loadApiKeys();

module.exports = {
    addApiKey,
    removeApiKey,
    listApiKeys,
    getNextApiKey
};