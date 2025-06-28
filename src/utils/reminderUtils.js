const fs = require('fs-extra');
const path = require('path');
const schedule = require('node-schedule');
const { getUserData, saveUserData } = require('../utils');

// Global variables to store scheduled jobs
const scheduledReminders = new Map();

// Path to store reminders
const REMINDERS_PATH = path.join(process.cwd(), 'config', 'reminders.json');

/**
 * Initialize reminder system
 * @param {Object} sock - The WhatsApp socket connection
 */
async function initializeReminderSystem(sock) {
    console.log('Initializing reminder system...');
    
    try {
        // Create reminders file if it doesn't exist
        if (!await fs.pathExists(REMINDERS_PATH)) {
            await fs.writeJson(REMINDERS_PATH, {}, { spaces: 2 });
        }
        
        // Load existing reminders
        const reminders = await fs.readJson(REMINDERS_PATH);
        
        // Schedule all active reminders
        for (const userId in reminders) {
            const userReminders = reminders[userId];
            
            for (const reminderId in userReminders) {
                const reminder = userReminders[reminderId];
                
                // Skip if reminder is in the past or has been completed
                if (reminder.completed || new Date(reminder.time) < new Date()) {
                    continue;
                }
                
                // Schedule the reminder
                scheduleReminder(sock, userId, reminderId, reminder);
            }
        }
        
        console.log('Reminder system initialized successfully');
    } catch (error) {
        console.error('Error initializing reminder system:', error);
    }
}

/**
 * Schedule a reminder
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} reminderId - The reminder ID
 * @param {Object} reminder - The reminder object
 */
function scheduleReminder(sock, userId, reminderId, reminder) {
    try {
        // Parse the reminder time
        const reminderTime = new Date(reminder.time);
        
        // Skip if reminder time is in the past
        if (reminderTime < new Date()) {
            console.log(`Skipping reminder ${reminderId} for user ${userId} as it's in the past`);
            return;
        }
        
        // Schedule the job
        const job = schedule.scheduleJob(reminderTime, async function() {
            await sendReminderNotification(sock, userId, reminderId, reminder);
        });
        
        // Store the job
        if (!scheduledReminders.has(userId)) {
            scheduledReminders.set(userId, new Map());
        }
        scheduledReminders.get(userId).set(reminderId, job);
        
        console.log(`Scheduled reminder ${reminderId} for user ${userId} at ${reminderTime}`);
    } catch (error) {
        console.error(`Error scheduling reminder ${reminderId} for user ${userId}:`, error);
    }
}

/**
 * Send a reminder notification
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} reminderId - The reminder ID
 * @param {Object} reminder - The reminder object
 */
async function sendReminderNotification(sock, userId, reminderId, reminder) {
    try {
        // Get user data
        const userData = await getUserData(userId);
        
        // Skip if user doesn't exist
        if (!userData) {
            console.log(`User ${userId} not found, skipping reminder notification`);
            return;
        }
        
        // Format the reminder message
        let message = `⏰ *REMINDER* ⏰\n\n`;
        
        // Add companion name if available
        if (userData.companionName) {
            message += `Hey ${userData.userName}, it's ${userData.companionName} here! 💫\n\n`;
        }
        
        message += `You asked me to remind you about:\n*${reminder.text}*`;
        
        // Add time if it's a recurring reminder
        if (reminder.recurring) {
            message += `\n\nThis is a recurring reminder (${reminder.recurring}).`;
        }
        
        // Send the notification
        await sock.sendMessage(userId, { text: message });
        
        // Update reminder status
        await markReminderAsCompleted(userId, reminderId, reminder.recurring);
        
        console.log(`Sent reminder notification to ${userId} for reminder ${reminderId}`);
    } catch (error) {
        console.error(`Error sending reminder notification to ${userId} for reminder ${reminderId}:`, error);
    }
}

/**
 * Mark a reminder as completed
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} reminderId - The reminder ID
 * @param {string|null} recurring - The recurring pattern (daily, weekly, monthly) or null
 */
