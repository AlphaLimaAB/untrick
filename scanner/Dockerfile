FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright --version
COPY server.mjs ./
USER pwuser
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "server.mjs"]
