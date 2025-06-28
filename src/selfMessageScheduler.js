const fs = require('fs-extra');
const path = require('path');
const { getUserData } = require('./utils');
const { shouldSendSelfMessage, sendSelfMessage } = require('./utils/selfMessageUtils');

/**
 * Scheduler for self-initiated messages
 * @param {Object} sock - The WhatsApp socket
 */
async function startSelfMessageScheduler(sock) {
    console.log('Starting self-message scheduler...');
    
    // Check every 30 minutes
    const checkInterval = 1 * 60 * 1000;
    
    setInterval(async () => {
        try {
            console.log('Running self-message scheduler check...');
            
            // Get all user data files
            const userDataDir = path.join(process.cwd(), 'user_data');
            if (!fs.existsSync(userDataDir)) {
                return;
            }
            
            const files = await fs.readdir(userDataDir);
            const userDataFiles = files.filter(file => file.endsWith('.json'));
            
            for (const file of userDataFiles) {
                try {
                    const userId = file.replace('.json', '');
                    const userData = await getUserData(userId);
                    
                    // Skip users without a companion
                    if (!userData || !userData.companionName) {
                        continue;
                    }
                    
                    // Check if we should send a self-message
                    if (shouldSendSelfMessage(userData)) {
                        await sendSelfMessage(sock, userId, userData);
                        console.log(`Sent self-message to ${userId}`);
                    }
                } catch (userError) {
                    console.error(`Error processing user ${file}:`, userError);
                    // Continue with next user
                }
            }
        } catch (error) {
            console.error('Error in self-message scheduler:', error);
        }
    }, checkInterval);
    
    console.log(`Self-message scheduler started, checking every ${checkInterval/60000} minutes`);
}

module.exports = { startSelfMessageScheduler };