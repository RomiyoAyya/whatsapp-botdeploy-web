const fs = require('fs-extra');
const path = require('path');
const { getUserData, saveUserData } = require('../utils');

// Path to store tasks
// Update file path to use config folder
const TASKS_FILE_PATH = path.join(process.cwd(), 'config', 'tasks.json');

// Function to get all user IDs
async function getAllUserIds() {
    try {
        const userDataDir = path.join(process.cwd(), 'user_data');
        if (!await fs.pathExists(userDataDir)) {
            return [];
        }
        
        const files = await fs.readdir(userDataDir);
        return files
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
    } catch (error) {
        console.error('Error getting all user IDs:', error);
        return [];
    }
}

// Initialize tasks file if it doesn't exist
async function ensureTasksFile() {
    try {
        // Check if config directory exists, create if not
        const configDir = path.join(process.cwd(), 'config');
        if (!await fs.pathExists(configDir)) {
            await fs.mkdir(configDir);
        }
        
        // Check if tasks file exists, create if not
        if (!await fs.pathExists(TASKS_FILE_PATH)) {
            await fs.writeJson(TASKS_FILE_PATH, { tasks: [] });
        }
    } catch (error) {
        console.error('Error ensuring tasks file exists:', error);
    }
}

// Call this at the beginning of each function that accesses the tasks file
async function getAllTasks() {
    await ensureTasksFile();
    try {
        const data = await fs.readJson(TASKS_FILE_PATH);
        return data.tasks || [];
    } catch (error) {
        console.error('Error reading tasks:', error);
        return [];
    }
}

// Save tasks
// Save tasks
async function saveAllTasks(tasks) {
    await ensureTasksFile();
    try {
        await fs.writeJson(TASKS_FILE_PATH, { tasks }, { spaces: 2 });
        return true;
    } catch (error) {
        console.error('Error saving tasks:', error);
        return false;
    }
}

// Add a new task
async function addTask(taskData) {
    const tasks = await getAllTasks();
    
    // Check if task with same name already exists
    const existingTask = tasks.find(task => task.name.toLowerCase() === taskData.name.toLowerCase());
    if (existingTask) {
        return { 
            success: false, 
            message: `✨ Oops! It looks like a task named "${taskData.name}" already exists in our collection. Would you mind choosing a different, unique name for your task? 🌟` 
        };
    }
    
    // Validate premium duration format
    const validPremiumDuration = /^(\d+[hd]|lifetime)$/.test(taskData.premiumDuration);
    if (!validPremiumDuration) {
        return { 
            success: false, 
            message: "Invalid premium duration format. Please use:\n- 1h to 24h for hours\n- 1d to 30d for days\n- lifetime for permanent" 
        };
    }
    
    // Validate expire duration format
    const validExpireDuration = /^(\d+[hd])$/.test(taskData.expireDuration);
    if (!validExpireDuration) {
        return { 
            success: false, 
            message: "Invalid expire duration format. Please use:\n- 1h to 24h for hours\n- 1d to 30d for days" 
        };
    }
    
    // Add task with additional metadata
    const newTask = {
        ...taskData,
        createdAt: new Date().toISOString(),
        completedBy: [],
        isExpired: false
    };
    
    // In the addTask function
    tasks.push(newTask);
    await saveAllTasks(tasks);  // Changed from saveAllTasks to saveAllTasks
    
    return { success: true, task: newTask };
}

// Delete a task
async function deleteTask(taskName) {
    const tasks = await getAllTasks();
    const initialLength = tasks.length;
    
    const filteredTasks = tasks.filter(task => task.name.toLowerCase() !== taskName.toLowerCase());
    
    if (filteredTasks.length === initialLength) {
        return { 
            success: false, 
            message: `✨ Oops! I couldn't find a task called "${taskName}" in our magical collection. Double-check the name and try again! 🔍` 
        };
    }
    
    await saveAllTasks(filteredTasks);
    return { 
        success: true, 
        message: `✨ Poof! The task "${taskName}" has vanished from our magical collection! 🌟` 
    };
}

// Get a specific task by name
async function getTaskByName(taskName) {
    const tasks = await getAllTasks();
    return tasks.find(task => task.name.toLowerCase() === taskName.toLowerCase());
}

// Check if a task is expired
function isTaskExpired(task) {
    if (task.isExpired) return true;
    
    const now = new Date();
    const expireDate = new Date(task.expireAt);
    
    return now > expireDate;
}

// Check if a task is full (reached max completions)
function isTaskFull(task) {
    if (task.maxCompletions === 'unlimited') return false;
    return task.completedBy.length >= parseInt(task.maxCompletions);
}

