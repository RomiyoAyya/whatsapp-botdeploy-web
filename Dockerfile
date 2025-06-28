FROM node:18

WORKDIR /app

# Copy package.json first for better caching
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]