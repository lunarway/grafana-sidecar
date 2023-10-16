FROM node:20.8.1-alpine

COPY package.json package-lock.json ./
RUN npm install .

COPY . .

ENTRYPOINT [ "node", "index.js" ]
CMD [ "watch" ]