// Complete a task for a user
async function completeTask(taskName, key, userId) {
    const tasks = await getAllTasks();
    const taskIndex = tasks.findIndex(task => task.name.toLowerCase() === taskName.toLowerCase());
    
    if (taskIndex === -1) {
        return { 
            success: false, 
            message: `✨ Oops! I couldn't find a task named "${taskName}" in our magical collection. Try using /task to see all the available enchanting tasks! 🔍` 
        };
    }
    
    const task = tasks[taskIndex];
    
    // Check if task is expired
    if (isTaskExpired(task)) {
        task.isExpired = true; // Mark as expired
        await saveAllTasks(tasks);
        return { 
            success: false, 
            message: `✨ Oh no! It seems this magical task has faded away into the mists of time. Don't worry though - new adventures await! Check /task for more exciting opportunities! 🌟` 
        };
    }
    
    // Check if task is full
    if (isTaskFull(task)) {
        return { success: false, message: `This task has reached its maximum number of completions.` };
    }
    
    // Check if user already completed this task
    if (task.completedBy.some(completion => completion.userId === userId)) {
        return { success: false, message: `You have already completed this task.` };
    }
    
    // Check if key is correct
    if (task.key !== key) {
        return { success: false, message: `Incorrect key for task "${taskName}". Please try again.` };
    }
    
    // Add user to completedBy list
    const now = new Date();
    task.completedBy.push({
        userId,
        completedAt: now.toISOString()
    });
    
    // Save updated tasks
    await saveAllTasks(tasks);
    
    // Apply premium trial to user
    const userData = await getUserData(userId);
    if (!userData) {
        return { success: false, message: `Error: User data not found.` };
    }
    
    // Calculate premium expiry based on duration
    let premiumExpiry;
    const durationMatch = task.premiumDuration.match(/^(\d+)([hd]|lifetime)$/);
    
    if (durationMatch) {
        const [, amount, unit] = durationMatch;
        
        if (unit === 'lifetime') {
            premiumExpiry = null; // No expiry for lifetime
        } else {
            const multiplier = unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // hours or days
            premiumExpiry = new Date(now.getTime() + parseInt(amount) * multiplier);
        }
    } else {
        premiumExpiry = new Date(now.getTime() + 60 * 60 * 1000); // Default to 1 hour
    }
    
    // Update user data with premium trial
    userData.isPremium = true;
    userData.premiumExpiry = premiumExpiry ? premiumExpiry.toISOString() : null;
    userData.premiumAddedAt = now.toISOString();
    userData.premiumAddedBy = 'task';
    userData.premiumDuration = task.premiumDuration;
    userData.isTaskTrial = true; // Flag to identify task-based trial users
    userData.taskTrialStartTime = now.toISOString();
    userData.taskTrialTaskName = task.name;
    
    // Reset counters for the trial period
    userData.imageGenerationCount = 0;
    userData.dailyMessages = {
        count: 0,
        date: new Date().toISOString().split('T')[0]
    };
    
    await saveUserData(userId, userData);
    
    // Check if task is now full after this completion
    const isNowFull = isTaskFull(task);
    
    return { 
        success: true, 
        message: `Congratulations! You've successfully completed the task "${taskName}" and received a ${task.premiumDuration} premium trial!`,
        isTaskFull: isNowFull
    };
}

// Format task details for display
function formatTaskDetails(task, showKey = false) {
    const now = new Date();
    const expireDate = new Date(task.expireAt);
    const isExpired = now > expireDate;
    const isFull = task.maxCompletions !== 'unlimited' && task.completedBy.length >= parseInt(task.maxCompletions);
    
    let status = "✅ Available";
    if (isExpired) status = "⏱️ Expired";
    else if (isFull) status = "🔒 Completed (Full)";
    
    let timeLeft = "";
    if (!isExpired) {
        const diffMs = expireDate - now;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        timeLeft = `${diffHrs}h ${diffMins}m`;
    }
    
    return `*Task: ${task.name}*
${task.description !== 'skip' ? `📝 ${task.description}` : ''}
👥 Completions: ${task.completedBy.length}${task.maxCompletions !== 'unlimited' ? `/${task.maxCompletions}` : ''}
${showKey ? `🔑 Key: ${task.key}\n` : ''}🔗 Find the key: ${task.keyLink}
🎁 Reward: ${task.premiumDuration} Premium Trial
⏳ Expires: ${timeLeft || 'Expired'}
📊 Status: ${status}

`;
}

