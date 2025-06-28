// License verification utilities
const axios = require('axios');
require('dotenv').config();

// Supabase project ID from the API documentation
const projectId = "lkerdiuhhplfeonbcpmo";
const baseUrl = `https://${projectId}.supabase.co/functions/v1`;

// Supabase anon key for authorization
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrZXJkaXVoaHBsZmVvbmJjcG1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgyNzEzNzEsImV4cCI6MjA2Mzg0NzM3MX0.4EMvrM59SgWyRz-OV0OdwcSgDTHWbfE5xyKGys0KWC8";

// Store license info in memory
let licenseInfo = null;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes

/**
 * Register the bot with a license key
 * @param {string} licenseKey - The license key to register
 * @param {string} botNumber - The bot's WhatsApp number
 * @returns {Promise<Object>} - Registration result
 */
async function registerBot(licenseKey, botNumber) {
  try {
    const response = await axios.post(`${baseUrl}/register-bot`, {
      license_key: licenseKey,
      bot_number: botNumber
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    
    // Store license info if registration was successful
    if (response.data.success) {
      licenseInfo = response.data.license_info;
      lastCheckTime = Date.now();
      
      // Save license info to a file for persistence across restarts
      const fs = require('fs-extra');
      const path = require('path');
      const configDir = path.join(process.cwd(), 'config');
      fs.ensureDirSync(configDir);
      
      await fs.writeJson(path.join(configDir, 'license.json'), {
        botNumber,
        licenseInfo,
        lastCheckTime
      });
    }
    
    return response.data;
  } catch (error) {
    console.error('Error registering bot:', error.message);
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to register bot'
    };
  }
}

/**
 * Check if the bot is registered and has a valid license
 * @param {string} botNumber - The bot's WhatsApp number
 * @returns {Promise<Object>} - License status
 */
async function checkBotStatus(botNumber) {
  try {
    // Only check if enough time has passed since last check
    const now = Date.now();
    if (licenseInfo && (now - lastCheckTime < CHECK_INTERVAL)) {
      return {
        success: true,
        registered: true,
        message: 'Using cached license info',
        license_info: licenseInfo
      };
    }
    
    const response = await axios.post(`${baseUrl}/check-bot-status`, {
      bot_number: botNumber
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    
    // Update cached license info
    if (response.data.success) {
      licenseInfo = response.data.license_info;
      lastCheckTime = now;
      
      // Update saved license info
      const fs = require('fs-extra');
      const path = require('path');
      await fs.writeJson(path.join(process.cwd(), 'config', 'license.json'), {
        botNumber,
        licenseInfo,
        lastCheckTime
      });
    } else {
      // Clear license info if check failed
      licenseInfo = null;
    }
    
    return response.data;
  } catch (error) {
    console.error('Error checking bot status:', error.message);
    return {
      success: false,
      registered: false,
      message: error.response?.data?.message || 'Failed to check bot status'
    };
  }
}

/**
 * Load saved license info from file on startup
 */
async function loadLicenseInfo() {
  try {
    const fs = require('fs-extra');
    const path = require('path');
    const licensePath = path.join(process.cwd(), 'config', 'license.json');
    
    if (await fs.pathExists(licensePath)) {
      const data = await fs.readJson(licensePath);
      licenseInfo = data.licenseInfo;
      lastCheckTime = data.lastCheckTime;
      
      // Verify the loaded license is still valid
      await checkBotStatus(data.botNumber);
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error loading license info:', error.message);
    return false;
  }
}

module.exports = {
  registerBot,
  checkBotStatus,
  loadLicenseInfo
};