async function markReminderAsCompleted(userId, reminderId, recurring) {
    try {
        // Load reminders
        const reminders = await fs.readJson(REMINDERS_PATH);
        
        // Skip if user or reminder doesn't exist
        if (!reminders[userId] || !reminders[userId][reminderId]) {
            return;
        }
        
        // If it's a recurring reminder, update the time for the next occurrence
        if (recurring) {
            const reminder = reminders[userId][reminderId];
            const currentTime = new Date(reminder.time);
            let nextTime;
            
            switch (recurring) {
                case 'daily':
                    nextTime = new Date(currentTime);
                    nextTime.setDate(nextTime.getDate() + 1);
                    break;
                case 'weekly':
                    nextTime = new Date(currentTime);
                    nextTime.setDate(nextTime.getDate() + 7);
                    break;
                case 'monthly':
                    nextTime = new Date(currentTime);
                    nextTime.setMonth(nextTime.getMonth() + 1);
                    break;
                default:
                    // If recurring pattern is not recognized, mark as completed
                    reminders[userId][reminderId].completed = true;
                    break;
            }
            
            if (nextTime) {
                reminders[userId][reminderId].time = nextTime.toISOString();
                
                // Reschedule the reminder
                if (scheduledReminders.has(userId) && scheduledReminders.get(userId).has(reminderId)) {
                    scheduledReminders.get(userId).get(reminderId).cancel();
                }
                
                // We need the sock object to reschedule, but we don't have it here
                // We'll handle rescheduling on next bot restart
            }
        } else {
            // For non-recurring reminders, delete them completely instead of just marking as completed
            delete reminders[userId][reminderId];
            
            // If user has no more reminders, clean up the user entry
            if (Object.keys(reminders[userId]).length === 0) {
                delete reminders[userId];
            }
            
            // Cancel the scheduled job
            if (scheduledReminders.has(userId) && scheduledReminders.get(userId).has(reminderId)) {
                scheduledReminders.get(userId).get(reminderId).cancel();
                scheduledReminders.get(userId).delete(reminderId);
            }
        }
        
        // Save reminders
        await fs.writeJson(REMINDERS_PATH, reminders, { spaces: 2 });
    } catch (error) {
        console.error(`Error marking reminder ${reminderId} as completed for user ${userId}:`, error);
    }
}

/**
 * Create a new reminder
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} text - The reminder text
 * @param {Date} time - The reminder time
 * @param {string|null} recurring - The recurring pattern (daily, weekly, monthly) or null
 * @returns {string|null} - The reminder ID or null if failed
 */
async function createReminder(sock, userId, text, time, recurring = null) {
    try {
        // Load reminders
        const reminders = await fs.readJson(REMINDERS_PATH);
        
        // Initialize user reminders if not exists
        if (!reminders[userId]) {
            reminders[userId] = {};
        }
        
        // Generate a unique ID for the reminder
        const reminderId = Date.now().toString();
        
        // Create the reminder object
        const reminder = {
            text,
            time: time.toISOString(),
            created: new Date().toISOString(),
            completed: false,
            recurring
        };
        
        // Save the reminder
        reminders[userId][reminderId] = reminder;
        await fs.writeJson(REMINDERS_PATH, reminders, { spaces: 2 });
        
        // Schedule the reminder
        scheduleReminder(sock, userId, reminderId, reminder);
        
        return reminderId;
    } catch (error) {
        console.error(`Error creating reminder for user ${userId}:`, error);
        return null;
    }
}

/**
 * List all reminders for a user
 * @param {string} userId - The user's WhatsApp ID
 * @returns {Array} - Array of reminder objects with IDs
 */
async function listReminders(userId) {
    try {
        // Load reminders
        const reminders = await fs.readJson(REMINDERS_PATH);
        
        // Return empty array if user has no reminders
        if (!reminders[userId]) {
            return [];
        }
        
        // Convert to array and add ID
        const reminderArray = Object.entries(reminders[userId])
            .map(([id, reminder]) => ({ id, ...reminder }))
            .filter(reminder => !reminder.completed); // Only include active reminders
        
        // Sort by time
        reminderArray.sort((a, b) => new Date(a.time) - new Date(b.time));
        
        return reminderArray;
    } catch (error) {
        console.error(`Error listing reminders for user ${userId}:`, error);
        return [];
    }
}

/**
 * Delete a reminder
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} reminderId - The reminder ID
 * @returns {boolean} - Whether the deletion was successful
 */
