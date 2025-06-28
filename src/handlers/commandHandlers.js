const path = require('path');
const fs = require('fs-extra');
const apiKeyManager = require('../apiKeyManager');
const { saveUserData, getUserData, isPremiumUser } = require('../utils');
const backupUtils = require('../utils/backupUtils');
const autoMessageUtils = require('../utils/autoMessageUtils'); 
const reminderUtils = require('../utils/reminderUtils');
const taskUtils = require('../utils/taskUtils');
const licenseUtils = require('../utils/licenseUtils');

// Command handlers
const commandHandlers = {
   '/help': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        const isPremium = await isPremiumUser(userId);
        
        // Basic help text for all users
        let helpText = `*╔══════ WhatsApp AI Companion ══════╗*
*║                Help Menu                ║*
*╚═══════════════════════════════════╝*

*🤖 Basic Commands*
┌─────────────────────────
├ • /create - Create your AI companion
├ • /reset - Reset your AI companion
├ • /premium - Upgrade to premium
└─────────────────────────

*📷 Image Generation*
┌─────────────────────────
├ • Send message: "Send me your picture [description]"
│   Create an image of your AI character in any scene
│   Example: "Send me your picture in a garden"
│
├ • Send photo with caption: "/collob [description]"
│   Create a collaborative image with you and AI together
│   Example: Send selfie with caption "/collob taking a selfie together at the beach"
│
├ • Natural Photo Requests
│   Simply ask in natural language like:
│   "Show me a picture of you"
│   "Can I see you now ?"
└─────────────────────────

*⚙️ Auto Message Settings*
┌─────────────────────────
├ • /automsg on - Enable auto messages
├ • /automsg off - Disable auto messages
├ • /automsg status - Check current status
└─────────────────────────

*⏰ Reminder Commands*
┌─────────────────────────
├ • /remind [time] to [text] - Set a reminder
├ • /reminders - List all your reminders
├ • /delreminder [id] - Delete a reminder
│
├ *Examples:*
├ • /remind tomorrow at 3pm to call mom
├ • /remind in 2 hours to take medicine
├ • /remind 5/20 at 9am to attend meeting
├ • /remind today at 12:02pm to eat lunch
│
├ *Natural Language:*
├ • Simply type phrases like:
├ • "remind me to call mom at 3pm"
├ • "remind me in 2 hours to take medicine"
├ • "remind me to check email tomorrow morning"
└─────────────────────────

*🎯 Task Commands*
┌─────────────────────────
├ • /task - View available tasks
├ • /taskkey [task name] [key] - Complete a task
│
├ *Example:*
├ • /taskkey Hyper abc123
└─────────────────────────`;

        // Add bot owner commands if the user is the bot owner
        if (userId === botOwner) {
            helpText += `

*🔐 Bot Owner Commands*
┌─────────────────────────
├ *Premium Management:*
├ • /add prem [duration] [phone_number]
├ • /del prem [phone_number]
├ • /listprem - List all premium users
│
├ *Duration Options:*
├ • lifetime - Never expires
├ • 1h to 24h - Hours
├ • 1d to 30d - Days
│
├ *Examples:*
├ • /add prem lifetime 94767043432
├ • /add prem 12h 94767043432
├ • /add prem 7d 94767043432
│
├ *Backup Management:*
├ • /backup - Backup to Mega.nz
├ • /restore - Restore from backup
├ • /autobackup on|off - Toggle auto backups
├ • /autobackup status - Check status
│
├ *API Key Management:*
├ • /addkey [service] [key]
├ • /delkey [service] [key]
├ • /listkeys - List all API keys
│
├ *Services:*
├ • openrouter - AI option
├ • gemini - Image generation
├ • gemini_flash - AI responses
│
├ *Task Management:*
├ • /addtask [name] [description] [max] [key] 
│   [key link] [premium duration] [expire duration]
├ • /deltask [task name]
├ • /listtasks - List all tasks
│
├ *Example:*
├ • /addtask Hyper 'Happy Birthday Giveaway' 5 
│   abc123 www.example.com/key 1h 24h
└─────────────────────────`;
        }
        
        // Add premium user commands if the user is premium
        if (isPremium) {
            helpText += `

*💎 Premium Features*
┌─────────────────────────
├ • Unlimited daily messages
├ • Enhanced memory and context
├ • Unlimited image generation
├ • Priority response times
├ • Exclusive premium-only features
└─────────────────────────`;
        } else {
            helpText += `

*⚠️ Free Tier Limitations*
┌─────────────────────────
├ • 100 messages per day
├ • Limited memory and context
├ • 3 image generations per day
├ • Type /premium to upgrade!
└─────────────────────────`;
        }
         // Add GitHub installation information
        helpText += `

*🤖✨ Install Your Own Bot*
┌─────────────────────────
├ 🌟 *Want to run this bot yourself?* 🌟
├ You can install and customize your own
├ WhatsApp AI Roleplay Bot!
│
├ 📱 Perfect for personal use or creating your own service
├ 🔧 Full source code available
├ 🚀 Easy deployment options
├ 💰 Monetize your bot with premium features
│
├ *Get Started:*
├ 👉 github.com/HYPER-MODZ/Whatsapp-Ai-Roleplay-Bot
│
├ *Features:*
├ • AI character roleplay
├ • Image generation
├ • Premium user system
├ • Task & reminder management
├ • And much more!
└─────────────────────────`;

        // Send the help text to the user
        await sock.sendMessage(userId, { text: helpText });
    },
    
    // In the /create command handler:
    '/create': async (sock, message, args, userStates) => {
        const userId = message.key.remoteJid;
        
        // Check if user already has a character
        const userData = await getUserData(userId);
        
        if (userData && userData.companionName) {
            // User already has a character, tell them to reset first
            await sock.sendMessage(userId, { 
                text: `You already have an AI companion named "${userData.companionName}". Please use /reset first if you want to create a new companion.` 
            });
            return;
        }
        
        // No existing character or character was reset, proceed with creation
        userStates.set(userId, { 
            state: 'awaiting_user_gender',
            userData: {}
        });
        
        await sock.sendMessage(userId, { 
            text: "✨ Welcome to the AI Companion Creation! To create your perfect companion, I'd love to know your gender first. Are you male or female? (Please type 'male' or 'female') 💫"
        });
    },
    
    '/reset': async (sock, message, args, userStates) => {
        const userId = message.key.remoteJid;
        
        try {
            // Get user data
            const userData = await getUserData(userId);
            
            if (!userData) {
                await sock.sendMessage(userId, { 
                    text: "✨ Welcome! I notice you don't have an AI companion yet.\n\n🤖 Type */create* to begin your magical journey with your very own AI friend!\n\n💡 Need help? Type */help* to discover all the amazing features and commands available to you! Let's make something special together! ✨"
                });
                return;
            }
            
            // Check if user has reached reset limit (for non-premium users)
            const isPremium = await isPremiumUser(userId);
            userData.resetCount = userData.resetCount || 0;
            
            if (!isPremium && userData.resetCount >= 2) {
                await sock.sendMessage(userId, { 
                    text: `You've reached your free reset limit! 🔄\n\nTo reset your AI companion again, you'll need to upgrade to a premium package. Premium users enjoy unlimited resets and many other benefits!\n\nTo upgrade, contact +94767043432 or type /premium for more information.` 
                });
                return;
            }
            
            // Ask for confirmation
            await sock.sendMessage(userId, { 
                text: `Are you sure you want to reset your AI companion "${userData.companionName}"? This will delete all your conversation history and character settings. Type "yes" to confirm or "no" to cancel.` 
            });
            
            // Store user in reset confirmation state
            userStates.set(userId, {
                state: 'reset_confirmation',
                userData: userData
            });
            
        } catch (error) {
            console.error('Error handling reset command:', error);
            await sock.sendMessage(userId, { 
                text: "There was an error processing your request. Please try again later." 
            });
        }
    },
    
    '/premium': async (sock, message) => {
        const premiumText = `*Premium Features* ✨

- Unlimited high-quality images
- No image blurring
- Priority response times
- Custom scenarios
- Extended conversation memory
- Unlimited daily messages
- Enhanced AI responses
- Exclusive premium-only commands
- Unlimited image generation
- Advanced character customization
- Priority support access
- Custom reminder intervals
- Extended task rewards
- Premium-only events access
- Special holiday themes
- Custom voice messages
- Collaborative image creation
- Advanced chat features
- Premium chat backgrounds
- Exclusive seasonal content

To upgrade to premium, contact +94767043432`;

        await sock.sendMessage(message.key.remoteJid, { text: premiumText });
    },
    
    '/add': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only bot owner can use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
            return;
        }
        
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        const args = messageText.split(' ').slice(1);
        
        if (args.length < 2) {
            await sock.sendMessage(userId, { text: "❌ Usage: /add prem [duration] [phone_number]" });
            return;
        }
        
        const action = args[0].toLowerCase();
        
        if (action === 'prem') {
            // Format: /add prem [duration] [phone_number]
            // Examples: 
            // /add prem lifetime 94767043432
            // /add prem 1h 94767043432
            // /add prem 24h 94767043432
            // /add prem 1d 94767043432
            // /add prem 30d 94767043432
            
            if (args.length < 3) {
                await sock.sendMessage(userId, { 
                    text: "❌ Usage: /add prem [duration] [phone_number]\n\nDuration options:\n- lifetime\n- 1h to 24h (hours)\n- 1d to 30d (days)" 
                });
                return;
            }
            
            const duration = args[1].toLowerCase();
            let phoneNumber = args[2];
            
            // Add @s.whatsapp.net if not present
            if (!phoneNumber.includes('@')) {
                phoneNumber = `${phoneNumber}@s.whatsapp.net`;
            }
            
            // Calculate expiry date based on duration
            let expiryDate = null;
            let durationText = '';
            
            if (duration === 'lifetime') {
                // No expiry for lifetime
                expiryDate = null;
                durationText = 'lifetime';
            } else if (duration.endsWith('h')) {
                // Hours duration
                const hours = parseInt(duration.slice(0, -1));
                
                if (isNaN(hours) || hours < 1 || hours > 24) {
                    await sock.sendMessage(userId, { 
                        text: "❌ Invalid hours duration. Please use a value between 1h and 24h." 
                    });
                    return;
                }
                
                expiryDate = new Date(Date.now() + hours * 60 * 60 * 1000);
                durationText = `${hours} hour${hours > 1 ? 's' : ''}`;
            } else if (duration.endsWith('d')) {
                // Days duration
                const days = parseInt(duration.slice(0, -1));
                
                if (isNaN(days) || days < 1 || days > 30) {
                    await sock.sendMessage(userId, { 
                        text: "❌ Invalid days duration. Please use a value between 1d and 30d." 
                    });
                    return;
                }
                
                expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                durationText = `${days} day${days > 1 ? 's' : ''}`;
            } else {
                await sock.sendMessage(userId, { 
                    text: "❌ Invalid duration format. Use 'lifetime', '1h' to '24h', or '1d' to '30d'." 
                });
                return;
            }
            
            try {
                // Get user data
                const userData = await getUserData(phoneNumber) || {};
                
                // Update premium status
                userData.isPremium = true;
                userData.premiumExpiry = expiryDate ? expiryDate.toISOString() : null;
                userData.premiumAddedAt = new Date().toISOString();
                userData.premiumAddedBy = userId;
                userData.premiumDuration = durationText;
                
                // Save user data
                await saveUserData(phoneNumber, userData);
                
                // Send confirmation message
                const expiryText = expiryDate 
                    ? `\nExpires on: ${expiryDate.toLocaleString()}` 
                    : '\nDuration: Lifetime (never expires)';
                
                await sock.sendMessage(userId, { 
                    text: `✅ Premium access granted to ${phoneNumber.split('@')[0]} for ${durationText}.${expiryText}` 
                });
                
                // Notify the user who received premium
                await sock.sendMessage(phoneNumber, { 
                    text: `🌟 Congratulations! You've been granted premium access for ${durationText}!${expiryText}\n\nEnjoy all premium features including unlimited messages, enhanced memory, and more!` 
                });
                
            } catch (error) {
                console.error('Error adding premium:', error);
                await sock.sendMessage(userId, { 
                    text: "❌ Error adding premium. Please try again." 
                });
            }
        } else {
            await sock.sendMessage(userId, { 
                text: "❌ Unknown add command. Available options: prem" 
            });
        }
    },
    
    '/del': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only bot owner can use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
            return;
        }
        
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        const args = messageText.split(' ').slice(1);
        
        if (args.length < 2) {
            await sock.sendMessage(userId, { text: "❌ Usage: /del prem [phone_number]" });
            return;
        }
        
        const action = args[0].toLowerCase();
        
        if (action === 'prem') {
            let phoneNumber = args[1];
            
            // Add @s.whatsapp.net if not present
            if (!phoneNumber.includes('@')) {
                phoneNumber = `${phoneNumber}@s.whatsapp.net`;
            }
            
            try {
                // Get user data
                const userData = await getUserData(phoneNumber);
                
                if (!userData) {
                    await sock.sendMessage(userId, { 
                        text: `❌ User ${phoneNumber.split('@')[0]} not found.` 
                    });
                    return;
                }
                
                if (!userData.isPremium) {
                    await sock.sendMessage(userId, { 
                        text: `❌ User ${phoneNumber.split('@')[0]} does not have premium access.` 
                    });
                    return;
                }
                
                // Remove premium status
                userData.isPremium = false;
                userData.premiumExpiry = null;
                userData.premiumRemovedAt = new Date().toISOString();
                userData.premiumRemovedBy = userId;
                
                // Save user data
                await saveUserData(phoneNumber, userData);
                
                // Send confirmation message
                await sock.sendMessage(userId, { 
                    text: `✅ Premium access removed from ${phoneNumber.split('@')[0]}.` 
                });
                
                // Notify the user who lost premium
                await sock.sendMessage(phoneNumber, { 
                    text: `⚠️ Your premium access has been removed. You've been returned to free tier with limited features.` 
                });
                
            } catch (error) {
                console.error('Error removing premium:', error);
                await sock.sendMessage(userId, { 
                    text: "❌ Error removing premium. Please try again." 
                });
            }
        } else {
            await sock.sendMessage(userId, { 
                text: "❌ Unknown del command. Available options: prem" 
            });
        }
    },
    
    '/listprem': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only bot owner can use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
            return;
        }
        
        try {
            // Get all user data files
            const userDataDir = path.join(process.cwd(), 'user_data');
            const files = await fs.readdir(userDataDir);
            
            // Filter premium users
            const premiumUsers = [];
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const userData = await fs.readJson(path.join(userDataDir, file));
                    
                    if (userData.isPremium) {
                        const phoneNumber = file.replace('.json', '');
                        
                        // Calculate remaining time if applicable
                        let remainingTime = '';
                        let status = 'Active';
                        
                        if (userData.premiumExpiry) {
                            const expiryDate = new Date(userData.premiumExpiry);
                            const now = new Date();
                            
                            if (expiryDate > now) {
                                const diffMs = expiryDate - now;
                                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                                const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                                
                                if (diffDays > 0) {
                                    remainingTime = `${diffDays}d ${diffHours}h ${diffMinutes}m remaining`;
                                } else if (diffHours > 0) {
                                    remainingTime = `${diffHours}h ${diffMinutes}m remaining`;
                                } else {
                                    remainingTime = `${diffMinutes}m remaining`;
                                }
                            } else {
                                status = 'Expired';
                                remainingTime = 'Expired';
                            }
                        } else {
                            remainingTime = 'Never expires';
                        }
                        
                        premiumUsers.push({
                            phoneNumber,
                            addedAt: userData.premiumAddedAt ? new Date(userData.premiumAddedAt).toLocaleString() : 'Unknown',
                            expiry: userData.premiumExpiry ? new Date(userData.premiumExpiry).toLocaleString() : 'Never',
                            duration: userData.premiumDuration || 'Lifetime',
                            remainingTime,
                            status
                        });
                    }
                }
            }
            
            if (premiumUsers.length === 0) {
                await sock.sendMessage(userId, { 
                    text: "📊 No premium users found." 
                });
                return;
            }
            
            // Format the list
            let message = "📊 *Premium Users List*\n\n";
            
            premiumUsers.forEach((user, index) => {
                message += `*${index + 1}. ${user.phoneNumber.split('@')[0]}*\n`;
                message += `   Status: ${user.status}\n`;
                message += `   Added: ${user.addedAt}\n`;
                message += `   Duration: ${user.duration}\n`;
                message += `   Expires: ${user.expiry}\n`;
                message += `   Remaining: ${user.remainingTime}\n\n`;
            });
            
            await sock.sendMessage(userId, { text: message });
            
        } catch (error) {
            console.error('Error listing premium users:', error);
            await sock.sendMessage(userId, { 
                text: "❌ Error listing premium users. Please try again." 
            });
        }
    },

    '/addtask': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only bot owner can use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
            return;
        }
        
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        // Split the command into parts, preserving quoted strings
        const parts = [];
        let currentPart = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < messageText.length; i++) {
            const char = messageText[i];
            
            if ((char === "'" || char === '"') && (i === 0 || messageText[i-1] !== '\\')) {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar) {
                    inQuotes = false;
                    quoteChar = '';
                } else {
                    currentPart += char;
                }
            } else if (char === ' ' && !inQuotes && currentPart !== '') {
                parts.push(currentPart);
                currentPart = '';
            } else {
                currentPart += char;
            }
        }
        
        if (currentPart !== '') {
            parts.push(currentPart);
        }
        
        // Remove the command itself
        if (parts[0] && parts[0].toLowerCase() === '/addtask') {
            parts.shift();
        }
        
        // Check if we have all required parameters
        if (parts.length < 7) {
            await sock.sendMessage(userId, { 
                text: "Invalid format. Please use:\n*/addtask [task name] [description] [max completions] [key] [key link] [premium duration] [expire duration]*\n\nExample: */addtask \"Birthday Task\" \"Happy Birthday Giveaway\" 5 abc123 www.example.com/key 1h 24h*\n\nUse 'skip' for description if not needed. Use 'unlimited' for max completions if no limit." 
            });
            return;
        }
        
        const name = parts[0].replace(/^['"]|['"]$/g, '');
        const description = parts[1].replace(/^['"]|['"]$/g, '');
        const maxCompletions = parts[2];
        const key = parts[3];
        const keyLink = parts[4];
        const premiumDuration = parts[5];
        const expireDuration = parts[6];
        
        // Validate premium duration
        const validPremiumDuration = premiumDuration.match(/^(\d+[hd]|lifetime)$/);
        if (!validPremiumDuration) {
            await sock.sendMessage(userId, { 
                text: "Invalid premium duration format. Please use:\n- 1h to 24h for hours\n- 1d to 30d for days\n- lifetime for permanent" 
            });
            return;
        }
        
        // Validate expire duration
        const validExpireDuration = expireDuration.match(/^(\d+[hd])$/);
        if (!validExpireDuration) {
            await sock.sendMessage(userId, { 
                text: "Invalid expire duration format. Please use:\n- 1h to 24h for hours\n- 1d to 30d for days" 
            });
            return;
        }
        
        // Calculate expiry date
        const now = new Date();
        let expireAt;
        
        const expireMatch = expireDuration.match(/^(\d+)([hd])$/);
        if (expireMatch) {
            const [, amount, unit] = expireMatch;
            const multiplier = unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // hours or days
            expireAt = new Date(now.getTime() + parseInt(amount) * multiplier);
        } else {
            expireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default to 24 hours
        }
        
        // Create task object
        const taskData = {
            name,
            description,
            maxCompletions,
            key,
            keyLink,
            premiumDuration,
            expireDuration,
            expireAt: expireAt.toISOString()
        };
        
        try {
            const result = await taskUtils.addTask(taskData);
            
            if (!result.success) {
                await sock.sendMessage(userId, { text: result.message });
                return;
            }
            
            await sock.sendMessage(userId, { 
                text: `✅ Task "${name}" has been created successfully!\n\nIt will expire on ${expireAt.toLocaleString()} and offers a ${premiumDuration} premium trial.` 
            });
            
            // Broadcast task announcement to all users
            const broadcastResult = await taskUtils.broadcastTaskAnnouncement(sock, result.task);
            
            await sock.sendMessage(userId, { 
                text: `📢 Task announcement sent to ${broadcastResult.successCount} users. ${broadcastResult.errorCount > 0 ? `Failed for ${broadcastResult.errorCount} users.` : ''}` 
            });
        } catch (error) {
            console.error('Error adding task:', error);
            await sock.sendMessage(userId, { 
                text: "There was an error creating the task. Please try again later." 
            });
        }
    },
    
    '/deltask': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only bot owner can use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
            return;
        }
        
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        // Extract task name from message
        const match = messageText.match(/^\/deltask\s+(.+)$/i);
        
        if (!match) {
            await sock.sendMessage(userId, { 
                text: "Invalid format. Please use: */deltask [task name]*" 
            });
            return;
        }
        
        const [, taskName] = match;
        
        try {
            const result = await taskUtils.deleteTask(taskName);
            await sock.sendMessage(userId, { text: result.message });
        } catch (error) {
            console.error('Error deleting task:', error);
            await sock.sendMessage(userId, { 
                text: "There was an error deleting the task. Please try again later." 
            });
        }
    },
    
   '/listtasks': async (sock, message) => {
    const userId = message.key.remoteJid;
    const botOwner = process.env.BOT_OWNER;
    
    // Only bot owner can use this command
    if (userId !== botOwner) {
        await sock.sendMessage(userId, { text: "❌ Sorry, only the bot owner can use this command." });
        return;
    }
    
    try {
        const tasks = await taskUtils.getAllTasks();
        
        if (tasks.length === 0) {
            await sock.sendMessage(userId, { 
                text: "✨ No exciting tasks available at the moment! Check back soon for new opportunities to earn amazing rewards! 🎁"
            });
            return;
        }
        
        let taskMessage = "📋 *All Tasks* 📋\n\n";
        
        for (const task of tasks) {
            // Pass true to show the key for bot owner
            taskMessage += taskUtils.formatTaskDetails(task, true);
        }
        
        await sock.sendMessage(userId, { text: taskMessage });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        await sock.sendMessage(userId, { 
            text: "There was an error fetching the tasks. Please try again later." 
        });
    }
},

'/task': async (sock, message) => {
    const userId = message.key.remoteJid;
    
    try {
        const tasks = await taskUtils.getAllTasks();
        
        // Filter tasks into categories
        const availableTasks = tasks.filter(task => 
            !taskUtils.isTaskExpired(task) && !taskUtils.isTaskFull(task));
        
        const expiredOrFullTasks = tasks.filter(task => 
            taskUtils.isTaskExpired(task) || taskUtils.isTaskFull(task));
        
        if (tasks.length === 0) {
            await sock.sendMessage(userId, { 
                text: "✨ No exciting tasks available at the moment! Check back soon for new opportunities to earn amazing rewards! 🎁" 
            });
            return;
        }
        
        let taskMessage = "🎯 *Available Tasks* 🎯\n\n";
        
        if (availableTasks.length === 0) {
            taskMessage += "✨ No exciting tasks are available right now! Come back soon for new opportunities to earn rewards! 🎁\n\n";
        } else {
            for (const task of availableTasks) {
                // Pass false to hide the key for regular users
                taskMessage += taskUtils.formatTaskDetails(task, false);
            }
        }
        
        // Add section for expired or completed tasks
        if (expiredOrFullTasks.length > 0) {
            taskMessage += "\n📁 *Expired or Completed Tasks* 📁\n\n";
            for (const task of expiredOrFullTasks) {
                // Pass false to hide the key for regular users
                taskMessage += taskUtils.formatTaskDetails(task, false);
            }
        }
        
        taskMessage += "\n✨ *How to Complete Tasks* ✨\n" +
                      "Use the command: `/taskkey [task name] [key]`\n\n" +
                      "📝 *Example:*\n" +
                      "`/taskkey Hyper abc123`\n\n" +
                      "Complete tasks to earn exciting premium rewards! 🎁";
        
        await sock.sendMessage(userId, { text: taskMessage });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        await sock.sendMessage(userId, { 
            text: "There was an error fetching the tasks. Please try again later." 
        });
    }
},
    
    '/taskkey': async (sock, message) => {
    const userId = message.key.remoteJid;
    const messageText = message.message.conversation || 
                       (message.message.extendedTextMessage && 
                        message.message.extendedTextMessage.text) || '';
    
    // Extract task name and key from message
    const match = messageText.match(/^\/taskkey\s+(.+?)\s+(.+)$/i);
    
    if (!match) {
        await sock.sendMessage(userId, { 
            text: "✨ Oops! Let me help you with the correct format:\n\n*How to Complete a Task:*\n`/taskkey [task name] [key]`\n\n*For Example:*\n`/taskkey Hyper abc123`\n\nJust copy the format above and replace with your task details! 🌟"
        });
        return;
    }
    
    const [, taskName, key] = match;
    
    try {
        // Check if user already has premium
        const userData = await getUserData(userId);
        if (userData && userData.isPremium) {
            const now = new Date();
            let expiryMessage = "";
            
            if (userData.premiumExpiry) {
                const expiryDate = new Date(userData.premiumExpiry);
                if (expiryDate > now) {
                    // Calculate remaining time
                    const diffMs = expiryDate - now;
                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    
                    if (diffDays > 0) {
                        expiryMessage = `✨ Your premium access will continue for ${diffDays} magical days and ${diffHours} wonderful hours! 🌟`;
                    } else {
                        expiryMessage = `✨ Your magical premium journey continues for ${diffHours} more enchanting hours! 🌟`;
                    }
                    
                    await sock.sendMessage(userId, { 
                        text: `⚠️ You already have an active premium subscription! ${expiryMessage} Please wait until your current premium expires before completing another task.` 
                    });
                    return;
                }
            } else if (userData.premiumDuration === 'lifetime') {
                await sock.sendMessage(userId, { 
                    text: `✨ Congratulations! You're already enjoying our exclusive lifetime premium membership! 🌟 There's no need to complete tasks since you already have unlimited access to all our premium features. Keep enjoying your VIP experience! 💎`
                });
                return;
            }
        }
        
        // Continue with task completion if user doesn't have active premium
        const result = await taskUtils.completeTask(taskName, key, userId);
        
        await sock.sendMessage(userId, { text: result.message });
        
        // If task completion was successful and task is now full, notify bot owner
        if (result.success && result.isTaskFull) {
            const botOwner = process.env.BOT_OWNER;
            if (botOwner) {
                const task = await taskUtils.getTaskByName(taskName);
                await sock.sendMessage(botOwner, { 
                    text: `✨ Amazing news! The "${taskName}" task has reached its goal of ${task.maxCompletions} completions! 🎉 Thank you to everyone who participated in making this task a wonderful success! 🌟`
                });
            }
        }
    } catch (error) {
        console.error('Error completing task:', error);
        await sock.sendMessage(userId, { 
            text: "There was an error processing your task completion. Please try again later." 
        });
    }
},
    
    // API key management commands
    '/addkey': async (sock, message, args) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Check if user is the bot owner
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { 
                text: "⚠️ This command is only available to the bot owner." 
            });
            return;
        }
        
        // Check if service and key are provided
        if (!args[0] || !args[1]) {
            await sock.sendMessage(userId, { 
                text: "Please provide a service and key. Usage: /addkey [service] [key]\n\nAvailable services: openrouter, gemini, gemini_flash" 
            });
            return;
        }
        
        const service = args[0].toLowerCase();
        const key = args[1];
        
        // Validate service
        if (!['openrouter', 'gemini', 'gemini_flash'].includes(service)) {
            await sock.sendMessage(userId, { 
                text: "Invalid service. Available services: openrouter, gemini, gemini_flash" 
            });
            return;
        }
        
        // Add the key - removed the testApiKey call that doesn't exist
        const result = await apiKeyManager.addApiKey(service, key);
        
        await sock.sendMessage(userId, { 
            text: result.message 
        });
    },

    '/delkey': async (sock, message, args) => {
        // Only bot owner can remove API keys
        const botOwner = process.env.BOT_OWNER; // Replace with actual owner ID
        
        if (message.key.remoteJid !== botOwner) {
            return;
        }
        
        if (args.length < 2) {
            await sock.sendMessage(message.key.remoteJid, { 
                text: "Usage: /delkey [service] [key]\nServices: openrouter, gemini" 
            });
            return;
        }
        
        const service = args[0].toLowerCase();
        const key = args[1];
        
        const removed = await apiKeyManager.removeApiKey(service, key);
        
        if (removed) {
            await sock.sendMessage(message.key.remoteJid, { 
                text: `✅ Successfully removed ${service} API key` 
            });
        } else {
            await sock.sendMessage(message.key.remoteJid, { 
                text: `⚠️ This ${service} API key doesn't exist` 
            });
        }
    },

    '/listkeys': async (sock, message) => {
        // Only bot owner can list API keys
        const botOwner = process.env.BOT_OWNER; // Replace with actual owner ID
        
        if (message.key.remoteJid !== botOwner) {
            return;
        }
        
        // Load the API keys file directly to get the most up-to-date information
        const apiKeysPath = path.join(process.cwd(), 'config', 'api_keys.json');
        
        try {
            const apiKeys = await fs.readJson(apiKeysPath);
            
            let messageText = "*API Keys*\n\n";
            
            // OpenRouter keys with more details
            messageText += "*OpenRouter:* " + apiKeys.openrouter.length + " keys\n";
            
            // Track key status counts
            let workingKeys = 0;
            let limitedKeys = 0;
            let nonWorkingKeys = 0;
            
            // Test each OpenRouter key
            for (let index = 0; index < apiKeys.openrouter.length; index++) {
                const key = apiKeys.openrouter[index];
                const maskedKey = `${key.substring(0, 10)}...${key.substring(key.length - 5)}`;
                const isCurrentKey = index === apiKeys.currentIndex.openrouter;
                
                // Test the key
                try {
                    const keyStatus = await apiKeyManager.testApiKey('openrouter', key);
                    
                    // Add status indicator
                    let statusIndicator = "";
                    if (isCurrentKey) {
                        statusIndicator += "🔄 "; // Currently in use
                    }
                    
                    if (keyStatus === true) {
                        statusIndicator += "✅"; // Working
                        workingKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator}\n`;
                    } else if (keyStatus === 'limited') {
                        statusIndicator += "⚠️"; // Limited
                        limitedKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (LIMITED)\n`;
                    } else {
                        statusIndicator += "❌"; // Not working
                        nonWorkingKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (NOT WORKING)\n`;
                    }
                } catch (error) {
                    const statusIndicator = isCurrentKey ? "🔄❌" : "❌";
                    nonWorkingKeys++;
                    messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (ERROR)\n`;
                }
            }
            
            // Add summary for OpenRouter
            messageText += `\n*OpenRouter Summary:* ✅ ${workingKeys} working, ⚠️ ${limitedKeys} limited, ❌ ${nonWorkingKeys} not working\n`;
            
            // Reset counters for Gemini
            workingKeys = 0;
            limitedKeys = 0;
            nonWorkingKeys = 0;
            
            // Gemini keys with more details
            messageText += "\n*Gemini:* " + apiKeys.gemini.length + " keys\n";
            
            // Test each Gemini key
            for (let index = 0; index < apiKeys.gemini.length; index++) {
                const key = apiKeys.gemini[index];
                const maskedKey = `${key.substring(0, 10)}...${key.substring(key.length - 5)}`;
                const isCurrentKey = index === apiKeys.currentIndex.gemini;
                
                // Test the key
                try {
                    const keyStatus = await apiKeyManager.testApiKey('gemini', key);
                    
                    // Add status indicator
                    let statusIndicator = "";
                    if (isCurrentKey) {
                        statusIndicator += "🔄 "; // Currently in use
                    }
                    
                    if (keyStatus === true) {
                        statusIndicator += "✅"; // Working
                        workingKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator}\n`;
                    } else if (keyStatus === 'limited') {
                        statusIndicator += "⚠️"; // Limited
                        limitedKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (LIMITED)\n`;
                    } else {
                        statusIndicator += "❌"; // Not working
                        nonWorkingKeys++;
                        messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (NOT WORKING)\n`;
                    }
                } catch (error) {
                    const statusIndicator = isCurrentKey ? "🔄❌" : "❌";
                    nonWorkingKeys++;
                    messageText += `${index + 1}. ${maskedKey} ${statusIndicator} (ERROR)\n`;
                }
            }
            
            // Add summary for Gemini
            messageText += `\n*Gemini Summary:* ✅ ${workingKeys} working, ⚠️ ${limitedKeys} limited, ❌ ${nonWorkingKeys} not working\n`;
            
            // Current index information
            messageText += "\n*Current Index:*\n";
            if (apiKeys.currentIndex) {
                Object.keys(apiKeys.currentIndex).forEach(provider => {
                    messageText += `${provider}: ${apiKeys.currentIndex[provider]}\n`;
                });
            }
            
            // Last rotation information
            messageText += "\n*Last Rotation:*\n";
            if (apiKeys.lastRotation) {
                Object.keys(apiKeys.lastRotation).forEach(provider => {
                    const date = new Date(apiKeys.lastRotation[provider]);
                    messageText += `${provider}: ${date.toLocaleString()}\n`;
                });
            }
            
            await sock.sendMessage(message.key.remoteJid, { text: messageText });
        } catch (error) {
            console.error('Error listing API keys:', error);
            await sock.sendMessage(message.key.remoteJid, { 
                text: "Error retrieving API keys. Please try again later." 
            });
        }
    },
    
    // Add backup command
    '/backup': async (sock, message) => {
        // Only bot owner can trigger manual backup
        const botOwner = process.env.BOT_OWNER; // Replace with actual owner ID
        
        if (message.key.remoteJid !== botOwner) {
            return;
        }
        
        await sock.sendMessage(message.key.remoteJid, { 
            text: "Starting manual backup to Mega.nz... This may take a few minutes." 
        });
        
        try {
            const success = await backupUtils.runBackupNow();
            
            setTimeout(async () => {
                if (success) {
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "✅ Backup to Mega.nz completed successfully!" 
                    });
                } else {
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "❌ Backup to Mega.nz failed. Please check the logs for details." 
                    });
                }
            }, 1000);
        } catch (error) {
            console.error('Error in backup command:', error);
            await sock.sendMessage(message.key.remoteJid, { 
                text: "❌ An error occurred during backup. Please check the logs for details." 
            });
        }
    },
    
    // Add restore command
    '/restore': async (sock, message) => {
        // Only bot owner can trigger manual restore
        const botOwner = process.env.BOT_OWNER; // Replace with actual owner ID
        
        if (message.key.remoteJid !== botOwner) {
            return;
        }
        
        await sock.sendMessage(message.key.remoteJid, { 
            text: "Starting manual restoration from Mega.nz... This may take a few minutes." 
        });
        
        try {
            const success = await backupUtils.runRestoreNow();
            
            // Increase the delay to ensure the message is sent after restoration completes
            setTimeout(async () => {
                if (success) {
                    console.log('Sending restore success message to admin');
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "✅ Restoration from Mega.nz completed successfully!" 
                    });
                } else {
                    console.log('Sending restore failure message to admin');
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "❌ Restoration from Mega.nz failed. Please check the logs for details." 
                    });
                }
            }, 3000); // Increased from 1000ms to 3000ms (3 seconds)
        } catch (error) {
            console.error('Error in restore command:', error);
            await sock.sendMessage(message.key.remoteJid, { 
                text: "❌ An error occurred during restoration. Please check the logs for details." 
            });
        }
    },
    
    // Add autobackup toggle command
    '/autobackup': async (sock, message, args) => {
        const botOwner = process.env.BOT_OWNER;
        
        if (message.key.remoteJid !== botOwner) {
            return;
        }
        
        if (!args || args.length === 0) {
            await sock.sendMessage(message.key.remoteJid, { 
                text: "Usage: /autobackup [on|off|status]" 
            });
            return;
        }
        
        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            const currentStatus = await backupUtils.getAutoBackupStatus();
            
            if (currentStatus) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: "Auto backup is already enabled." 
                });
            } else {
                await backupUtils.enableAutoBackup();
                await sock.sendMessage(message.key.remoteJid, { 
                    text: "✅ Auto backup has been enabled." 
                });
            }
        } else if (command === 'off') {
            const currentStatus = await backupUtils.getAutoBackupStatus();
            
            if (!currentStatus) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: "Auto backup is already disabled." 
                });
            } else {
                await backupUtils.disableAutoBackup();
                await sock.sendMessage(message.key.remoteJid, { 
                    text: "❌ Auto backup has been disabled." 
                });
            }
        } else if (command === 'status') {
            const status = await backupUtils.getAutoBackupStatus();
            await sock.sendMessage(message.key.remoteJid, { 
                text: `Auto backup is currently ${status ? 'enabled' : 'disabled'}.` 
            });
        } else {
            await sock.sendMessage(message.key.remoteJid, { 
                text: "Invalid command. Usage: /autobackup [on|off|status]" 
            });
        }
    },
    
    // Add new command for auto messaging
    '/automsg': async (sock, message, args) => {
        const userId = message.key.remoteJid;
        
        if (!args[0] || !['on', 'off', 'status'].includes(args[0].toLowerCase())) {
            await sock.sendMessage(userId, { 
                text: "Please specify 'on', 'off', or 'status'. For example: /automsg on" 
            });
            return;
        }
        
        const command = args[0].toLowerCase();
        
        if (command === 'status') {
            const status = await autoMessageUtils.getAutoMessagingStatus(userId);
            await sock.sendMessage(userId, { 
                text: `Auto messaging is currently ${status ? 'enabled' : 'disabled'}.` 
            });
            return;
        }
        
        if (command === 'on') {
            await autoMessageUtils.toggleAutoMessaging(userId, true);
            
            // Get user data to schedule messages
            const userData = await getUserData(userId);
            if (userData) {
                autoMessageUtils.scheduleAutoMessagesForUser(sock, userId, userData);
            }
            
            await sock.sendMessage(userId, { 
                text: "Auto messaging has been enabled. I'll check on you if you're away for a while! 💫" 
            });
            return;
        }
        
        if (command === 'off') {
            await autoMessageUtils.toggleAutoMessaging(userId, false);
            await sock.sendMessage(userId, { 
                text: "Auto messaging has been disabled. I won't send automatic messages anymore." 
            });
            return;
        }
    },

    // Add new reminder commands
    '/remind': async (sock, message, args) => {
        const userId = message.key.remoteJid;
        
        // Get the full message text
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        // Parse the reminder command
        const parsedReminder = reminderUtils.parseReminderCommand(messageText);
        
        if (!parsedReminder) {
            await sock.sendMessage(userId, { 
                text: `⚠️ I couldn't understand that reminder format. Please use one of these formats:

1. /remind tomorrow at 3pm to call mom
2. /remind in 2 hours to take medicine
3. /remind 5/20 at 9am to attend meeting

For recurring reminders, add "daily", "weekly", or "monthly" at the end:
/remind tomorrow at 8am to take vitamins daily` 
            });
            return;
        }
        
        // Create the reminder
        const reminderId = await reminderUtils.createReminder(
            sock,
            userId,
            parsedReminder.text,
            parsedReminder.time,
            parsedReminder.recurring
        );
        
        if (reminderId) {
            // Format the time
            const timeOptions = { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            const formattedTime = parsedReminder.time.toLocaleString('en-US', timeOptions);
            
            // Format the response
            let response = `✅ Reminder set successfully!\n\n`;
            response += `I'll remind you to *${parsedReminder.text}*\n`;
            response += `📅 ${formattedTime}`;
            
            if (parsedReminder.recurring) {
                response += `\n🔄 Recurring: ${parsedReminder.recurring}`;
            }
            
            await sock.sendMessage(userId, { text: response });
        } else {
            await sock.sendMessage(userId, { 
                text: "❌ Sorry, I couldn't set that reminder. Please try again." 
            });
        }
    },
    
    '/reminders': async (sock, message) => {
        const userId = message.key.remoteJid;
        
        // Get all reminders for the user
        const reminders = await reminderUtils.listReminders(userId);
        
        if (reminders.length === 0) {
            await sock.sendMessage(userId, { 
                text: "You don't have any active reminders. Use /remind to set one!" 
            });
            return;
        }
        
        // Format the reminders list
        let response = `*Your Reminders* ⏰\n\n`;
        
        reminders.forEach((reminder, index) => {
            // Format the time
            const timeOptions = { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            const time = new Date(reminder.time);
            const formattedTime = time.toLocaleString('en-US', timeOptions);
            
            response += `${index + 1}. ID: ${reminder.id}\n`;
            response += `   📝 ${reminder.text}\n`;
            response += `   📅 ${formattedTime}\n`;
            
            if (reminder.recurring) {
                response += `   🔄 Recurring: ${reminder.recurring}\n`;
            }
            
            response += '\n';
        });
        
        response += `To delete a reminder, use /delreminder [ID]`;
        
        await sock.sendMessage(userId, { text: response });
    },
    
    '/delreminder': async (sock, message, args) => {
        const userId = message.key.remoteJid;
        
        if (!args[0]) {
            await sock.sendMessage(userId, { 
                text: "Please specify the reminder ID to delete. You can see all your reminders with /reminders" 
            });
            return;
        }
        
        const reminderId = args[0];
        
        // Delete the reminder
        const success = await reminderUtils.deleteReminder(userId, reminderId);
        
        if (success) {
            await sock.sendMessage(userId, { 
                text: "✅ Reminder deleted successfully!" 
            });
        } else {
            await sock.sendMessage(userId, { 
                text: "❌ Couldn't delete that reminder. Please check the ID and try again." 
            });
        }
    },
    
    '/register': async (sock, message, args) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Check if args contains a license key
        if (!args || args.length === 0) {
            await sock.sendMessage(userId, { 
                text: "❌ Please provide a license key. Usage: /register YOUR-LICENSE-KEY" 
            });
            return;
        }
        
        const licenseKey = args[0];
        
        // Get the bot's number from the environment or use a default
        const botNumber = process.env.BOT_NUMBER || sock.user.id.split(':')[0];
        
        // Show registering message
        await sock.sendMessage(userId, { 
            text: "🔄 Registering bot with license key... Please wait." 
        });
        
        // Register the bot
        const result = await licenseUtils.registerBot(licenseKey, botNumber);
        
        if (result.success) {
            // Check if the registered number matches the bot's number
            if (result.license_info.bot_number && result.license_info.bot_number !== botNumber) {
                await sock.sendMessage(userId, { 
                    text: "❌ Registration failed: Aren't you ashamed to take someone else's key and use it, kids?\n\nThis license key was created for a different WhatsApp number and cannot be used with this bot." 
                });
                return;
            }
            
            // Format expiry date if available
            let expiryInfo = '';
            if (result.license_info.expires_at) {
                const expiryDate = new Date(result.license_info.expires_at);
                expiryInfo = `\n📅 Expires on: ${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString()}`;
            } else {
                expiryInfo = '\n📅 License type: Permanent (never expires)';
            }
            
            // Format package type
            const packageType = result.license_info.package_type.replace('_', ' ');
            
            await sock.sendMessage(userId, { 
                text: `✅ Bot registered successfully!\n🔑 Package: ${packageType}${expiryInfo}` 
            });
            
            // If the user is not the bot owner, notify the owner
            if (userId !== botOwner) {
                await sock.sendMessage(botOwner, { 
                    text: `🔔 Your bot has been registered by a user!\n👤 User: ${userId}\n🔑 License key: ${licenseKey}\n📦 Package: ${packageType}${expiryInfo}` 
                });
            }
        } else {
            await sock.sendMessage(userId, { 
                text: `❌ Registration failed: ${result.message}\n\nPlease check your license key and try again.` 
            });
        }
    },
    
    '/check-bot-status': async (sock, message) => {
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Only allow the bot owner to use this command
        if (userId !== botOwner) {
            await sock.sendMessage(userId, { 
                text: "❌ This command is only available to the bot owner." 
            });
            return;
        }
        
        // Get the bot's number
        const botNumber = process.env.BOT_NUMBER || sock.user.id.split(':')[0];
        
        // Show checking message
        await sock.sendMessage(userId, { 
            text: "🔄 Checking bot license status... Please wait." 
        });
        
        // Check the bot's license status
        const status = await licenseUtils.checkBotStatus(botNumber);
        
        if (!status.success || !status.registered) {
            await sock.sendMessage(userId, { 
                text: "❌ Bot is not registered or the license has expired.\n\nUse the command \"/register YOUR-LICENSE-KEY\" to register the bot." 
            });
            return;
        }
        
        // Format license details
        const licenseInfo = status.license_info;
        
        // Format expiry date and time remaining
        let expiryInfo = '';
        let timeRemaining = '';
        
        if (licenseInfo.expires_at) {
            const expiryDate = new Date(licenseInfo.expires_at);
            const now = new Date();
            const timeUntilExpiry = expiryDate - now;
            
            // Calculate days, hours, minutes, seconds
            const days = Math.floor(timeUntilExpiry / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeUntilExpiry % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeUntilExpiry % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeUntilExpiry % (1000 * 60)) / 1000);
            
            expiryInfo = `${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString()}`;
            timeRemaining = `${days}d ${hours}h ${minutes}m ${seconds}s remaining`;
        } else {
            expiryInfo = 'Never (Permanent License)';
            timeRemaining = 'Permanent';
        }
        
        // Format package type
        const packageType = licenseInfo.package_type ? licenseInfo.package_type.replace('_', ' ') : 'Unknown';
        
        // Format creation date - Fix for Unknown creation date
        const creationDate = licenseInfo.created_at ? 
            new Date(licenseInfo.created_at).toLocaleDateString() : 
            (licenseInfo.created_by ? 'Available' : 'Unknown');
        
        // Format connection status - Fix for always showing Disconnected
        // Default to Connected if the status is active
        const connectionStatus = licenseInfo.is_connected !== undefined ? 
            (licenseInfo.is_connected ? 'Connected' : 'Disconnected') : 
            (licenseInfo.status === 'active' ? 'Connected' : 'Disconnected');
        
        // Get username and password from license info
        const username = licenseInfo.user_credentials?.username || 'Not available';
        const password = licenseInfo.user_credentials?.password || 'Not available';
        
        // Create the status message - Fix for undefined license key
        const statusMessage = `*Bot License Status* 📊\n\n` +
            `🔑 Key: ${licenseInfo.license_key || licenseInfo.id || 'Not available'}\n` +
            `🤖 Bot: ${botNumber}\n` +
            `📦 Package: ${packageType}\n` +
            `📅 Created: ${creationDate}\n` +
            `⏱️ Time Remaining: ${timeRemaining}\n` +
            `🔌 Connection: ${connectionStatus}\n` +
            `⌛ Expires: ${expiryInfo}\n` +
            `🔄 Status: ${licenseInfo.status === 'active' ? 'Active' : 'Inactive'}\n\n` +
            `*User Login Credentials* 🔐\n` +
            `👤 Username: ${username}\n` +
            `🔒 Password: ${password}\n\n` +
            `*Dashboard* 🌐\n` +
            `Log in to your dashboard to view more details:\n` +
            `https://whatsapp-ai-roleplay-bot-key.vercel.app/`;
        
        await sock.sendMessage(userId, { text: statusMessage });
    },
    
    '/myself': async (sock, message) => {
        const userId = message.key.remoteJid;
        
        try {
            // Get user data
            const userData = await getUserData(userId);
            
            if (!userData) {
                await sock.sendMessage(userId, { 
                    text: "❌ You don't have any data yet. Try creating an AI companion with /create first." 
                });
                return;
            }
            
            // Check premium status
            const isPremium = await isPremiumUser(userId);
            
            // Format premium status
            let premiumStatus = '';
            if (isPremium) {
                if (userData.premiumExpiry) {
                    const expiryDate = new Date(userData.premiumExpiry);
                    const now = new Date();
                    const timeUntilExpiry = expiryDate - now;
                    
                    // Calculate days, hours, minutes
                    const days = Math.floor(timeUntilExpiry / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((timeUntilExpiry % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((timeUntilExpiry % (1000 * 60 * 60)) / (1000 * 60));
                    
                    premiumStatus = `✅ Premium (Expires: ${expiryDate.toLocaleDateString()}, ${days}d ${hours}h ${minutes}m remaining)`;
                } else {
                    premiumStatus = '✅ Premium (Lifetime)';
                }
            } else if (userData.isFreeTrial) {
                const expiryDate = new Date(userData.premiumExpiry);
                const now = new Date();
                const timeUntilExpiry = expiryDate - now;
                const days = Math.floor(timeUntilExpiry / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeUntilExpiry % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                
                premiumStatus = `🔄 Free Trial (${days}d ${hours}h remaining)`;
            } else if (userData.isTaskTrial) {
                const expiryDate = new Date(userData.premiumExpiry);
                const now = new Date();
                const timeUntilExpiry = expiryDate - now;
                const days = Math.floor(timeUntilExpiry / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeUntilExpiry % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                
                premiumStatus = `🎯 Task Trial: ${userData.taskTrialTaskName || 'Unknown Task'} (${days}d ${hours}h remaining)`;
            } else {
                premiumStatus = '❌ Free User';
            }
            
            // Get daily message count
            const today = new Date().toISOString().split('T')[0];
            let dailyMessageCount = 0;
            let dailyMessageLimit = 'Unlimited';
            
            if (userData.dailyMessages && userData.dailyMessages.date === today) {
                dailyMessageCount = userData.dailyMessages.count || 0;
            }
            
            if (!isPremium && !userData.isFreeTrial && !userData.isTaskTrial) {
                dailyMessageLimit = '100';
            }
            
            // Calculate time until daily reset
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            
            const timeUntilReset = tomorrow - now;
            const resetHours = Math.floor(timeUntilReset / (1000 * 60 * 60));
            const resetMinutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));
            const resetSeconds = Math.floor((timeUntilReset % (1000 * 60)) / 1000);
            
            const resetTimeString = `${resetHours}h ${resetMinutes}m ${resetSeconds}s`;
            
            // Get image generation count
            let imageCount = 0;
            let imageLimit = 'Unlimited';
            
            // Use the existing today variable instead of declaring it again
            if (userData.imageRequests && userData.imageRequests[today]) {
                imageCount = userData.imageRequests[today];
            } else {
                // If no images generated today, count should be 0
                imageCount = 0;
            }
            
            if (!isPremium && !userData.isFreeTrial && !userData.isTaskTrial) {
                imageLimit = '3';
            }
            
            // Get reset count
            const resetCount = userData.resetCount || 0;
            const resetLimit = isPremium ? 'Unlimited' : '2';
            
            // Format user since date
            let userSince = 'Unknown';
            if (userData.createdAt) {
                userSince = new Date(userData.createdAt).toLocaleDateString();
            }
            
            // Create the status message
            const statusMessage = `*Your Account Status* 👤\n\n` +
                `👑 Status: ${premiumStatus}\n` +
                `💬 Daily Messages: ${dailyMessageCount}/${dailyMessageLimit}\n` +
                `🖼️ Daily Images: ${imageCount}/${imageLimit}\n` +
                `🔄 Resets: ${resetCount}/${resetLimit}\n` +
                (userData.companionName ? `👫 AI Companion: ${userData.companionName}\n` : '') +
                (userSince !== 'Unknown' ? `📅 User Since: ${userSince}\n` : '') +
                `⏰ Limits Reset In: ${resetTimeString}`;
            
            await sock.sendMessage(userId, { text: statusMessage });
        } catch (error) {
            console.error('Error in /myself command:', error);
            await sock.sendMessage(userId, { 
                text: "❌ An error occurred while retrieving your account information." 
            });
        }
    }

};

module.exports = commandHandlers;