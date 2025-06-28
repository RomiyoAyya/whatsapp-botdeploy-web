const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Check if we're running on Railway
const isRailway = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT;

// Storage utility functions
const storageUtils = {
    // Initialize storage
    async initialize() {
        console.log(isRailway ? 'Running on Railway' : 'Running locally');
        
        // Create local directories for temporary storage regardless of environment
        const directories = ['user_data', 'character_images', 'generated_images', 'voice_messages', 'config', 'auth_info_baileys'];
        for (const dir of directories) {
            const dirPath = path.join(process.cwd(), dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }
        
        console.log('Local directories created');
    },
    
    // Save user data
    async saveUserData(userId, data) {
        try {
            const userDataDir = path.join(process.cwd(), 'user_data');
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            
            const filePath = path.join(userDataDir, `${userId}.json`);
            await fs.writeJson(filePath, data, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('Error saving user data:', error);
            return false;
        }
    },
    
    // Get user data
    async getUserData(userId) {
        try {
            const filePath = path.join(process.cwd(), 'user_data', `${userId}.json`);
            if (fs.existsSync(filePath)) {
                return await fs.readJson(filePath);
            }
            return null;
        } catch (error) {
            console.error('Error getting user data:', error);
            return null;
        }
    },
    
    // Save character image
    async saveCharacterImage(userId, imagePath) {
        try {
            const characterImagesDir = path.join(process.cwd(), 'character_images');
            if (!fs.existsSync(characterImagesDir)) {
                fs.mkdirSync(characterImagesDir, { recursive: true });
            }
            
            const fileName = `${userId}_${Date.now()}.jpg`;
            const destPath = path.join(characterImagesDir, fileName);
            
            await fs.copy(imagePath, destPath);
            return destPath;
        } catch (error) {
            console.error('Error saving character image:', error);
            return null;
        }
    },
    
    // Save config
    async saveConfig(config) {
        try {
            const configDir = path.join(process.cwd(), 'config');
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            const filePath = path.join(configDir, 'api_keys.json');
            await fs.writeJson(filePath, config, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('Error saving config:', error);
            return false;
        }
    },
    
    // Perform periodic backup - dummy function for Railway
    async performPeriodicBackup() {
        try {
            if (isRailway) {
                console.log('Periodic backup skipped - using Railway storage');
                return true;
            }
            
            // For local environment, implement backup logic
            // This could be expanded to use cloud storage, external drives, etc.
            const backupDir = path.join(process.cwd(), 'backups', new Date().toISOString().split('T')[0]);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Backup user data
            const userDataDir = path.join(process.cwd(), 'user_data');
            const userDataBackupDir = path.join(backupDir, 'user_data');
            if (fs.existsSync(userDataDir)) {
                await fs.copy(userDataDir, userDataBackupDir);
            }
            
            // Backup character images
            const characterImagesDir = path.join(process.cwd(), 'character_images');
            const characterImagesBackupDir = path.join(backupDir, 'character_images');
            if (fs.existsSync(characterImagesDir)) {
                await fs.copy(characterImagesDir, characterImagesBackupDir);
            }
            
            // Backup config files
            const configDir = path.join(process.cwd(), 'config');
            const configBackupDir = path.join(backupDir, 'config');
            if (fs.existsSync(configDir)) {
                await fs.copy(configDir, configBackupDir);
            }
            
            console.log(`Backup completed to ${backupDir}`);
            return true;
        } catch (error) {
            console.error('Error performing backup:', error);
            return false;
        }
    }
};

module.exports = storageUtils;