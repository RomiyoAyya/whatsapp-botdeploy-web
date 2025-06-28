// Add this at the very top of your index.js file
global.crypto = require('crypto').webcrypto;

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const { handleMessages } = require('./src/messageHandler');
const { setupFolders, getUserData, saveUserData } = require('./src/utils');
const setupRailway = require('./src/railwaySetup');
const backupUtils = require('./src/utils/backupUtils');
const autoMessageUtils = require('./src/utils/autoMessageUtils');
const reminderUtils = require('./src/utils/reminderUtils');
const taskUtils = require('./src/utils/taskUtils');
const { shouldSendSelfMessage, generateSelfMessage, updateChatActivity } = require('./src/utils/selfMessageUtils');
const { shouldSendSticker, analyzeMessageSentiment, generateStickerImage, createWhatsAppSticker } = require('./src/utils/stickerUtils');
const licenseUtils = require('./src/utils/licenseUtils');
require('dotenv').config();

// Create a global Map to store user states
const userStates = new Map();

// Setup necessary folders
setupFolders();

// Add this function to clean up session data when needed
async function cleanupSessionData() {
    console.log('Cleaning up session data...');
    const authFolder = path.join(process.cwd(), 'auth_info_baileys');
    
    try {
        // Check if the folder exists
        if (await fs.pathExists(authFolder)) {
            console.log('Removing existing session data...');
            await fs.remove(authFolder);
            console.log('Session data removed successfully');
        }
        
        // Create empty folder
        await fs.ensureDir(authFolder);
        return true;
    } catch (error) {
        console.error('Error cleaning up session data:', error);
        return false;
    }
}

// Original connect function - we'll replace this with startBot
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom && 
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);
            
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Connection opened');
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const message of messages) {
            if (message.key.fromMe) continue;
            await handleMessages(sock, message);
        }
    });
}

// Modify the startBot function to handle restoration failures better
// Function to set up the self-messaging system
function setupSelfMessagingSystem(sock) {
    console.log('Setting up self-messaging system...');
    // Check for potential self-messages every 30 minutes
    setInterval(async () => {
        try {
            console.log('Checking for potential self-messages...');
            // Get all user data files
            const userDataDir = path.join(process.cwd(), 'user_data');
            if (!fs.existsSync(userDataDir)) {
                return;
            }
            
            const files = fs.readdirSync(userDataDir);
            console.log(`Found ${files.length} user data files`);
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const userId = file.replace('.json', '');
                    const userData = await getUserData(userId);
                    
                    // Skip if no companion set up
                    if (!userData || !userData.companionName) {
                        continue;
                    }
                    
                    // Check if we should send a self-message
                    // Inside the self-message sending code (around line 113)
                    if (shouldSendSelfMessage(userData)) {
                        console.log(`Initiating self-message to user ${userId}`);
                        
                        // Check if conversation history has too many consecutive assistant messages
                        const conversationHistory = userData.conversationHistory || [];
                        let consecutiveAssistantMessages = 0;
                        for (let i = conversationHistory.length - 1; i >= 0; i--) {
                            if (conversationHistory[i].role === "assistant") {
                                consecutiveAssistantMessages++;
                            } else {
                                break;
                            }
                        }
                        
                        if (consecutiveAssistantMessages < 2) {
                            // Generate and send the message
                            const selfMessage = await generateSelfMessage(userData);
                            await sock.sendMessage(userId, { text: selfMessage });
                            
                            // Add to conversation history
                            conversationHistory.push({
                                role: "assistant",
                                content: selfMessage
                            });
                            userData.conversationHistory = conversationHistory;
                            await saveUserData(userId, userData);
                            
                            // Check if we should also send a sticker (premium only)
                            if (userData.isPremium) {
                                const shouldUseStickerResponse = shouldSendSticker(selfMessage, userData);
                                if (shouldUseStickerResponse) {
                                    try { // Add this try statement
                                        // Analyze message sentiment
                                        const emotion = await analyzeMessageSentiment(selfMessage, "");
                                        console.log(`Detected emotion for self-message: ${emotion}`);
                                        
                                        // Generate sticker image
                                        const stickerImagePath = await generateStickerImage(
                                            userData.characterImagePath,
                                            emotion,
                                            selfMessage,
                                            ""
                                        );
                                        
                                        if (stickerImagePath) {
                                            // Create WhatsApp sticker
                                            const stickerBuffer = await createWhatsAppSticker(stickerImagePath);
                                            
                                            // Clean up the sticker image
                                            await fs.remove(stickerImagePath);
                                            
                                            // Send the sticker after a small delay
                                            setTimeout(async () => {
                                                await sock.sendMessage(userId, { sticker: stickerBuffer });
                                            }, 1000);
                                        }
                                    } catch (error) {
                                        console.error('Error generating sticker for self-message:', error);
                                    }
                                }
                            }
                        }
                        
                        // Update chat activity
                        updateChatActivity(userData, false);
                        await saveUserData(userId, userData);
                        
                        // Add to conversation history
                        if (!userData.conversationHistory) {
                            userData.conversationHistory = [];
                        }
                        
                        userData.conversationHistory.push({
                            role: "assistant",
                            content: selfMessage
                        });
                        
                        await saveUserData(userId, userData);
                    }
                }
            }
        } catch (error) {
            console.error('Error in self-messaging system:', error);
        }
    }, 30 * 60 * 1000); // Check every 30 minutes
}

