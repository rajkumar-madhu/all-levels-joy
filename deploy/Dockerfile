FROM node:22-alpine
WORKDIR /app
COPY .output .output
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
