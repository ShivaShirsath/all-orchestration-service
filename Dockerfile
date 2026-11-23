# Use an official Node.js runtime as the base image
FROM node:16.13.2

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Compile TypeScript once at build time (output in dist/).
RUN npm run build

# Expose the port on which the application will run
EXPOSE $PORT

# Run the compiled JavaScript. Previously `npm run start` = `nodemon index.ts`:
# every cluster worker compiled TypeScript at startup (~30 s before serving,
# more memory per worker) and nodemon restarted the app on file changes.
# `npm start` (nodemon) is still available for local development.
CMD ["node", "dist/index.js"]