// Add this function to prompt the user for connection method
async function promptConnectionMethod() {
    return new Promise((resolve) => {
        console.log('\nChoose WhatsApp connection method:');
        console.log('1. QR Code (scan with your phone)');
        console.log('2. Pairing Code (enter code on your phone)');
        
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        readline.question('Enter your choice (1 or 2): ', (choice) => {
            readline.close();
            if (choice === '2') {
                resolve('pair');
            } else {
                resolve('qr');
            }
        });
    });
}

// Add this function to handle the pairing code process
async function handlePairingCode(sock) {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve, reject) => {
        readline.question('Enter your WhatsApp number (with country code, e.g., 1XXXXXXXXXX): ', async (number) => {
            try {
                // Remove any non-numeric characters from the input
                const phoneNumber = number.replace(/[^0-9]/g, '');
                
                console.log(`Requesting pairing code for +${phoneNumber}...`);
                const code = await sock.requestPairingCode(phoneNumber);
                
                console.log('\n╔═══════════════════════════════════════╗');
                console.log('║                                       ║');
                console.log(`║   Pairing Code: ${code}   ║`);
                console.log('║                                       ║');
                console.log('╚═══════════════════════════════════════╝\n');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Go to Settings > Linked Devices > Link a Device');
                console.log('3. When the QR code scanner appears, tap "Link with phone number"');
                console.log(`4. Enter the pairing code: ${code}`);
                console.log('\nWaiting for connection...');
                
                readline.close();
                resolve();
            } catch (error) {
                console.error('Error requesting pairing code:', error);
                readline.close();
                reject(error);
            }
        });
    });
}

// Modify the startBot function to initialize auto messaging and reminder system
// Add this variable at the top level, after the userStates declaration
let justPaired = false;