async function deleteReminder(userId, reminderId) {
    try {
        // Load reminders
        const reminders = await fs.readJson(REMINDERS_PATH);
        
        // Check if user and reminder exist
        if (!reminders[userId] || !reminders[userId][reminderId]) {
            return false;
        }
        
        // Delete the reminder
        delete reminders[userId][reminderId];
        
        // Save reminders
        await fs.writeJson(REMINDERS_PATH, reminders, { spaces: 2 });
        
        // Cancel the scheduled job
        if (scheduledReminders.has(userId) && scheduledReminders.get(userId).has(reminderId)) {
            scheduledReminders.get(userId).get(reminderId).cancel();
            scheduledReminders.get(userId).delete(reminderId);
        }
        
        return true;
    } catch (error) {
        console.error(`Error deleting reminder ${reminderId} for user ${userId}:`, error);
        return false;
    }
}

/**
 * Parse a natural language time string into a Date object
 * @param {string} timeString - The time string (e.g., "tomorrow at 3pm", "in 2 hours")
 * @returns {Date|null} - The parsed Date object or null if parsing failed
 */
function parseTimeString(timeString) {
    try {
        const now = new Date();
        
        // Check for "in X minutes/hours/days"
        const inMatch = timeString.match(/in\s+(\d+)\s+(minute|minutes|hour|hours|day|days)/i);
        if (inMatch) {
            const amount = parseInt(inMatch[1]);
            const unit = inMatch[2].toLowerCase();
            
            if (unit === 'minute' || unit === 'minutes') {
                return new Date(now.getTime() + amount * 60 * 1000);
            } else if (unit === 'hour' || unit === 'hours') {
                return new Date(now.getTime() + amount * 60 * 60 * 1000);
            } else if (unit === 'day' || unit === 'days') {
                return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
            }
        }
        
        // Check for "tomorrow at X"
        const tomorrowMatch = timeString.match(/tomorrow\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i);
        if (tomorrowMatch) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            let hours = parseInt(tomorrowMatch[1]);
            const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
            const ampm = tomorrowMatch[3] ? tomorrowMatch[3].toLowerCase() : null;
            
            // Adjust hours for AM/PM
            if (ampm === 'pm' && hours < 12) {
                hours += 12;
            } else if (ampm === 'am' && hours === 12) {
                hours = 0;
            }
            
            tomorrow.setHours(hours, minutes, 0, 0);
            return tomorrow;
        }
        
        // Check for "today at X"
        const todayMatch = timeString.match(/today\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i);
        if (todayMatch) {
            const today = new Date(now);
            
            let hours = parseInt(todayMatch[1]);
            const minutes = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
            const ampm = todayMatch[3] ? todayMatch[3].toLowerCase() : null;
            
            // Adjust hours for AM/PM
            if (ampm === 'pm' && hours < 12) {
                hours += 12;
            } else if (ampm === 'am' && hours === 12) {
                hours = 0;
            }
            
            today.setHours(hours, minutes, 0, 0);
            
            // If the time is in the past, return null
            if (today <= now) {
                return null;
            }
            
            return today;
        }
        
        // Check for specific date and time
        const dateTimeMatch = timeString.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i);
        if (dateTimeMatch) {
            const month = parseInt(dateTimeMatch[1]) - 1; // Months are 0-indexed in JS
            const day = parseInt(dateTimeMatch[2]);
            const year = dateTimeMatch[3] ? parseInt(dateTimeMatch[3]) : now.getFullYear();
            
            let hours = parseInt(dateTimeMatch[4]);
            const minutes = dateTimeMatch[5] ? parseInt(dateTimeMatch[5]) : 0;
            const ampm = dateTimeMatch[6] ? dateTimeMatch[6].toLowerCase() : null;
            
            // Adjust hours for AM/PM
            if (ampm === 'pm' && hours < 12) {
                hours += 12;
            } else if (ampm === 'am' && hours === 12) {
                hours = 0;
            }
            
            const date = new Date(year, month, day, hours, minutes, 0, 0);
            
            // If the date is in the past, return null
            if (date <= now) {
                return null;
            }
            
            return date;
        }
        
        // Try to parse as a direct date string
        const directDate = new Date(timeString);
        if (!isNaN(directDate.getTime())) {
            return directDate;
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing time string:', error);
        return null;
    }
}

/**
 * Parse a reminder command
 * @param {string} text - The command text
 * @returns {Object|null} - The parsed reminder or null if parsing failed
 */
