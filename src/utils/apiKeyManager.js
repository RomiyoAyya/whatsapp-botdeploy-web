const fs = require('fs-extra');
const path = require('path');

// API key manager
class ApiKeyManager {
    constructor() {
        this.keys = {
            openrouter: [],
            gemini: []
        };
        this.currentIndex = {
            openrouter: 0,
            gemini: 0
        };
        this.lastRotation = {
            openrouter: 0,
            gemini: 0
        };
        this.initialized = false;
    }

    async initialize() {
        try {
            // Check if we're running on Railway
            const isRailway = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT;
            
            if (isRailway) {
                console.log('Running on Railway, using environment variables for API keys');
                
                // Load API keys from environment variables
                if (process.env.OPENROUTER_API_KEYS) {
                    this.keys.openrouter = process.env.OPENROUTER_API_KEYS.split(',');
                }
                
                if (process.env.GEMINI_API_KEYS) {
                    this.keys.gemini = process.env.GEMINI_API_KEYS.split(',');
                }
            } else {
                console.log('Running locally, loading API keys from config file');
                
                // Load API keys from config file
                const configPath = path.join(process.cwd(), 'config', 'api_keys.json');
                
                if (fs.existsSync(configPath)) {
                    const config = await fs.readJson(configPath);
                    this.keys = {
                        openrouter: config.openrouter || [],
                        gemini: config.gemini || []
                    };
                    this.currentIndex = config.currentIndex || {
                        openrouter: 0,
                        gemini: 0
                    };
                    this.lastRotation = config.lastRotation || {
                        openrouter: 0,
                        gemini: 0
                    };
                }
            }
            
            // Validate that we have at least one key for each service
            if (this.keys.openrouter.length === 0) {
                console.warn('No OpenRouter API keys found');
            }
            
            if (this.keys.gemini.length === 0) {
                console.warn('No Gemini API keys found');
            }
            
            this.initialized = true;
            console.log('API key manager initialized');
        } catch (error) {
            console.error('Error initializing API key manager:', error);
        }
    }

    getKey(service) {
        if (!this.initialized) {
            throw new Error('API key manager not initialized');
        }
        
        if (!this.keys[service] || this.keys[service].length === 0) {
            throw new Error(`No API keys available for ${service}`);
        }
        
        const key = this.keys[service][this.currentIndex[service]];
        return key;
    }

    rotateKey(service) {
        if (!this.initialized) {
            throw new Error('API key manager not initialized');
        }
        
        if (!this.keys[service] || this.keys[service].length <= 1) {
            // No need to rotate if we only have one key
            return;
        }
        
        this.currentIndex[service] = (this.currentIndex[service] + 1) % this.keys[service].length;
        this.lastRotation[service] = Date.now();
        
        // Save the updated indices to config file if not on Railway
        const isRailway = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT;
        if (!isRailway) {
            this.saveConfig();
        }
        
        console.log(`Rotated ${service} API key to index ${this.currentIndex[service]}`);
    }

    async saveConfig() {
        try {
            const configDir = path.join(process.cwd(), 'config');
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            const configPath = path.join(configDir, 'api_keys.json');
            await fs.writeJson(configPath, {
                openrouter: this.keys.openrouter,
                gemini: this.keys.gemini,
                currentIndex: this.currentIndex,
                lastRotation: this.lastRotation
            }, { spaces: 2 });
        } catch (error) {
            console.error('Error saving API key config:', error);
        }
    }
}

// Create and export a singleton instance
const apiKeyManager = new ApiKeyManager();
module.exports = apiKeyManager;