// Modify the startBot function to handle reconnection after pairing
async function startBot() {
    try {
        console.log('Starting bot...');

        // Set up necessary folders
        setupFolders();

        // Load license information at startup
        await licenseUtils.loadLicenseInfo();

        // Initialize backup system
        backupUtils.initializeBackupOnStartup();

        // Check for command line arguments
        const args = process.argv.slice(2);
        const shouldCleanup = args.includes('--clean') || args.includes('-c');
        const skipRestore = args.includes('--skip-restore') || args.includes('-s');
        const usePairingCode = args.includes('--pair') || args.includes('-p');

        try {
            // Clean up session if requested
            if (shouldCleanup) {
                await cleanupSessionData();
                justPaired = false; // Reset the pairing flag if we're cleaning up
            }

            // Attempt to restore data from backup before starting
            if (!skipRestore) {
                console.log('Attempting to restore session data from backup...');
                try {
                    const restorationPromise = backupUtils.performStartupRestore();
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Restoration process timed out')), 180000); // Increased from 60000 to 180000 (3 minutes)
                    });

                    const restored = await Promise.race([restorationPromise, timeoutPromise]);

                    if (restored) {
                        console.log('Restoration process completed successfully');
                    } else {
                        console.log('Restoration process completed, but no backup was found or restored');
                    }
                } catch (error) {
                    console.error('Error during startup restoration:', error);
                    console.log('Proceeding with bot startup using local data');
                }
            } else {
                console.log('Skipping restoration as requested');
            }

            let connectionAttempts = 0;
            const maxAttempts = 3;

            while (connectionAttempts < maxAttempts) {
                try {
                    connectionAttempts++;
                    console.log(`Connection attempt ${connectionAttempts}/${maxAttempts}...`);

                    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

                    // Ask user for connection method if not specified in command line
                    // Skip asking for connection method if we just paired successfully
                    let connectionMethod = 'qr';
                    if (justPaired) {
                        console.log('Reconnecting after successful pairing...');
                        // Use QR method which will automatically use saved credentials
                    } else if (usePairingCode) {
                        connectionMethod = 'pair';
                    } else {
                        connectionMethod = await promptConnectionMethod();
                    }

                    const sock = makeWASocket({
                        auth: state,
                        printQRInTerminal: connectionMethod === 'qr',
                        defaultQueryTimeoutMs: 60000,
                        browser: ['Ubuntu', 'Chrome', '22.04.4'],
                        syncFullHistory: false,
                        markOnlineOnConnect: false,
                        connectTimeoutMs: 60000,
                        keepAliveIntervalMs: 25000,
                        retryRequestDelayMs: 2000,
                        maxRetries: 5
                    });

                    // If pairing code method is selected, request a pairing code
                    if (connectionMethod === 'pair') {
                        await handlePairingCode(sock);
                    }

                    sock.ev.on('connection.update', async (update) => {
                        const { connection, lastDisconnect, qr, isNewLogin } = update;
                        
                        // Display QR code when available
                        if (qr && connectionMethod === 'qr') {
                            console.log('\nScan the QR code below to log in:\n');
                            qrcode.generate(qr, { small: true });
                        }
                        
                        // Set the justPaired flag if this is a new login
                        if (isNewLogin) {
                            justPaired = true;
                            console.log('New device paired successfully!');
                        }
                        
                        if (connection === 'close') {
                            const shouldReconnect = (lastDisconnect.error instanceof Boom &&
                                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);

                            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);

                            if (shouldReconnect) {
                                startBot();
                            } else {
                                // If we're not reconnecting, reset the justPaired flag
                                justPaired = false;
                            }
                        } else if (connection === 'open') {
                            console.log('Connection opened');
                            // Reset the justPaired flag as we're now connected
                            justPaired = false;

                            global.whatsappSocket = sock;

                            const licenseValid = await checkLicenseStatus(sock);
                            global.licenseValid = licenseValid;

                            autoMessageUtils.initializeAutoMessaging(sock);
                            reminderUtils.initializeReminderSystem(sock);
                            setupSelfMessagingSystem(sock);

                            setInterval(() => checkExpiredPremiumUsers(sock), 15 * 60 * 1000);
                            checkExpiredPremiumUsers(sock);

                            const botOwner = process.env.BOT_OWNER;
                            setInterval(() => taskUtils.checkExpiredTasks(sock, botOwner), 15 * 60 * 1000);
                            setInterval(() => taskUtils.checkExpiredTaskTrials(sock), 15 * 60 * 1000);
                            taskUtils.checkExpiredTasks(sock, botOwner);
                            taskUtils.checkExpiredTaskTrials(sock);

                            setInterval(() => checkLicenseStatus(sock), 15 * 60 * 1000);
                        }
                    });

                    sock.ev.on('creds.update', saveCreds);

                    // In the connection.update event handler section (around line 270)
                    sock.ev.on('messages.upsert', async ({ messages }) => {
                        for (const message of messages) {
                            if (message.key.fromMe) continue;
                            await handleMessages(sock, message, userStates);
                        }
                    });

                    return;
                } catch (error) {
                    console.error(`Connection attempt ${connectionAttempts} failed:`, error);

                    if (connectionAttempts >= maxAttempts) {
                        console.error('Maximum connection attempts reached. Cleaning up session and trying one last time...');
                        await cleanupSessionData();

                        try {
                            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
                            const sock = makeWASocket({
                                auth: state,
                                printQRInTerminal: true,
                                defaultQueryTimeoutMs: 60000,
                                browser: ['Ubuntu', 'Chrome', '22.04.4'],
                                syncFullHistory: false
                            });

                            sock.ev.on('connection.update', async (update) => {
                                const { connection, lastDisconnect } = update;

                                if (connection === 'close') {
                                    const shouldReconnect = (lastDisconnect.error instanceof Boom &&
                                        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);

                                    console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);

                                    if (shouldReconnect) {
                                        startBot();
                                    }
                                } else if (connection === 'open') {
                                    console.log('Connection opened');
                                    autoMessageUtils.initializeAutoMessaging(sock);
                                    reminderUtils.initializeReminderSystem(sock);
                                    setupSelfMessagingSystem(sock);
                                }
                            });

                            sock.ev.on('creds.update', saveCreds);

                            sock.ev.on('messages.upsert', async ({ messages }) => {
                                for (const message of messages) {
                                    if (message.key.fromMe) continue;
                                    await handleMessages(sock, message, userStates);
                                }
                            });

                            return;
                        } catch (finalError) {
                            console.error('Final connection attempt failed:', finalError);
                            throw new Error('Unable to connect to WhatsApp after multiple attempts');
                        }
                    }

                    console.log(`Waiting 5 seconds before next attempt...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            console.error('Fatal error during bot startup:', error);
            process.exit(1);
        }
    } catch (error) {
        console.error('Unexpected top-level error in startBot:', error);
        process.exit(1);
    }
}


// Modify the checkExpiredPremiumUsers function to accept sock as a parameter
// Add this function to check for expired premium users
// In the checkExpiredPremiumUsers function
async function checkExpiredPremiumUsers(sock) {
    try {
        console.log('Checking for expired premium users...');
        
        // Get all user data files
        const userDataDir = path.join(process.cwd(), 'user_data');
        if (!fs.existsSync(userDataDir)) {
            return;
        }
        
        const files = fs.readdirSync(userDataDir);
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const userId = file.replace('.json', '');
                const userData = await getUserData(userId);
                
                if (userData && userData.isPremium && userData.premiumExpiry) {
                    const expiryDate = new Date(userData.premiumExpiry);
                    const now = new Date();
                    
                    // If premium has expired, update the user data
                    if (expiryDate <= now) {
                        console.log(`Premium expired for user ${userId}`);
                        userData.isPremium = false;
                        userData.premiumExpiredAt = now.toISOString();
                        
                        // Special handling for free trial expiration
                        if (userData.isFreeTrial) {
                            userData.isFreeTrial = false;
                            
                            // Clear memory data for free trial users when trial expires
                            userData.memory = {
                                topics: {},
                                preferences: {},
                                importantEvents: [],
                                lastInteractionSummary: ""
                            };
                            
                            // Notify the user with a special message for trial expiration
                            try {
                                await sock.sendMessage(userId, { 
                                    text: `⏰ *Your Premium Trial Has Ended* ⏰\n\nYour 1-hour free premium trial has expired. You've been returned to the free tier with limited features. Memory data from your trial period has been cleared. Type /premium to upgrade and continue enjoying premium benefits!` 
                                });
                            } catch (notifyError) {
                                console.error(`Error notifying user ${userId} about trial expiry:`, notifyError);
                            }
                        } else {
                            // Regular premium expiration notification
                            try {
                                await sock.sendMessage(userId, { 
                                    text: `⚠️ Your premium access has expired. You've been returned to free tier with limited features. Type /premium to renew your premium access!` 
                                });
                            } catch (notifyError) {
                                console.error(`Error notifying user ${userId} about premium expiry:`, notifyError);
                            }
                        }
                        
                        await saveUserData(userId, userData);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error checking expired premium users:', error);
    }
}

