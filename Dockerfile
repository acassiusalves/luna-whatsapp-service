FROM node:20-alpine

# Install dependencies for Baileys (chromium deps might be needed)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create sessions directory
RUN mkdir -p /app/sessions

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
