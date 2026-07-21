# Use official Node.js LTS alpine image for lightweight footprint
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency definition files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source files to container
COPY . .

# Set production environment defaults
ENV NODE_ENV=production
ENV PORT=3001

# Expose default port
EXPOSE 3001

# Run application
CMD ["npm", "start"]