// Add this variable to track previous license status
let previousLicenseStatus = null;

// Add this function to check license status
async function checkLicenseStatus(sock) {
    try {
        const botNumber = process.env.BOT_NUMBER || sock.user.id.split(':')[0];
        const botOwner = process.env.BOT_OWNER;
        
        console.log('Checking bot license status...');
        const status = await licenseUtils.checkBotStatus(botNumber);
        
        // Get current license status
        const currentStatus = status.success && status.registered ? 
            (status.license_info.status || 'unknown') : 'invalid';
        
        // Check if license just expired (was active before, now expired)
        if (previousLicenseStatus === 'active' && currentStatus === 'expired') {
            console.log('License just expired! Sending immediate notification to owner');
            
            // Send immediate notification to bot owner
            if (botOwner) {
                await sock.sendMessage(botOwner, { 
                    text: `🚨 *URGENT: Bot License Expired* 🚨\n\nYour bot license has just expired. The bot will not process messages from users until a new license is purchased.\n\nPlease purchase a new license key and register using the command "/register YOUR-LICENSE-KEY".\n\nTo purchase a key, please contact the bot creator at: wa.me/94767043432` 
                });
            }
        }
        
        // Update previous status for next check
        previousLicenseStatus = currentStatus;
        
        if (!status.success || !status.registered) {
            console.log('Bot is not registered or license is invalid');
            
            // Notify the bot owner
            if (botOwner) {
                await sock.sendMessage(botOwner, { 
                    text: `⚠️ *Bot License Alert* ⚠️\n\nYour bot is not registered or the license has expired. The bot will not process messages from users until registered with a valid license.\n\nUse the command "/register YOUR-LICENSE-KEY" to register the bot.\n\nTo purchase a key, please contact the bot creator at: wa.me/94767043432` 
                });
            }
            
            return false;
        }
        
        // Check if license is about to expire (within 3 days)
        if (status.license_info.expires_at) {
            const expiryDate = new Date(status.license_info.expires_at);
            const now = new Date();
            const daysUntilExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
            
            if (daysUntilExpiry <= 3 && daysUntilExpiry > 0) {
                // Notify the bot owner about upcoming expiration
                if (botOwner) {
                    await sock.sendMessage(botOwner, { 
                        text: `⚠️ *License Expiring Soon* ⚠️\n\nYour bot license will expire in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? 's' : ''}. Please generate a new license to avoid service interruption.\n\nTo purchase a key, please contact the bot creator at: wa.me/94767043432` 
                    });
                }
            }
        }
        
        console.log('Bot license is valid:', status.license_info.package_type);
        return true;
    } catch (error) {
        console.error('Error checking license status:', error);
        return false;
    }
}

// Add a process error handler to prevent crashes
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

// Call only the startBot function, not both
startBot().catch(err => {
    console.error('Fatal error during bot startup:', err);
    process.exit(1);
});