function parseReminderCommand(text) {
    try {
        // Remove the command prefix
        const content = text.replace(/^\/remind\s+/i, '').trim();
        
        // Check for recurring pattern
        let recurring = null;
        let cleanContent = content;
        
        const recurringPatterns = [
            { pattern: /\s+daily$/i, type: 'daily' },
            { pattern: /\s+every\s+day$/i, type: 'daily' },
            { pattern: /\s+weekly$/i, type: 'weekly' },
            { pattern: /\s+every\s+week$/i, type: 'weekly' },
            { pattern: /\s+monthly$/i, type: 'monthly' },
            { pattern: /\s+every\s+month$/i, type: 'monthly' }
        ];
        
        for (const { pattern, type } of recurringPatterns) {
            if (pattern.test(content)) {
                recurring = type;
                cleanContent = content.replace(pattern, '').trim();
                break;
            }
        }
        
        // Split by "to" or "about" to separate time and reminder text
        const toMatch = cleanContent.match(/^(.*?)\s+(?:to|about)\s+(.*)$/i);
        
        if (toMatch) {
            const timeString = toMatch[1].trim();
            const reminderText = toMatch[2].trim();
            
            const time = parseTimeString(timeString);
            
            if (time) {
                return {
                    text: reminderText,
                    time,
                    recurring
                };
            }
        }
        
        // Try alternative format: "remind me [text] at/on [time]"
        const atMatch = cleanContent.match(/^(.*?)\s+(?:at|on)\s+(.*)$/i);
        
        if (atMatch) {
            const reminderText = atMatch[1].trim();
            const timeString = atMatch[2].trim();
            
            const time = parseTimeString(timeString);
            
            if (time) {
                return {
                    text: reminderText,
                    time,
                    recurring
                };
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing reminder command:', error);
        return null;
    }
}

module.exports = {
    initializeReminderSystem,
    createReminder,
    listReminders,
    deleteReminder,
    parseReminderCommand,
    parseTimeString  // Add this line to export the parseTimeString function
};


// Function to send a reminder
async function sendReminder(sock, userId, reminderId, reminderText) {
    try {
        // Get user data to personalize the message
        const userData = await getUserData(userId);
        
        if (!userData || !userData.companionName) {
            console.log(`Cannot send reminder to ${userId}: No companion data found`);
            return false;
        }
        
        // Get the reminder data
        const reminders = await loadReminders();
        
        if (!reminders[userId] || !reminders[userId][reminderId]) {
            console.log(`Reminder ${reminderId} for user ${userId} not found`);
            return false;
        }
        
        const reminder = reminders[userId][reminderId];
        
        // Personalize the message based on the companion's personality
        let message = `⏰ *Reminder* ⏰\n\n`;
        
        // Add companion's name and personality to the message
        if (userData.companionName) {
            message += `Hey, it's ${userData.companionName}! `;
            
            // Add personality-based message
            if (userData.companionPersonality && userData.companionPersonality.toLowerCase().includes('caring')) {
                message += `I care about you, so I wanted to remind you: `;
            } else if (userData.companionPersonality && userData.companionPersonality.toLowerCase().includes('playful')) {
                message += `Don't forget this! 😜 `;
            } else if (userData.companionPersonality && userData.companionPersonality.toLowerCase().includes('serious')) {
                message += `I'm sending you this important reminder: `;
            } else {
                message += `Here's your reminder: `;
            }
        }
        
        message += `*${reminderText}*`;
        
        // Send the reminder
        await sock.sendMessage(userId, { text: message });
        
        // Mark the reminder as completed
        reminder.completed = true;
        
        // If it's a recurring reminder, schedule the next occurrence
        if (reminder.recurring) {
            const nextTime = calculateNextRecurringTime(new Date(reminder.time), reminder.recurring);
            
            if (nextTime) {
                // Create a new reminder with the next occurrence time
                reminder.time = nextTime.toISOString();
                reminder.completed = false;
                
                // Schedule the next reminder
                scheduleReminder(sock, userId, reminderId, reminder.text, nextTime, reminder.recurring);
            }
        } else {
            // If it's not recurring, delete the reminder after it's completed
            delete reminders[userId][reminderId];
            
            // If user has no more reminders, clean up the user entry
            if (Object.keys(reminders[userId]).length === 0) {
                delete reminders[userId];
            }
        }
        
        // Save the updated reminders
        await saveReminders(reminders);
        
        return true;
    } catch (error) {
        console.error('Error sending reminder:', error);
        return false;
    }
}