// Broadcast task announcement to all users
async function broadcastTaskAnnouncement(sock, task) {
    try {
        const userIds = await getAllUserIds();
        let successCount = 0;
        let errorCount = 0;
        
        for (const userId of userIds) {
            try {
                const userData = await getUserData(userId);
                
                // Only send to users who have created a character
                if (userData && userData.companionName) {
                    const message = `🎉 *NEW TASK AVAILABLE!* 🎉

*${task.name}* has been added to the task list!
${task.description !== 'skip' ? `📝 ${task.description}` : ''}
🎁 Reward: ${task.premiumDuration} Premium Trial
⏳ Available for: ${task.expireDuration}

Type */task* to see all available tasks and complete them to earn premium trials!`;
                    
                    await sock.sendMessage(userId, { text: message });
                    successCount++;
                }
            } catch (error) {
                console.error(`Error sending task announcement to ${userId}:`, error);
                errorCount++;
            }
            
            // Add a small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return { successCount, errorCount };
    } catch (error) {
        console.error('Error broadcasting task announcement:', error);
        return { successCount: 0, errorCount: 0, error: error.message };
    }
}

// Check for expired tasks and notify bot owner
async function checkExpiredTasks(sock, botOwner) {
    try {
        const tasks = await getAllTasks();
        let expiredCount = 0;
        let fullCount = 0;
        
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            
            // Skip already marked expired tasks
            if (task.isExpired) continue;
            
            const now = new Date();
            const expireDate = new Date(task.expireAt);
            
            // Check if task is expired
            if (now > expireDate) {
                task.isExpired = true;
                expiredCount++;
                
                // Notify bot owner
                if (botOwner) {
                    await sock.sendMessage(botOwner, { 
                        text: `📢 Task "${task.name}" has expired and is no longer available. It was completed by ${task.completedBy.length} users.` 
                    });
                }
            }
            
            // Check if task is full
            if (!task.isExpired && task.maxCompletions !== 'unlimited' && 
                task.completedBy.length >= parseInt(task.maxCompletions) && 
                !task.notifiedFull) {
                
                task.notifiedFull = true;
                fullCount++;
                
                // Notify bot owner
                if (botOwner) {
                    await sock.sendMessage(botOwner, { 
                        text: `📢 Task "${task.name}" has reached its maximum completions (${task.maxCompletions}) and is now full.` 
                    });
                }
            }
        }
        
        if (expiredCount > 0 || fullCount > 0) {
            await saveAllTasks(tasks);
        }
        
        return { expiredCount, fullCount };
    } catch (error) {
        console.error('Error checking expired tasks:', error);
        return { expiredCount: 0, fullCount: 0, error: error.message };
    }
}

// Check for expired task trials and handle memory clearing
async function checkExpiredTaskTrials(sock) {
    try {
        const userIds = await getAllUserIds();
        let expiredCount = 0;
        
        for (const userId of userIds) {
            try {
                const userData = await getUserData(userId);
                
                if (userData && userData.isPremium && userData.isTaskTrial && userData.premiumExpiry) {
                    const expiryDate = new Date(userData.premiumExpiry);
                    const now = new Date();
                    
                    // If task trial has expired
                    if (expiryDate <= now) {
                        console.log(`Task trial expired for user ${userId}`);
                        userData.isPremium = false;
                        userData.premiumExpiredAt = now.toISOString();
                        userData.isTaskTrial = false;
                        
                        // Clear memory data for task trial users when trial expires
                        userData.memory = {
                            topics: {},
                            preferences: {},
                            importantEvents: [],
                            lastInteractionSummary: ""
                        };
                        
                        await saveUserData(userId, userData);
                        expiredCount++;
                        
                        // Notify the user
                        try {
                            await sock.sendMessage(userId, { 
                                text: `⏰ *Your Task Premium Trial Has Ended* ⏰\n\nYour premium trial from task "${userData.taskTrialTaskName}" has expired. You've been returned to the free tier with limited features. Complete more tasks or type /premium to upgrade!` 
                            });
                        } catch (notifyError) {
                            console.error(`Error notifying user ${userId} about trial expiry:`, notifyError);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error checking task trial for ${userId}:`, error);
            }
        }
        
        return { expiredCount };
    } catch (error) {
        console.error('Error checking expired task trials:', error);
        return { expiredCount: 0, error: error.message };
    }
}

module.exports = {
    getAllTasks,
    addTask,
    deleteTask,
    getTaskByName,
    completeTask,
    formatTaskDetails,
    broadcastTaskAnnouncement,
    checkExpiredTasks,
    checkExpiredTaskTrials,
    isTaskExpired,
    isTaskFull
};