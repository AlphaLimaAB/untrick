FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright --version
COPY server.mjs store.mjs admin.mjs ./
USER pwuser
ENV NODE_ENV=production NODE_OPTIONS=--disable-warning=ExperimentalWarning
EXPOSE 8090
CMD ["node", "server.mjs"]
